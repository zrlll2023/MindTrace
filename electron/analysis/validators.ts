/**
 * AI 内容契约的运行时强制层（docs/ai-content-contract.md）。
 * 所有 AI 产出进入存储前的唯一闸门——校验失败一律走兜底，绝不崩溃、绝不丢用户原文。
 */
import { EntryKind } from '../types'

export const KIND_VALUES: EntryKind[] = ['sleep', 'event', 'conversation', 'quote', 'idea', 'other']

const MAX_TEXT = 2000
const MAX_REPORT_MD = 50000
const MAX_THREAD_TITLE = 60
const MAX_THREAD_DESC = 300

/** 严格校验本地日期和可选分钟时间，避免 SQLite 接收自动进位的日期。 */
export function validateEntryMoment(entryDate: unknown, entryTime: unknown): { ok: boolean; reason?: string } {
  if (typeof entryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    return { ok: false, reason: '日期格式应为 YYYY-MM-DD' }
  }
  const [year, month, day] = entryDate.split('-').map(Number)
  const probe = new Date(year, month - 1, day)
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return { ok: false, reason: '发生日期无效' }
  }
  if (entryTime != null && entryTime !== '' && (typeof entryTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entryTime))) {
    return { ok: false, reason: '发生时间格式应为 HH:mm' }
  }
  return { ok: true }
}

