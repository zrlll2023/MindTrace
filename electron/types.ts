/**
 * 前后端共享类型（纯类型 + 常量，不含运行时依赖）。
 */

export type EntryKind = 'sleep' | 'event' | 'conversation' | 'quote' | 'idea' | 'other'
export type ReportType = 'daily' | 'weekly'

export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  note?: string
}

/** 提供商预设：选中后自动填 baseUrl（spec §7） */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'moonshot', name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'siliconflow', name: 'SiliconFlow 硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'ollama', name: 'Ollama（本机）', baseUrl: 'http://localhost:11434/v1', note: '无需 API Key' },
  { id: 'custom', name: '自定义', baseUrl: '' }
]

export type SearchProvider = 'none' | 'tavily' | 'bocha'

export interface AppSettings {
  providerId: string
  baseUrl: string
  model: string
  // apiKey 不放这里：只走 SecretBox 加密存储（spec §8）
  desensitize: boolean // 出网脱敏开关
  backupRetention: number
  searchProvider: SearchProvider // v2：联网搜索（none=关闭）
  embeddingEnabled: boolean // v2.5：语义搜索（复用主提供商 baseUrl+Key，需模型支持 embeddings）
  embeddingModel: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  providerId: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: '',
  desensitize: true,
  backupRetention: 30,
  searchProvider: 'none',
  embeddingEnabled: false,
  embeddingModel: ''
}

export interface ParsedEntry {
  kind: EntryKind
  content: Record<string, unknown>
  confidence: number
}

export const KIND_LABELS: Record<EntryKind, string> = {
  sleep: '😴 睡眠',
  event: '😞 事件',
  conversation: '💬 对话',
  quote: '📖 句子',
  idea: '💡 想法',
  other: '📦 其他'
}

export interface TimelineFilter {
  dateFrom?: string
  dateTo?: string
  kind?: EntryKind
  limit?: number
  offset?: number
}

export interface GenerateReportResult {
  ok: boolean
  error?: string
  reportId?: number
}
