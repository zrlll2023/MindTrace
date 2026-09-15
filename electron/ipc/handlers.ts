import { ipcMain, shell } from 'electron'
import { getContext } from '../context'
import { AppSettings, PROVIDER_PRESETS } from '../types'
import { parseDumpWith } from '../analysis/parser'
import { NewEntry } from '../db/repository'

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
      const parsed = await parseDumpWith(llm, raw)
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
}
