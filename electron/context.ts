import path from 'node:path'
import { app } from 'electron'
import fs from 'node:fs'
import { initDb } from './db/connection'
import { Repo } from './db/repository'
import { SecretBox } from './store/secrets'
import { LLMAdapter } from './adapters/llm'
import { AppSettings, DEFAULT_SETTINGS } from './types'
import { resolveDataDir } from './store/data-location'
import { KnowledgeBase } from './db/knowledge'

/**
 * 应用上下文：数据目录、数据库、密钥盒、LLM 适配器。
 * 由 main.ts 在 app ready 时初始化；IPC handlers 通过 getContext() 取用。
 */
export interface AppContext {
  dataDir: string
  repo: Repo
  secrets: SecretBox
  getLlm(): LLMAdapter | null
  getSearch(): import('./adapters/search').SearchAdapter | null
  getEmbedding(): import('./adapters/embedding').EmbeddingAdapter | null
  getSettings(): AppSettings
  saveSettings(s: AppSettings): void
}

let ctx: AppContext | null = null

export async function initContext(explicitDataDir?: string): Promise<AppContext> {
  if (ctx) return ctx
  const dataDir = explicitDataDir ?? resolveDataDir(app.getPath('userData'))
  fs.mkdirSync(dataDir, { recursive: true })

  const db = await initDb(dataDir)
  const repo = new Repo(db, dataDir)
  new KnowledgeBase(db).ensureRequiredFolders()
  repo.save()
  const secrets = new SecretBox(dataDir)

  const settingsFile = path.join(dataDir, 'settings.json')
  const loadSettings = (): AppSettings => {
    try {
      if (fs.existsSync(settingsFile)) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }
      }
    } catch {
      // 损坏则回默认
    }
    return { ...DEFAULT_SETTINGS }
  }

  let cachedSettings = loadSettings()

  const getLlm = (): LLMAdapter | null => {
    const s = loadSettings()
    const apiKey = secrets.get('llm_api_key') ?? ''
    if (!s.baseUrl || !s.model) return null
    return new LLMAdapter({ baseUrl: s.baseUrl, apiKey, model: s.model })
  }

  const getSearch = (): import('./adapters/search').SearchAdapter | null => {
    const s = loadSettings()
    if (!s.searchProvider || s.searchProvider === 'none') return null
    const key = secrets.get('search_api_key')
    if (!key) return null
    const { SearchAdapter } = require('./adapters/search.js') as typeof import('./adapters/search')
    return new SearchAdapter({ provider: s.searchProvider, apiKey: key })
  }

  const getEmbedding = (): import('./adapters/embedding').EmbeddingAdapter | null => {
    const s = loadSettings()
    if (!s.embeddingEnabled || !s.embeddingModel || !s.baseUrl) return null
    const key = secrets.get('llm_api_key') ?? ''
    const { EmbeddingAdapter } = require('./adapters/embedding.js') as typeof import('./adapters/embedding')
    return new EmbeddingAdapter({ baseUrl: s.baseUrl, apiKey: key, model: s.embeddingModel })
  }

  ctx = {
    dataDir,
    repo,
    secrets,
    getLlm,
    getSearch,
    getEmbedding,
    getSettings: () => ({ ...cachedSettings }),
    saveSettings(s: AppSettings) {
      cachedSettings = s
      fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2))
    }
  }
  return ctx
}

export function getContext(): AppContext {
  if (!ctx) throw new Error('应用上下文未初始化')
  return ctx
}

/** 仅测试用：重置单例 */
export function resetContext(): void {
  ctx = null
}
