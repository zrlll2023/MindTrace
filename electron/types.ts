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

interface SleepSessionContent {
  recordType: 'session'
  /** Local date and time, formatted as YYYY-MM-DD HH:mm. */
  startAt: string
  /** Local date and time, formatted as YYYY-MM-DD HH:mm. */
  endAt: string
  /** Derived from startAt/endAt and rounded to one decimal place. */
  hours: number
}

interface SleepDailyTotalContent {
  recordType: 'daily_total'
  date: string
  hours: number
}

/** Older and AI-parsed sleep entries may only contain a duration. */
interface SleepLegacyContent {
  hours: number
}

export type SleepContent = SleepSessionContent | SleepDailyTotalContent | SleepLegacyContent

export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  models: string[]
  note?: string
  /** 该提供商当前模型的官方文档地址，供界面「查看最新模型」使用 */
  docsUrl?: string
}

/**
 * 提供商预设的**兜底**默认值：选中后自动填 baseUrl（spec §7）。
 *
 * 真正的运行时预设来自 `resources/ai-providers.json`（随版本分发）或用户数据目录下的
 * `ai-providers.json`（自动刷新模型列表后写入），见 `electron/store/provider-presets.ts`。
 * 这里的常量仅在该两份文件都缺失或损坏时使用，保证应用仍能启动。
 *
 * 模型名会随服务商迭代下线，修改预设请改 resources/ai-providers.json，不必改动此文件。
 */
export const DEFAULT_PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-flash', 'deepseek-v4-pro'], docsUrl: 'https://api-docs.deepseek.com/quick_start/pricing' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2'], docsUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview' },
  { id: 'moonshot', name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'], docsUrl: 'https://platform.kimi.com/docs/models' },
  { id: 'siliconflow', name: 'SiliconFlow 硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V4.1-Flash', 'deepseek-ai/DeepSeek-V3.2', 'zai-org/GLM-5.3'], docsUrl: 'https://www.siliconflow.cn/pricing' },
  { id: 'ollama', name: 'Ollama（本机）', baseUrl: 'http://localhost:11434/v1', models: [], note: '无需 API Key', docsUrl: 'https://ollama.com/library' },
  { id: 'custom', name: '自定义', baseUrl: '', models: [] }
]

/** 兼容旧引用；等于 DEFAULT_PROVIDER_PRESETS，新代码请用 loadProviderPresets() */
export const PROVIDER_PRESETS: ProviderPreset[] = DEFAULT_PROVIDER_PRESETS

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
interface IdentityProviderOption {
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

/** 时间线合并行：record_type 区分记录条目与知识库操作流水。 */
export interface TimelineRow {
  record_type: 'entry' | 'knowledge'
  id: number
  event_date: string
  event_time: string | null
  created_at: string
  hidden_scope: string | null
  raw_text: string | null
  kind: string | null
  content: string | null
  confidence: number | null
  source: string | null
  item_id: number | null
  folder_id: number | null
  action: string | null
  item_title: string | null
  detail: string | null
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

/** 知识库文件夹与资料的共享数据契约。 */
export interface KbFolder {
  id: number
  name: string
  description: string
  system_key: string | null
  created_at: string
  sort_order: number | null
  tags: string[]
}

export interface KbItem {
  id: number
  folder_id: number
  title: string
  source_type: string // markdown | docx | pptx | xlsx | html | text
  body: string
  file_path: string
  reason: string
  reflection: string
  ai_summary: string
  source_entry_id: number | null
  import_key: string | null
  created_at: string
  updated_at: string
  title_locked: number | null
  tags: string[]
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

// ---------- AI 技能（提示词层，不写库） ----------

/**
 * 技能作用域 = 一个独立的 AI 调用区域。
 * 技能只注入自己所属的区域，跨区域一律不注入，避免不同页面互相污染。
 */
export type AiSkillScope = 'capture' | 'report.daily' | 'report.weekly' | 'research.plan'

export const AI_SKILL_SCOPES: AiSkillScope[] = ['capture', 'report.daily', 'report.weekly', 'research.plan']

export interface AiSkillScopeMeta {
  /** 界面上显示的技能区域名 */
  label: string
  /** 使用该区域 AI 的页面与动作 */
  surface: string
  /** 用户能感知的注入效果说明 */
  effect: string
}

export const AI_SKILL_SCOPE_META: Record<AiSkillScope, AiSkillScopeMeta> = {
  capture: {
    label: 'AI 快速记录',
    surface: '记录页 · AI 快速记录解析',
    effect: '影响随手记录的拆条粒度、措辞与类型判断习惯'
  },
  'report.daily': {
    label: '日报',
    surface: '研究页 · 生成该日日报',
    effect: '影响日报的观察角度、语气与小节内部的详略'
  },
  'report.weekly': {
    label: '周报',
    surface: '研究页 · 生成该周周报',
    effect: '影响周报的对比方式、趋势提炼与建议风格'
  },
  'research.plan': {
    label: '周度研究',
    surface: '研究页 · 周度研究计划出题',
    effect: '影响搜索词的提问角度与领域偏好'
  }
}

/** 技能容量上限：数值刻意偏低，保证注入不会挤占正文上下文导致输出降智 */
export const AI_SKILL_LIMITS = {
  /** 单个技能名称长度 */
  name: 24,
  /** 单个技能一句话说明长度 */
  description: 120,
  /** 单个技能指令正文长度 */
  content: 2000,
  /** 单个区域最多生效的技能数量 */
  perScope: 6,
  /** 单个区域注入的技能正文总长度 */
  injectChars: 4000,
  /** 全库技能总数上限 */
  total: 100
} as const

export interface AiSkill {
  id: string
  scope: AiSkillScope
  name: string
  /** 一句话说明这个技能是干什么的，仅用于界面展示，不注入 */
  description: string
  /** 注入给模型的指令正文 */
  content: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export function isAiSkillScope(value: unknown): value is AiSkillScope {
  return typeof value === 'string' && (AI_SKILL_SCOPES as string[]).includes(value)
}

/** 传给各 AI 链路的技能注入结果（block 已含安全声明与长度收敛） */
export interface AiSkillInjection {
  /** 追加到 system prompt 末尾的文本；无启用技能时为空串 */
  block: string
  /** 实际注入的技能，用于写进报告 meta 便于回溯 */
  skills: AiSkill[]
}

export const EMPTY_SKILL_INJECTION: AiSkillInjection = { block: '', skills: [] }
