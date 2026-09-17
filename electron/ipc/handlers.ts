import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { getContext } from '../context'
import { AppSettings, PROFILE_KEYS, PROVIDER_PRESETS, ProfileValues } from '../types'
import { parseCaptureWith } from '../analysis/parser'
import { desensitizeText } from '../analysis/desensitize'
import { NewEntry } from '../db/repository'
import { TimelineFilter } from '../types'
import { CaptureHistory } from '../db/capture'
import { KnowledgeBase } from '../db/knowledge'
import { ProfileStore } from '../db/profile'
import { inspectMigration, migrateData, previousDataDir } from '../store/data-location'
import { CaptureChoice, commitCaptureEntries } from '../capture-commit'

interface KnowledgeChoice { addToKnowledge?: boolean; folderId?: number; newFolderName?: string; reason?: string }
type SleepMode = 'session' | 'daily_total' | 'legacy'

function sleepMode(content: Record<string, unknown>): SleepMode {
  return content.recordType === 'session' ? 'session' : content.recordType === 'daily_total' ? 'daily_total' : 'legacy'
}

async function sleepModeConflict(date: string, mode: SleepMode, excludeId?: number): Promise<string | null> {
  if (mode === 'legacy') return null
  const entries = await getContext().repo.listEntries({ dateFrom: date, dateTo: date, kind: 'sleep', limit: 5000 })
  const modes = entries
    .filter(entry => entry.id !== excludeId)
    .map(entry => {
      try { return sleepMode(JSON.parse(entry.content) as Record<string, unknown>) } catch { return 'legacy' as const }
    })
  if (modes.some(value => value === 'legacy')) {
    return '当天已有旧版睡眠时长记录，请先在时间线中删除该旧记录，再添加分段或累计睡眠'
  }
  if (mode === 'daily_total' && modes.some(value => value === 'session')) {
    return '当天已有分段睡眠记录，请使用分段统计，或先删除这些睡眠段'
  }
  if (mode === 'session' && modes.some(value => value === 'daily_total')) {
    return '当天已有累计睡眠记录，请先删除累计值，再添加具体睡眠段'
  }
  if (mode === 'daily_total' && modes.some(value => value === 'daily_total')) {
    return '当天已有累计睡眠记录，请直接修改已有记录'
  }
  return null
}

function knowledgeText(kind: string, content: Record<string, unknown>, raw: string): string {
  if (typeof content.text === 'string') return content.text
  return raw || JSON.stringify(content, null, 2)
}

function knowledgeTitle(kind: string, text: string): string {
  const names: Record<string, string> = { event: '事件', conversation: '对话', quote: '句子', idea: '想法', other: '记录' }
  const compact = text.replace(/\s+/g, ' ').trim()
  return `${names[kind] ?? '记录'}：${compact.slice(0, 48) || '未命名'}`
}

/** 统一构建分析引擎（脱敏/联网搜索/语义检索配置一次注入） */
async function buildEngine(c: ReturnType<typeof getContext>) {
  const { AnalyzeEngine } = await import('../analysis/engine.js')
  const semantic = await makeSemantic(c)
  return new AnalyzeEngine(c.repo, c.getLlm()!, {
    desensitize: c.getSettings().desensitize,
    search: c.getSearch(),
    semantic
  })
}

async function makeSemantic(c: ReturnType<typeof getContext>) {
  const emb = c.getEmbedding()
  if (!emb) return null
  const { VectorStore } = await import('../db/vectors.js')
  const { SemanticSearch } = await import('../analysis/semantic.js')
  return new SemanticSearch(c.repo, new VectorStore(c.repo.getDb()), emb)
}