/** 纯文本净化：剥离 HTML 标签与 Markdown 标记，截断到上限 */
export function sanitizeText(input: unknown): string {
  if (typeof input !== 'string') return ''
  let t = input
    // HTML 标签整体剥离
    .replace(/<[^>]*>/g, '')
    // 常见 Markdown 标记剥离（保留链接文本与 URL 圆括号内容）
    .replace(/(\*\*|__|\*|_|`|~~)/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1($2)')
  if (t.length > MAX_TEXT) t = t.slice(0, MAX_TEXT)
  return t
}

export interface ValidatedEntry {
  kind: EntryKind
  content: Record<string, unknown>
  confidence: number
}

export type ValidateResult<T> =
  | { ok: true; entry?: T; payload?: T }
  | { ok: false; reason: string }

/** content 键白名单（契约 §2） */
const CONTENT_KEYS: Record<EntryKind, string[]> = {
  sleep: ['hours', 'recordType', 'startAt', 'endAt', 'date'],
  event: ['text', 'negative'],
  conversation: ['text', 'with', 'role', 'conversation'],
  quote: ['text', 'from'],
  idea: ['text'],
  other: ['text']
}
const TEXTUAL_KEYS = ['text', 'with', 'from', 'conversation', 'role']

/** 校验单条解析条目（契约 §2）。失败返回 ok:false，调用方负责兜底为 other。 */
export function validateParsedEntry(raw: unknown): { ok: boolean; entry?: ValidatedEntry; reason?: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'not-an-object' }
  const e = raw as Record<string, unknown>

  const kind = e.kind as EntryKind
  if (!KIND_VALUES.includes(kind)) return { ok: false, reason: `bad-kind:${String(e.kind)}` }
  if (typeof e.content !== 'object' || e.content === null || Array.isArray(e.content)) {
    return { ok: false, reason: 'content-not-object' }
  }

  const src = e.content as Record<string, unknown>

  if (kind === 'sleep') {
    const normalized = normalizeSleepContent(src)
    if (!normalized.ok) return normalized
    let confidence = typeof e.confidence === 'number' && isFinite(e.confidence) ? e.confidence : 0.5
    confidence = Math.min(1, Math.max(0, confidence))
    return { ok: true, entry: { kind, content: normalized.content, confidence } }
  }

  const allowed = CONTENT_KEYS[kind]
  const out: Record<string, unknown> = {}
  const dropped: string[] = []

  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith('_')) {
      dropped.push(k) // 系统保留前缀
      continue
    }
    if (!allowed.includes(k)) {
      dropped.push(k) // 未知键丢弃（契约 §2）
      continue
    }
    if (TEXTUAL_KEYS.includes(k)) {
      const s = sanitizeText(v)
      if (k === 'text' && !s) return { ok: false, reason: 'empty-text' }
      out[k] = s
    } else if (k === 'hours') {
      if (typeof v !== 'number' || !isFinite(v) || v <= 0 || v > 24) {
        return { ok: false, reason: 'hours-out-of-range' }
      }
      out[k] = Math.round(v * 10) / 10
    } else if (k === 'negative') {
      out[k] = v === true
    }
  }

  let confidence = typeof e.confidence === 'number' && isFinite(e.confidence) ? e.confidence : 0.5
  confidence = Math.min(1, Math.max(0, confidence))

  // sleep 已在上方提前返回，其余类型全部要求 text 字段（契约 §2）
  if (typeof out.text !== 'string' || !out.text) return { ok: false, reason: 'empty-text' }

  if (dropped.length) out._dropped = dropped
  return { ok: true, entry: { kind, content: out, confidence } }
}

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/

function validLocalDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCAL_DATE_TIME.test(value)) return false
  const [date, time] = value.split(' ')
  return validateEntryMoment(date, time).ok
}

function roundedHours(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 24) return null
  return Math.round(value * 10) / 10
}

/** Normalize every accepted sleep shape. Session duration is always server-derived. */
export function normalizeSleepContent(src: Record<string, unknown>):
  | { ok: true; content: Record<string, unknown> }
  | { ok: false; reason: string } {
  if (src.recordType === 'session') {
    if (!validLocalDateTime(src.startAt) || !validLocalDateTime(src.endAt)) {
      return { ok: false, reason: 'sleep-session-time-invalid' }
    }
    const start = new Date(src.startAt.replace(' ', 'T'))
    const end = new Date(src.endAt.replace(' ', 'T'))
    const hours = Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 10) / 10
    if (hours <= 0 || hours > 24) return { ok: false, reason: 'hours-out-of-range' }
    return { ok: true, content: { recordType: 'session', startAt: src.startAt, endAt: src.endAt, hours } }
  }

  if (src.recordType === 'daily_total') {
    const dateCheck = validateEntryMoment(src.date, undefined)
    const hours = roundedHours(src.hours)
    if (!dateCheck.ok) return { ok: false, reason: 'sleep-total-date-invalid' }
    if (hours == null) return { ok: false, reason: 'hours-out-of-range' }
    return { ok: true, content: { recordType: 'daily_total', date: src.date, hours } }
  }

  const hours = roundedHours(src.hours)
  if (hours == null) return { ok: false, reason: 'hours-out-of-range' }
  return { ok: true, content: { hours } }
}

export interface ValidatedThread {
  title: string
  description: string
  status: 'active' | 'done'
  linked_entry_ids: number[]
}

/** 校验报告 JSON 载荷（契约 §3）。结构损坏整体拒绝；thread 级问题就地修复。 */
export function validateReportPayload(raw: unknown): {
  ok: boolean
  payload?: { report_md: string; threads: ValidatedThread[] }
  reason?: string
} {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'not-an-object' }
  const p = raw as Record<string, unknown>

  if (typeof p.report_md !== 'string' || !p.report_md.trim()) {
    return { ok: false, reason: 'report-md-missing' }
  }
  if (p.report_md.length > MAX_REPORT_MD) return { ok: false, reason: 'report-md-too-long' }

  const threads: ValidatedThread[] = []
  if (Array.isArray(p.threads)) {
    for (const t of p.threads) {
      if (typeof t !== 'object' || t === null) continue
      const th = t as Record<string, unknown>
      const title = sanitizeText(th.title).slice(0, MAX_THREAD_TITLE)
      if (!title) continue
      const status = th.status === 'done' ? 'done' : 'active'
      const ids = Array.isArray(th.linked_entry_ids)
        ? th.linked_entry_ids.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
        : []
      threads.push({
        title,
        description: sanitizeText(th.description).slice(0, MAX_THREAD_DESC),
        status,
        linked_entry_ids: ids
      })
    }
  }

  return { ok: true, payload: { report_md: p.report_md, threads } }
}
