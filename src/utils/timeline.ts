import type { KbAction, TimelineRow } from '../../electron/types'
import { parseSleepContent } from './sleep'
import type { SleepDisplay } from './sleep'

export interface EntryRow {
  id: number
  raw_text: string
  kind: string
  content: string
  confidence: number
  created_at: string
  entry_date: string
  entry_time: string | null
  hidden_scope?: string | null
  _score?: number
  _rerank?: number
  _chunk?: string
}
export interface KnowledgeRow {
  id: number
  itemId: number | null
  action: KbAction
  itemTitle: string
  detail: string
  eventDate: string
  eventTime: string | null
  hiddenScope: string | null
}
interface SleepSegment { entry: EntryRow; sleep: SleepDisplay }
export interface SleepDayItem {
  type: 'sleep-day'
  key: string
  date: string
  segments: SleepSegment[]
  totalHours: number
  sessionCount: number
  longestHours: number | null
  sortTime: string
}
interface EntryItem { type: 'entry'; key: string; entry: EntryRow; sortTime: string }
interface KnowledgeItem { type: 'knowledge'; key: string; eventId: number; itemId: number | null; action: KbAction; itemTitle: string; detail: string; sortTime: string; hiddenScope: string | null }
export interface ChatItem { type: 'chat'; key: string; sessionId: string; title: string; sortTime: string; messageCount: number; tokenCount: number; status: string; hiddenScope: string | null }
export type TimelineItem = SleepDayItem | EntryItem | KnowledgeItem | ChatItem
export interface ChatSessionRow {
  id: string
  title: string
  status: 'active' | 'archived'
  createdAt: string
  lastMessageAt: string | null
  messageCount: number
  tokenCount: number
  hiddenScope: string | null
}

function chatDisplayDate(s: ChatSessionRow): string {
  return (s.lastMessageAt || s.createdAt || '').slice(0, 10)
}
function makeSleepDay(date: string, segments: SleepSegment[]): SleepDayItem {
  const dailyTotal = segments.find(segment => segment.sleep.mode === 'daily_total')
  const totalHours = dailyTotal?.sleep.hours ?? segments.reduce((sum, segment) => sum + segment.sleep.hours, 0)
  const sessions = segments.filter(segment => segment.sleep.mode === 'session')
  return {
    type: 'sleep-day',
    key: `sleep-${date}`,
    date,
    segments,
    totalHours: Math.round(totalHours * 10) / 10,
    sessionCount: sessions.length,
    longestHours: sessions.length ? Math.max(...sessions.map(segment => segment.sleep.hours)) : null,
    sortTime: segments.map(segment => segment.entry.entry_time ?? '').sort().at(-1) ?? ''
  }
}
export function toEntryRow(row: TimelineRow): EntryRow {
  return {
    id: row.id,
    raw_text: row.raw_text ?? '',
    kind: row.kind ?? 'other',
    content: row.content ?? '{}',
    confidence: row.confidence ?? 0,
    created_at: row.created_at,
    entry_date: row.event_date,
    entry_time: row.event_time,
    hidden_scope: row.hidden_scope
  }
}
export function toKnowledgeRow(row: TimelineRow): KnowledgeRow {
  return {
    id: row.id,
    itemId: row.item_id,
    action: (row.action ?? 'collect') as KbAction,
    itemTitle: row.item_title ?? '',
    detail: row.detail ?? '',
    eventDate: row.event_date,
    eventTime: row.event_time,
    hiddenScope: row.hidden_scope
  }
}

interface TimelineGroupingInput {
  entries: readonly EntryRow[]
  kbEvents: readonly KnowledgeRow[]
  chatSessions: readonly ChatSessionRow[]
  searching: boolean
  kind: string | null
  onlyKnowledge: boolean
  showHidden: boolean
  dateFrom: string
  dateTo: string
}

export function buildTimelineGroups(input: TimelineGroupingInput) {
  const { entries, kbEvents, chatSessions, searching, kind, onlyKnowledge, showHidden, dateFrom, dateTo } = input

  const map = new Map<string, EntryRow[]>()
  for (const e of entries) {
    const arr = map.get(e.entry_date) ?? []
    arr.push(e)
    map.set(e.entry_date, arr)
  }
  // 流水与对话都不参与全文/语义检索；按记录类型筛选时两者都隐藏
  const showEvents = !searching && !kind
  const mergeChats = showEvents && !onlyKnowledge
  const eventMap = new Map<string, KnowledgeRow[]>()
  if (showEvents) {
    for (const event of kbEvents) {
      const arr = eventMap.get(event.eventDate) ?? []
      arr.push(event)
      eventMap.set(event.eventDate, arr)
    }
  }
  const chatMap = new Map<string, ChatSessionRow[]>()
  if (mergeChats) {
    for (const s of chatSessions) {
      // 会话不上主查询游标，隐去状态在这里对齐当前视图
      if ((s.hiddenScope != null) !== showHidden) continue
      const date = chatDisplayDate(s)
      if (!date) continue
      if (dateFrom && date < dateFrom) continue
      if (dateTo && date > dateTo) continue
      const arr = chatMap.get(date) ?? []
      arr.push(s)
      chatMap.set(date, arr)
    }
  }
  // 回收视图逐条列出睡眠记录，否则它们会合成当天卡片而没法单条恢复
  const aggregateSleep = !showHidden
  const dates = [...new Set([...map.keys(), ...eventMap.keys(), ...chatMap.keys()])]
  return dates
    .sort((a, b) => (a < b ? 1 : -1))
    .map(date => {
      const records = map.get(date) ?? []
      const events = eventMap.get(date) ?? []
      const items: TimelineItem[] = records
        .filter(entry => !aggregateSleep || entry.kind !== 'sleep')
        .map(entry => ({ type: 'entry', key: `entry-${entry.id}`, entry, sortTime: entry.entry_time ?? '' }))
      const segments = aggregateSleep
        ? records
          .filter(entry => entry.kind === 'sleep')
          .map(entry => ({ entry, sleep: parseSleepContent(entry.content) }))
          .filter((value): value is SleepSegment => value.sleep !== null)
        : []
      if (segments.length) items.push(makeSleepDay(date, segments))
      for (const event of events) {
        items.push({
          type: 'knowledge',
          key: `kb-${event.id}`,
          eventId: event.id,
          itemId: event.itemId,
          action: event.action,
          itemTitle: event.itemTitle,
          detail: event.detail,
          sortTime: event.eventTime ?? '',
          hiddenScope: event.hiddenScope
        })
      }
      for (const s of chatMap.get(date) ?? []) {
        const ts = s.lastMessageAt || s.createdAt || ''
        items.push({ type: 'chat', key: `chat-${s.id}`, sessionId: s.id, title: s.title, sortTime: ts.slice(11, 16), messageCount: s.messageCount, tokenCount: s.tokenCount, status: s.status, hiddenScope: s.hiddenScope })
      }
      items.sort((a, b) => b.sortTime.localeCompare(a.sortTime) || b.key.localeCompare(a.key))
      return { date, items, recordCount: records.length + events.length + (chatMap.get(date)?.length ?? 0) }
    })
}
