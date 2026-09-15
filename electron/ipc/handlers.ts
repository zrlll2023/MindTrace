import { ipcMain, shell } from 'electron'
import { getContext } from '../context'
import { AppSettings, PROVIDER_PRESETS } from '../types'
import { parseDumpWith } from '../analysis/parser'
import { desensitizeText } from '../analysis/desensitize'
import { NewEntry } from '../db/repository'
import { TimelineFilter } from '../types'

export function registerIpcHandlers(): void {
  // ---------- settings ----------
  ipcMain.handle('settings:get', () => {
    const c = getContext()
    return {
      settings: c.getSettings(),
      hasApiKey: c.secrets.get('llm_api_key') != null,
      dataDir: c.dataDir
    }
  })

  ipcMain.handle('settings:save', (_e, settings: AppSettings, apiKey?: string) => {
    const c = getContext()
    c.saveSettings(settings)
    if (apiKey !== undefined && apiKey !== '') {
      c.secrets.set('llm_api_key', apiKey)
    }
  })

  ipcMain.handle('settings:openDataDir', async () => {
    const c = getContext()
    await shell.openPath(c.dataDir)
  })

  ipcMain.handle('settings:getPresets', () => PROVIDER_PRESETS)

  // ---------- llm ----------
  ipcMain.handle('llm:listModels', async () => {
    const c = getContext()
    const llm = c.getLlm()
    if (!llm) return { ok: false, error: '请先填写 Base URL 和模型名', models: [] }
    try {
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
        const saved = [] as Awaited<ReturnType<typeof c.repo.insertEntry>>[]
        for (const entry of entries) {
          const e: NewEntry = {
            raw_text: raw,
            kind: entry.kind as NewEntry['kind'],
            content: JSON.stringify(entry.content),
            confidence: entry.confidence,
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
    const engine = new AnalyzeEngine(c.repo, llm, {
      desensitize: c.getSettings().desensitize
    })
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
    const engine = new AnalyzeEngine(c.repo, llm, {
      desensitize: c.getSettings().desensitize
    })
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
}
