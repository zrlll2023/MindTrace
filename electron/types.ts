/**
 * 前后端共享类型（纯类型 + 常量，不含运行时依赖）。
 */

export type EntryKind = 'sleep' | 'event' | 'conversation' | 'quote' | 'idea' | 'other'
export type ReportType = 'daily' | 'weekly'

export interface DayMetrics {
  date: string
  sleep_hours: number | null
  negative_count: number
  classified_event_count: number
  entry_count: number
  idea_count: number
  sleep_sessions: number
  longest_sleep_hours: number | null
  sleep_data_mode: 'sessions' | 'daily_total' | 'duration_only' | 'none'
}

export interface SleepSessionContent {
  recordType: 'session'
  /** Local date and time, formatted as YYYY-MM-DD HH:mm. */
  startAt: string
  /** Local date and time, formatted as YYYY-MM-DD HH:mm. */
  endAt: string
  /** Derived from startAt/endAt and rounded to one decimal place. */
  hours: number
}

export interface SleepDailyTotalContent {
  recordType: 'daily_total'
  date: string
  hours: number
}

/** Older and AI-parsed sleep entries may only contain a duration. */
export interface SleepLegacyContent {
  hours: number
}

export type SleepContent = SleepSessionContent | SleepDailyTotalContent | SleepLegacyContent

export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  models: string[]
  note?: string
}

/** 提供商预设：选中后自动填 baseUrl（spec §7） */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4.5', 'glm-4.5-flash', 'glm-4-long'] },
  { id: 'moonshot', name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
  { id: 'siliconflow', name: 'SiliconFlow 硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'] },
  { id: 'ollama', name: 'Ollama（本机）', baseUrl: 'http://localhost:11434/v1', models: [], note: '无需 API Key' },
  { id: 'custom', name: '自定义', baseUrl: '', models: [] }
]

export const PROFILE_KEYS = ['name', 'preferredName', 'identity', 'location', 'bio', 'goals', 'interests'] as const
export type ProfileKey = (typeof PROFILE_KEYS)[number]
export type ProfileValues = Partial<Record<ProfileKey, string>>

export type SearchProvider = 'none' | 'tavily' | 'bocha'

export interface ResearchPlanDraft {
  weekKey: string
  queries: string[]
  note: string
  finding: string
  findingFrom: string
  generatedAt: string
  updatedAt: string
}

export interface AppSettings {
  providerId: string
  baseUrl: string
  model: string
  exportDirectory: string // 报告导出目录；为空时首次导出询问
  // apiKey 不放这里：只走 SecretBox 加密存储（spec §8）
  desensitize: boolean // 出网脱敏开关
  backupRetention: number
  searchProvider: SearchProvider // v2：联网搜索（none=关闭）
  embeddingEnabled: boolean // v2.5：语义搜索（复用主提供商 baseUrl+Key，需模型支持 embeddings）
  embeddingModel: string
  rerankEnabled: boolean // v2.5：LLM 精排（混合搜索 top-20 二次重排）
}

export const DEFAULT_SETTINGS: AppSettings = {
  providerId: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: '',
  exportDirectory: '',
  desensitize: true,
  backupRetention: 30,
  searchProvider: 'none',
  embeddingEnabled: false,
  embeddingModel: '',
  rerankEnabled: false
}

export interface ParsedEntry {
  kind: EntryKind
  content: Record<string, unknown>
  confidence: number
  /** 事件发生日期（设备本地日期），YYYY-MM-DD */
  entryDate: string
  /** 可选的事件发生时间（设备本地时间），HH:mm */
  entryTime?: string
  /** AI 初始识别类型；用于限制确认前的类型修正范围 */
  originalKind?: EntryKind
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
