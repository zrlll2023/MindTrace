import { ipcMain, shell } from 'electron'
import { getContext } from '../context'
import { AppSettings, PROVIDER_PRESETS } from '../types'
import { parseDumpWith } from '../analysis/parser'
import { desensitizeText } from '../analysis/desensitize'
import { NewEntry } from '../db/repository'
import { TimelineFilter } from '../types'

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
  // ---------- settings ----------
  ipcMain.handle('settings:get', () => {
    const c = getContext()
    return {
      settings: c.getSettings(),
      hasApiKey: c.secrets.get('llm_api_key') != null,
      hasSearchKey: c.secrets.get('search_api_key') != null,
      dataDir: c.dataDir
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

  ipcMain.handle('settings:getPresets', () => PROVIDER_PRESETS)

  // ---------- llm ----------
  ipcMain.handle('llm:listModels', async (_e, baseUrl?: string, apiKey?: string) => {
    const c = getContext()
    // 优先用表单草稿（用户可能还没保存），Key 缺省用已存的
    const key = apiKey || c.secrets.get('llm_api_key') || ''
    const url = (baseUrl || c.getSettings().baseUrl || '').trim()
    if (!url) return { ok: false, error: '请先填写 Base URL', models: [] }
    if (!key) return { ok: false, error: '请先填写 API Key 再拉取模型列表', models: [] }
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
  ipcMain.handle('capture:parse', async (_e, raw: string) => {
    const c = getContext()
    const llm = c.getLlm()
    if (!llm) return { ok: false, error: '请先在设置页配置 AI 提供商', parsed: [] }
    try {
      // 出网脱敏（spec §8）：掩码后的文本仅用于解析；本地存的 raw_text 始终是原文
      const outgoing = c.getSettings().desensitize ? desensitizeText(raw) : raw
      const parsed = await parseDumpWith(llm, outgoing)
      return { ok: true, parsed }
    } catch (e) {
      return { ok: false, error: (e as Error).message, parsed: [] }
    }
  })

  ipcMain.handle(
    'capture:commit',
    async (_e, raw: string, entries: { kind: string; content: object; confidence: number }[]) => {
      const c = getContext()
      try {
        const { validateParsedEntry } = await import('../analysis/validators.js')
        const saved = [] as Awaited<ReturnType<typeof c.repo.insertEntry>>[]
        for (const entry of entries) {
          // 契约闸门：非法条目兜底为 other/confidence=0，绝不丢用户原文
          const v = validateParsedEntry(entry)
          const kind = v.ok ? v.entry!.kind : 'other'
          const content = v.ok ? v.entry!.content : { text: String(entry.content ?? '') }
          const confidence = v.ok ? v.entry!.confidence : 0
          const e: NewEntry = {
            raw_text: raw,
            kind: kind as NewEntry['kind'],
            content: JSON.stringify(content),
            confidence,
            source: 'chat'
          }
          saved.push(await c.repo.insertEntry(e))
        }
        c.repo.save()
        return { ok: true, entries: saved }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  // ---------- timeline ----------
  ipcMain.handle('timeline:list', (_e, filter: TimelineFilter) =>
    getContext().repo.listEntries(filter)
  )
  ipcMain.handle('timeline:search', (_e, keyword: string) =>
    getContext().repo.searchEntries(keyword)
  )
  ipcMain.handle('timeline:get', (_e, id: number) => getContext().repo.getEntry(id))
  ipcMain.handle('timeline:updateContent', (_e, id: number, content: object) => {
    const c = getContext()
    c.repo.updateEntryContent(id, JSON.stringify(content))
    c.repo.save()
    return { ok: true }
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
  ipcMain.handle('export:md', (_e, report: { type: 'daily' | 'weekly'; period: string; content_md: string; meta: string }) =>
    getContext().repo
      ? (async () => {
          const c = getContext()
          const { exportMarkdown } = await import('../export/markdown.js')
          return exportMarkdown(report, c.dataDir)
        })()
      : Promise.resolve({ path: '' })
  )
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
