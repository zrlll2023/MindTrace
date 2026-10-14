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

// ---------- 账号关联：外部身份锚点 ----------

/** 支持关联的身份平台；顺序即界面展示顺序 */
export type IdentityProvider = 'github' | 'gitee'
export const IDENTITY_PROVIDERS: IdentityProvider[] = ['github', 'gitee']

/**
 * 平台返回的权威身份。
 * providerUserId 是平台侧不可变的数字 ID（不是会改的登录名），
 * 它就是「账号唯一性」判定与未来跨设备身份锚点的唯一依据。
 */
export interface ProviderIdentity {
  provider: IdentityProvider
  providerUserId: string
  login: string
  displayName: string
  avatarUrl: string
  profileUrl: string
}

/** 本机已关联的外部账号（在权威身份之上补上关联与校验时间） */
export interface LinkedAccount extends ProviderIdentity {
  /** 首次关联时间（ISO 字符串） */
  linkedAt: string
  /** 最近一次通过平台校验的时间（ISO 字符串） */
  verifiedAt: string
}

/** 平台元信息：由主进程提供，渲染层只负责展示 */
export interface IdentityProviderOption {
  id: IdentityProvider
  label: string
  /** 官方令牌创建页，界面按钮直接打开 */
  tokenUrl: string
  tokenHint: string
  scopes: string
  linked: boolean
}

/** 账号关联总览：账号列表 + 由全部账号派生的本机身份指纹 */
export interface AccountSummary {
  accounts: LinkedAccount[]
  /** 无任何已关联账号时为空串 */
  fingerprint: string
  providers: IdentityProviderOption[]
}

export type SearchProvider = 'none' | 'tavily' | 'bocha'

export interface ResearchPlanDraft {
  weekKey: string
  /** 用户写下的本周研究需求：AI 必须据此出题，不得替换成自己推测的主题 */
  requirement: string
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
  /** 只看记录条目或只看知识库操作流水；缺省时两者按发生时间合并 */
  record?: 'entry' | 'knowledge'
  /** 打开后只列出已隐去的行，用于查看与恢复显示 */
  showHidden?: boolean
}

/**
 * 时间线隐去范围：只改变可见性，内容一律原样保留。
 * all 为默认选择，真正意义上「抹除这件事的存在」但仍可恢复。
 */
export type HideScope = 'all' | 'listing' | 'timeline'

export const HIDE_SCOPES: HideScope[] = ['all', 'listing', 'timeline']

export const HIDE_SCOPE_LABELS: Record<HideScope, string> = {
  all: '所有回溯视图都隐去（时间线、搜索、报告与趋势）',
  listing: '隐去时间线与搜索，报告与趋势仍统计',
  timeline: '仅时间线列表隐去，搜索与统计仍算'
}

/** 知识库操作类型；与 kb_events 的 CHECK 约束保持一致 */
export type KbAction = 'collect' | 'edit' | 'reflect' | 'summarize' | 'extend' | 'import' | 'delete'

export const KB_ACTION_LABELS: Record<KbAction, string> = {
  collect: '收录资料',
  edit: '修改资料',
  reflect: '写下感受',
  summarize: 'AI 总结',
  extend: 'AI 延伸',
  import: '导入资料',
  delete: '删除资料'
}

export interface GenerateReportResult {
  ok: boolean
  error?: string
  reportId?: number
}