export function registerIpcHandlers(): void {
  const senderWindow = (event: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender)
  ipcMain.handle('window:minimize', event => {
    senderWindow(event)?.minimize()
    return { ok: true }
  })
  ipcMain.handle('window:toggleMaximize', event => {
    const win = senderWindow(event)
    if (!win) return { ok: false }
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return { ok: true, maximized: win.isMaximized() }
  })
  ipcMain.handle('window:close', event => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
    return { ok: true }
  })

  // ---------- settings ----------
  ipcMain.handle('settings:get', () => {
    const c = getContext()
    return {
      settings: c.getSettings(),
      hasApiKey: c.secrets.get('llm_api_key') != null,
      hasSearchKey: c.secrets.get('search_api_key') != null,
      dataDir: c.dataDir,
      previousDataDir: previousDataDir(app.getPath('userData'))
    }
  })

  ipcMain.handle(
    'settings:save',
    (_e, settings: AppSettings, apiKey?: string, searchKey?: string) => {
      const c = getContext()
      c.saveSettings(settings)
      if (apiKey !== undefined && apiKey !== '') {
        c.secrets.set('llm_api_key', apiKey)
      }
      if (searchKey !== undefined) {
        if (searchKey === '') c.secrets.delete('search_api_key')
        else c.secrets.set('search_api_key', searchKey)
      }
    }
  )

  ipcMain.handle('settings:openDataDir', async () => {
    const c = getContext()
    await shell.openPath(c.dataDir)
  })
  ipcMain.handle('settings:openPreviousDataDir', async () => {
    const old = previousDataDir(app.getPath('userData'))
    if (old) await shell.openPath(old)
  })
  ipcMain.handle('settings:selectDataDir', async () => {
    const r = await dialog.showOpenDialog({ title: '选择新的 MindTrace 数据目录', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled || !r.filePaths.length ? { canceled: true } : { canceled: false, path: r.filePaths[0] }
  })
  ipcMain.handle('settings:selectExportDir', async () => {
    const c = getContext()
    const current = c.getSettings().exportDirectory.trim()
    const r = await dialog.showOpenDialog({
      title: '选择报告导出目录',
      defaultPath: current || app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths.length) return { canceled: true }
    const exportDirectory = r.filePaths[0]
    c.saveSettings({ ...c.getSettings(), exportDirectory })
    return { canceled: false, path: exportDirectory }
  })
  ipcMain.handle('settings:clearExportDir', () => {
    const c = getContext()
    c.saveSettings({ ...c.getSettings(), exportDirectory: '' })
    return { ok: true }
  })
  ipcMain.handle('settings:inspectDataMigration', (_e, target: string) => inspectMigration(getContext().dataDir, target))
  ipcMain.handle('settings:migrateData', (_e, target: string) => {
    const c = getContext()
    c.repo.save()
    migrateData(c.dataDir, target, app.getPath('userData'))
    return { ok: true, requiresRestart: true }
  })
  ipcMain.handle('settings:restart', () => { app.relaunch(); app.exit(0) })

  ipcMain.handle('settings:getPresets', () => PROVIDER_PRESETS)

  // ---------- llm ----------
  ipcMain.handle('llm:listModels', async (_e, baseUrl?: string, apiKey?: string) => {
    const c = getContext()
    // 优先用表单草稿（用户可能还没保存），Key 缺省用已存的
    const key = apiKey || c.secrets.get('llm_api_key') || ''
    const url = (baseUrl || c.getSettings().baseUrl || '').trim()
    if (!url) return { ok: false, error: '请先填写 Base URL', models: [] }
    try {
      const { LLMAdapter } = await import('../adapters/llm.js')
      const llm = new LLMAdapter({ baseUrl: url, apiKey: key, model: 'probe' })
      return { ok: true, models: await llm.listModels() }
    } catch (e) {
      return { ok: false, error: (e as Error).message, models: [] }
    }
  })

  ipcMain.handle(
    'llm:testConnection',
    async (_e, baseUrl: string, apiKey?: string, model?: string) => {
      const c = getContext()
      // 用临时配置测试，不覆盖已保存设置
      const key = apiKey || c.secrets.get('llm_api_key') || ''
      if (!baseUrl || !model) return { ok: false, error: 'Base URL 与模型名必填' }
      const { LLMAdapter } = await import('../adapters/llm.js')
      const adapter = new LLMAdapter({ baseUrl, apiKey: key, model })
      return adapter.testConnection()
    }
  )

  // ---------- capture ----------
  ipcMain.handle('capture:list', () => new CaptureHistory(getContext().repo.getDb()).list())
  ipcMain.handle('capture:parse', async (_e, raw: string) => {
    const c = getContext()
    const llm = c.getLlm()
    if (!llm) return { ok: false, error: '请先在设置页配置 AI 提供商', parsed: [] }
    const history = new CaptureHistory(c.repo.getDb())
    const prior = history.context().map(m => ({ ...m, content: c.getSettings().desensitize ? desensitizeText(m.content) : m.content }))
    history.add('user', raw)
    try {
      const outgoing = c.getSettings().desensitize ? desensitizeText(raw) : raw
      const profile = new ProfileStore(c.repo.getDb()).values()
      const result = await parseCaptureWith(llm, outgoing, prior, profile)
      const msg = history.add('assistant', '我解析出了以下内容，请确认：', { parsed: result.entries, profileDraft: result.profileDraft })
      const folder = new KnowledgeBase(c.repo.getDb()).ensureSystemFolder('ai_quick_capture', 'AI 快速记录')
      c.repo.save()
      return { ok: true, message: msg, defaultFolderId: folder.id }
    } catch (e) {
      const msg = history.add('assistant', '', { error: (e as Error).message })
      c.repo.save()
      return { ok: false, error: (e as Error).message, message: msg, parsed: [] }
    }
  })

  ipcMain.handle(
    'capture:commit',
    async (_e, messageId: number, entries: CaptureChoice[]) => {
      const c = getContext()
      try {
        const saved = await commitCaptureEntries(c.repo, messageId, entries)
        return { ok: true, entries: saved }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )
  ipcMain.handle('capture:clear', () => {
    const c = getContext()
    new CaptureHistory(c.repo.getDb()).clear()
    c.repo.save()
    return { ok: true }
  })

  // ---------- timeline ----------
  ipcMain.handle('timeline:list', (_e, filter: TimelineFilter) =>
    getContext().repo.listEntries(filter)
  )
  ipcMain.handle('timeline:search', (_e, keyword: string) =>
    getContext().repo.searchEntries(keyword)
  )
  ipcMain.handle('timeline:get', (_e, id: number) => getContext().repo.getEntry(id))
  ipcMain.handle('timeline:updateContent', async (_e, id: number, content: object) => {
    const c = getContext()
    const existing = await c.repo.getEntry(id)
    if (!existing) return { ok: false, error: '记录不存在' }
    const { validateParsedEntry } = await import('../analysis/validators.js')
    const validated = validateParsedEntry({ kind: existing.kind, content, confidence: existing.confidence })
    if (!validated.ok || !validated.entry) return { ok: false, error: validated.reason ?? '内容校验未通过' }
    const normalized = validated.entry.content
    let entryDate: string | undefined
    let entryTime: string | null | undefined
    if (existing.kind === 'sleep') {
      const mode = sleepMode(normalized)
      entryDate = mode === 'session'
        ? String(normalized.endAt).slice(0, 10)
        : mode === 'daily_total' ? String(normalized.date) : existing.entry_date
      entryTime = mode === 'session' ? String(normalized.endAt).slice(11, 16) : null
      const conflict = await sleepModeConflict(entryDate, mode, id)
      if (conflict) return { ok: false, error: conflict }
    }
    await c.repo.updateEntryContent(id, JSON.stringify(normalized), entryDate, entryTime)
    return { ok: true, content: normalized, entryDate: entryDate ?? existing.entry_date, entryTime: entryTime ?? existing.entry_time }
  })
  ipcMain.handle('timeline:delete', (_e, id: number) => {
    getContext().repo.deleteEntry(id)
    return { ok: true }
  })
  // 手动直录（不经 AI）：与 capture:commit 同一契约闸门入库，source=manual
  ipcMain.handle('entries:manual', async (_e, kind: string, content: object, rawText: string, entryDate?: string, knowledge?: KnowledgeChoice) => {
    const c = getContext()
    const db = c.repo.getDb()
    try {
      const { validateParsedEntry, KIND_VALUES } = require('../analysis/validators.js') as typeof import('../analysis/validators')
      if (!KIND_VALUES.includes(kind as never)) {
        return { ok: false, error: `不支持的记录类型：${kind}` }
      }
      const v = validateParsedEntry({ kind, content, confidence: 1 })
      if (!v.ok || !v.entry) return { ok: false, error: v.reason ?? '内容校验未通过' }
      const normalizedContent = v.entry.content
      const normalizedDate = kind === 'sleep' && normalizedContent.recordType === 'session'
        ? String(normalizedContent.endAt).slice(0, 10)
        : kind === 'sleep' && normalizedContent.recordType === 'daily_total'
          ? String(normalizedContent.date)
          : entryDate
      const normalizedTime = kind === 'sleep' && normalizedContent.recordType === 'session'
        ? String(normalizedContent.endAt).slice(11, 16)
        : undefined
      if (kind === 'sleep' && normalizedDate) {
        const conflict = await sleepModeConflict(normalizedDate, sleepMode(normalizedContent))
        if (conflict) return { ok: false, error: conflict }
      }
      db.run('BEGIN')
      const entry = await c.repo.insertEntry({
        raw_text: rawText || JSON.stringify(content),
        kind: v.entry.kind,
        content: JSON.stringify(normalizedContent),
        confidence: 1,
        source: 'manual',
        ...(normalizedDate ? { entry_date: normalizedDate } : {}),
        ...(normalizedTime ? { entry_time: normalizedTime } : {})
      })
      if (kind !== 'sleep' && knowledge?.addToKnowledge) {
        const kb = new KnowledgeBase(db)
        const folderId = knowledge.folderId ?? (knowledge.newFolderName?.trim() ? kb.addFolder(knowledge.newFolderName.trim()).id : 0)
        if (!folderId) throw new Error('请选择或创建知识库文件夹')
        if (!kb.listFolders().some(f => f.id === folderId)) throw new Error('选择的知识库文件夹不存在')
        const body = knowledgeText(kind, v.entry.content, rawText)
        kb.addItem({ folderId, title: knowledgeTitle(kind, body), sourceType: 'entry', body, reason: knowledge.reason, sourceEntryId: entry.id })
      }
      db.run('COMMIT')
      c.repo.save()
      return { ok: true, id: entry.id }
    } catch (e) {
      try { db.run('ROLLBACK') } catch { /* no active transaction */ }
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('profile:get', () => new ProfileStore(getContext().repo.getDb()).get())
  ipcMain.handle('profile:save', (_e, values: ProfileValues) => {
    const c = getContext(); new ProfileStore(c.repo.getDb()).saveManual(values); c.repo.save(); return { ok: true }
  })
  ipcMain.handle('profile:confirmDraft', (_e, messageId: number, values: ProfileValues) => {
    const c = getContext()
    const db = c.repo.getDb()
    const message = new CaptureHistory(db).list().find(m => m.id === messageId && m.role === 'assistant')
    if (!message?.profileDraft) return { ok: false, error: '待确认的资料草稿不存在' }
    const accepted: ProfileValues = {}
    for (const key of PROFILE_KEYS) {
      const proposed = message.profileDraft[key]?.trim()
      if (proposed && values[key]?.trim() === proposed) accepted[key] = proposed
    }
    try {
      db.run('BEGIN')
      new ProfileStore(db).confirmDraft(accepted)
      db.run('UPDATE capture_messages SET profile_draft_json = NULL WHERE id = ?', [messageId])
      db.run('COMMIT')
      c.repo.save()
      return { ok: true }
    } catch (error) {
      try { db.run('ROLLBACK') } catch { /* no active transaction */ }
      return { ok: false, error: (error as Error).message }
    }
  })

  // ---------- reports ----------
  ipcMain.handle('reports:get', (_e, type: 'daily' | 'weekly', period: string) =>
    getContext().repo.getReport(type, period)
  )
  ipcMain.handle('reports:list', (_e, type?: 'daily' | 'weekly') =>
    getContext().repo.listReports(type)
  )
  ipcMain.handle('reports:generate', async (_e, date: string) => {
    const c = getContext()
    const llm = c.getLlm()
    if (!llm) return { ok: false, error: '请先在设置页配置 AI 提供商' }
    const { AnalyzeEngine } = await import('../analysis/engine.js')
    const engine = await buildEngine(c)
    try {
      const report = await engine.analyzeDay(date)
      c.repo.save()
      if (!report) return { ok: false, error: `${date} 没有任何记录，无法生成日报` }
      return { ok: true, reportId: report.id }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('reports:generateWeekly', async (_e, endDate: string) => {
    const c = getContext()
    const llm = c.getLlm()
    if (!llm) return { ok: false, error: '请先在设置页配置 AI 提供商' }
    const { AnalyzeEngine } = await import('../analysis/engine.js')
    const engine = await buildEngine(c)
    try {
      const report = await engine.analyzeWeek(endDate)
      c.repo.save()
      if (!report) return { ok: false, error: '该周没有任何记录' }
      return { ok: true, reportId: report.id }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // ---------- export / backup ----------
  ipcMain.handle('export:md', async (_e, report: { type: 'daily' | 'weekly'; period: string; content_md: string; meta: string }) => {
    const c = getContext()
    let exportDirectory = c.getSettings().exportDirectory.trim()

    if (!exportDirectory) {
      const r = await dialog.showOpenDialog({
        title: '选择报告导出目录',
        defaultPath: app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory']
      })
      if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true, path: '' }
      exportDirectory = r.filePaths[0]
      c.saveSettings({ ...c.getSettings(), exportDirectory })
    }

    try {
      const { exportMarkdown } = await import('../export/markdown.js')
      const result = await exportMarkdown(report, exportDirectory)
      return { ok: true, ...result }
    } catch (e) {
      return {
        ok: false,
        path: '',
        error: `无法导出报告：${(e as Error).message}。请到设置页面重新选择导出目录。`
      }
    }
  })
  ipcMain.handle('backup:run', async () => {
    const c = getContext()
    c.repo.save() // 先落盘再备份，保证备份是最新状态
    const { runBackup } = await import('../store/backup.js')
    const s = c.getSettings()
    return runBackup(c.dataDir, s.backupRetention ?? 30)
  })

  // ---------- import（v2：AI 对话导入） ----------
  ipcMain.handle('import:exportZip', async () => {
    const c = getContext()
    const { dialog } = await import('electron')
    const r = await dialog.showOpenDialog({
      title: '选择 AI 导出 ZIP',
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true } as never
    try {
      const fs = await import('node:fs')
      const bytes = fs.readFileSync(r.filePaths[0])
      const { parseExportZip, importConversations } = await import('../import/service.js')
      const convs = parseExportZip(new Uint8Array(bytes))
      const summary = await importConversations(c.repo, convs)
      return { ok: true, summary } as never
    } catch (e) {
      return { ok: false, error: (e as Error).message } as never
    }
  })

  // ---------- semantic search（v2.5） ----------
  ipcMain.handle('semantic:search', async (_e, query: string, topK?: number) => {
    const c = getContext()
    const emb = c.getEmbedding()
    if (!emb) return { ok: false, error: 'not_configured', hits: [] }
    try {
      const { VectorStore } = await import('../db/vectors.js')
      const { SemanticSearch } = await import('../analysis/semantic.js')
      const sem = new SemanticSearch(c.repo, new VectorStore(c.repo.getDb()), emb)
      const hits = await sem.search(query, topK ?? 10)
      return {
        ok: true,
        hits: hits.map(h => ({
          id: h.entry.id,
          kind: h.entry.kind,
          entry_date: h.entry.entry_date,
          created_at: h.entry.created_at,
          content: h.entry.content,
          raw_text: h.entry.raw_text,
          score: Number(h.score.toFixed(4)),
          chunk_text: h.chunk_text
        }))
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message, hits: [] }
    }
  })

  ipcMain.handle('semantic:index', async () => {
    const c = getContext()
    const emb = c.getEmbedding()
    if (!emb) return { ok: false, error: 'not_configured' }
    try {
      const { VectorStore } = await import('../db/vectors.js')
      const vs = new VectorStore(c.repo.getDb())
      const n = await vs.embedMissing(c.repo, emb)
      c.repo.save()
      return { ok: true, indexed: n }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('semantic:status', async () => {
    const c = getContext()
    const emb = c.getEmbedding()
    if (!emb) return { configured: false, indexed: 0 }
    const { VectorStore } = await import('../db/vectors.js')
    const vs = new VectorStore(c.repo.getDb())
    return { configured: true, indexed: await vs.count() }
  })

  // ---------- hybrid search（v2.5） ----------
  ipcMain.handle(
    'hybrid:search',
    async (_e, query: string, topK?: number, expand?: boolean) => {
      const c = getContext()
      try {
        const semantic = await makeSemantic(c)
        const { HybridSearch } = await import('../analysis/hybrid.js')
        const hybrid = new HybridSearch(c.repo, semantic)
        const queries = expand && c.getLlm() ? await hybrid.expandQuery(query, c.getLlm()!) : [query]
        let hits = await hybrid.searchMultiQuery(queries, topK ?? 10)
        // v2.5 精排：设置开启 + 有 LLM + 候选 ≥2 时，对融合结果二次重排（失败保序，见 reranker.ts）
        if (c.getSettings().rerankEnabled && c.getLlm() && hits.length >= 2) {
          const { rerank } = await import('../analysis/reranker.js')
          hits = await rerank(query, hits, c.getLlm()!)
        }
        return {
          ok: true,
          queries,
          reranked: c.getSettings().rerankEnabled && !!c.getLlm() && hits.some(h => 'rerank_score' in h),
          hits: hits.map(h => ({
            id: h.entry.id,
            kind: h.entry.kind,
            entry_date: h.entry.entry_date,
            created_at: h.entry.created_at,
            content: h.entry.content,
            raw_text: h.entry.raw_text,
            score: h.score,
            fused_via: h.fused_via,
            chunk_text: h.chunk_text,
            rerank_score: (h as { rerank_score?: number }).rerank_score
          }))
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message, queries: [query], hits: [] }
      }
    }
  )

  // ---------- 知识库（v3） ----------
  ipcMain.handle('kb:listFolders', () => {
    const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
    return new KnowledgeBase(getContext().repo.getDb()).listFolders()
  })

  ipcMain.handle('kb:addFolder', (_e, name: string, description?: string) => {
    const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
    const kb = new KnowledgeBase(getContext().repo.getDb())
    if (!name.trim()) return { ok: false, error: '文件夹名不能为空' }
    const f = kb.addFolder(name.trim(), description?.trim() ?? '')
    getContext().repo.save()
    return { ok: true, folder: f }
  })

  ipcMain.handle('kb:renameFolder', (_e, id: number, name: string, description?: string) => {
    const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
    const kb = new KnowledgeBase(getContext().repo.getDb())
    kb.renameFolder(id, name.trim(), description)
    getContext().repo.save()
    return { ok: true }
  })

  ipcMain.handle('kb:deleteFolder', (_e, id: number) => {
    const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
    const kb = new KnowledgeBase(getContext().repo.getDb())
    kb.deleteFolder(id)
    getContext().repo.save()
    return { ok: true }
  })

  ipcMain.handle('kb:listItems', (_e, folderId: number) => {
    const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
    return new KnowledgeBase(getContext().repo.getDb()).listItems(folderId)
  })

  ipcMain.handle('kb:getItem', (_e, id: number) => {
    const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
    return new KnowledgeBase(getContext().repo.getDb()).getItem(id)
  })

  ipcMain.handle(
    'kb:addItem',
    (_e, folderId: number, meta: { title: string; sourceType: string; reason?: string }, body: string, filePath?: string) => {
      const c = getContext()
      const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
      const kb = new KnowledgeBase(c.repo.getDb())
      if (!meta.title.trim()) return { ok: false, error: '标题不能为空' }
      const item = kb.addItem({
        folderId,
        title: meta.title.trim().slice(0, 200),
        sourceType: meta.sourceType || 'markdown',
        body,
        filePath: filePath ?? '',
        reason: meta.reason?.trim() ?? ''
      })
      c.repo.save()
      return { ok: true, item }
    }
  )

  ipcMain.handle('kb:updateItem', (_e, id: number, patch: { title?: string; body?: string; reason?: string }) => {
    const c = getContext()
    const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
    new KnowledgeBase(c.repo.getDb()).updateItem(id, patch)
    c.repo.save()
    return { ok: true }
  })

  ipcMain.handle('kb:updateReflection', (_e, id: number, text: string) => {
    const c = getContext()
    const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
    new KnowledgeBase(c.repo.getDb()).updateReflection(id, text)
    c.repo.save()
    return { ok: true }
  })

  ipcMain.handle('kb:deleteItem', (_e, id: number) => {
    const c = getContext()
    const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
    new KnowledgeBase(c.repo.getDb()).deleteItem(id)
    c.repo.save()
    return { ok: true }
  })

  /** AI 一键总结（用户点击按钮触发） */
  ipcMain.handle('kb:summarize', async (_e, itemId: number) => {
    const c = getContext()
    const llm = c.getLlm()
    if (!llm) return { ok: false, error: '请先在设置页配置 AI 提供商' }
    const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
    const kb = new KnowledgeBase(c.repo.getDb())
    const item = kb.getItem(itemId)
    if (!item) return { ok: false, error: '资料不存在' }
    const { summarizeItem } = await import('../knowledge/ai.js')
    const r = await summarizeItem(kb, item, llm)
    if (r.ok) c.repo.save()
    return r
  })

  /** AI 按文件夹内容延伸（用户点击按钮触发） */
  ipcMain.handle('kb:extend', async (_e, folderId: number) => {
    const c = getContext()
    const llm = c.getLlm()
    if (!llm) return { ok: false, error: '请先在设置页配置 AI 提供商' }
    const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
    const kb = new KnowledgeBase(c.repo.getDb())
    const folders = kb.listFolders()
    const folder = folders.find(f => f.id === folderId)
    if (!folder) return { ok: false, error: '文件夹不存在' }
    const { extendFolder } = await import('../knowledge/ai.js')
    return extendFolder(kb, folder.name, kb.listItems(folderId), llm)
  })

  /** 文件导入：主进程弹文件对话框 + 纯 JS 解析（支持 markdown/txt/docx/pptx/xlsx/html） */
  ipcMain.handle('kb:importFiles', async (_e, folderId: number, reason?: string) => {
    const c = getContext()
    const { dialog } = require('electron') as typeof import('electron')
    const r = await dialog.showOpenDialog({
      title: '选择要收入知识库的文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的文件', extensions: ['md', 'markdown', 'txt', 'html', 'htm', 'docx', 'pptx', 'xlsx'] }
      ]
    })
    if (r.canceled || !r.filePaths.length) return { ok: true, imported: 0, items: [] }
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const { KnowledgeBase } = require('../db/knowledge.js') as typeof import('../db/knowledge')
    const { unzipOffice, extractText } = await import('../import/office.js')
    const kb = new KnowledgeBase(c.repo.getDb())
    const items: unknown[] = []
    for (const p of r.filePaths) {
      try {
        const ext = path.extname(p).toLowerCase().replace('.', '')
        const sourceType = ext === 'markdown' ? 'markdown' : ext
        let body = ''
        if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') {
          body = extractText(ext, unzipOffice(new Uint8Array(fs.readFileSync(p))))
        } else {
          body = fs.readFileSync(p, 'utf8')
          if (ext === 'html' || ext === 'htm') {
            body = body
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]*>/g, '\n')
              .replace(/\n{3,}/g, '\n\n')
              .trim()
          }
        }
        const item = kb.addItem({
          folderId,
          title: path.basename(p, path.extname(p)),
          sourceType,
          body,
          filePath: p,
          reason: reason?.trim() ?? ''
        })
        items.push(item)
      } catch {
        // 单个文件失败不阻断其余导入
      }
    }
    c.repo.save()
    return { ok: true, imported: items.length, items }
  })

  // ---------- labs（v3 实验性功能） ----------
  ipcMain.handle('labs:metrics', async (_e, dateFrom: string, dateTo: string) => {
    const c = getContext()
    const { dailyMetrics } = await import('../analysis/labs.js')
    return dailyMetrics(c.repo, dateFrom, dateTo)
  })

  ipcMain.handle('labs:planResearch', async () => {
    const c = getContext()
    const llm = c.getLlm()
    if (!llm) return { ok: false, error: '请先在设置页配置 AI 提供商', queries: [], note: '' }
    try {
      const threads = await c.repo.listThreads()
      const recent = await c.repo.listEntries({ kind: 'idea', limit: 10 })
      const ideas = recent.map(e => {
        try {
          return String((JSON.parse(e.content) as { text?: string }).text ?? '')
        } catch {
          return ''
        }
      }).filter(Boolean)
      const { planResearch } = await import('../analysis/labs.js')
      const plan = await planResearch(llm, threads.map(t => t.title), ideas)
      return { ok: true, ...plan }
    } catch (e) {
      return { ok: false, error: (e as Error).message, queries: [], note: '' }
    }
  })

  ipcMain.handle('labs:saveFinding', (_e, text: string, from: string) => {
    const c = getContext()
    // 契约闸门：人工粘贴的研究收获按 quote 入库（可选出处=链接）
    return c.repo
      .insertEntry({
        raw_text: text,
        kind: 'quote',
        content: JSON.stringify(from ? { text, from } : { text }),
        confidence: 1,
        source: 'labs:research',
        entry_date: new Date().toISOString().slice(0, 10)
      })
      .then(e => {
        c.repo.save()
        return { ok: true, id: e.id }
      })
      .catch((err: Error) => ({ ok: false, error: err.message }))
  })
}
