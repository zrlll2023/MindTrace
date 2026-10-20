import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import type { TimelineRow } from '../electron/types'
import { buildTimelineGroups, toEntryRow, toKnowledgeRow } from '../src/utils/timeline'
import type { ChatSessionRow, EntryRow, KnowledgeRow } from '../src/utils/timeline'

function entry(id: number, extra: Partial<EntryRow> = {}): EntryRow {
  return { id, raw_text: '原始记录', kind: 'idea', content: '{"text":"原始记录"}', confidence: 0.9,
    created_at: '2026-10-19 12:00:00', entry_date: '2026-10-19', entry_time: '10:00', hidden_scope: null, ...extra }
}
function chat(id: string, extra: Partial<ChatSessionRow> = {}): ChatSessionRow {
  return { id, title: '对话', status: 'archived', createdAt: '2026-10-18 08:00:00',
    lastMessageAt: '2026-10-19 10:00:00', messageCount: 2, tokenCount: 12, hiddenScope: null, ...extra }
}
function event(id: number, extra: Partial<KnowledgeRow> = {}): KnowledgeRow {
  return { id, itemId: null, action: 'delete', itemTitle: '已删除资料', detail: '保留历史',
    eventDate: '2026-10-19', eventTime: '10:00', hiddenScope: null, ...extra }
}
function input(extra: Partial<Parameters<typeof buildTimelineGroups>[0]> = {}) {
  return { entries: [] as readonly EntryRow[], kbEvents: [] as readonly KnowledgeRow[], chatSessions: [] as readonly ChatSessionRow[],
    searching: false, kind: null as string | null, onlyKnowledge: false, showHidden: false, dateFrom: '', dateTo: '', ...extra }
}
function row(extra: Partial<TimelineRow> = {}): TimelineRow {
  return { record_type: 'entry', id: 1, event_date: '2026-10-19', event_time: null, created_at: '2026-10-19 12:00:00',
    hidden_scope: null, raw_text: null, kind: null, content: null, confidence: null, source: null, item_id: null,
    folder_id: null, action: null, item_title: null, detail: null, ...extra }
}
const items = (data: Parameters<typeof buildTimelineGroups>[0]) => buildTimelineGroups(data).flatMap(day => day.items)
const sleep = (id: number, content: unknown, extra: Partial<EntryRow> = {}) => entry(id, { kind: 'sleep', content: JSON.stringify(content), ...extra })

describe('时间线行映射', () => {
  it('空字段采用原默认值并保留日期与隐藏范围', () => {
    expect(toEntryRow(row({ hidden_scope: 'listing' }))).toEqual({ id: 1, raw_text: '', kind: 'other', content: '{}', confidence: 0,
      created_at: '2026-10-19 12:00:00', entry_date: '2026-10-19', entry_time: null, hidden_scope: 'listing' })
    expect(toKnowledgeRow(row())).toEqual({ id: 1, itemId: null, action: 'collect', itemTitle: '', detail: '',
      eventDate: '2026-10-19', eventTime: null, hiddenScope: null })
  })
  it('不以默认值覆盖有效的空串、零或具体操作', () => {
    const source = Object.freeze(row({ raw_text: '', kind: '', content: '', confidence: 0, action: 'delete', item_title: '', detail: '' }))
    expect(toEntryRow(source)).toMatchObject({ raw_text: '', kind: '', content: '', confidence: 0 })
    expect(toKnowledgeRow(source)).toMatchObject({ action: 'delete', itemId: null, itemTitle: '', detail: '' })
    expect(toEntryRow(source)).not.toBe(source)
  })
})

describe('时间线日期与混合顺序', () => {
  it('空输入不产生日期卡片', () => expect(buildTimelineGroups(input())).toEqual([]))
  it('日期倒序，同刻按字符串键倒序，条数统计原始行', () => {
    const groups = buildTimelineGroups(input({ entries: [entry(10), entry(2), entry(3, { entry_date: '2026-10-18', entry_time: null })],
      kbEvents: [event(1)], chatSessions: [chat('a')] }))
    expect(groups.map(day => day.date)).toEqual(['2026-10-19', '2026-10-18'])
    expect(groups[0].items.map(item => item.key)).toEqual(['kb-1', 'entry-2', 'entry-10', 'chat-a'])
    expect(groups[0].recordCount).toBe(4)
    expect(groups[1].items[0].sortTime).toBe('')
  })
  it('不在分组内重新过滤上游记录与知识行', () => {
    const groups = buildTimelineGroups(input({ entries: [entry(1, { kind: 'quote', entry_date: '2026-10-17', hidden_scope: 'all' })],
      kbEvents: [event(2, { eventDate: '2026-10-16' })], dateFrom: '2026-10-19', dateTo: '2026-10-19', onlyKnowledge: true }))
    expect(groups.map(day => day.date)).toEqual(['2026-10-17', '2026-10-16'])
    expect(groups[0].items[0].type).toBe('entry')
  })
  it('冻结输入不会被排序或改写，记录身份和搜索附加字段保持', () => {
    const original = Object.freeze(entry(1, { _score: 0.7, _rerank: 0.9, _chunk: '命中片段' }))
    const entries = Object.freeze([original])
    const data = Object.freeze(input({ entries, kbEvents: Object.freeze([Object.freeze(event(1))]), chatSessions: Object.freeze([Object.freeze(chat('a'))]) }))
    const grouped = items(data).find(item => item.type === 'entry')
    expect(grouped?.type === 'entry' && grouped.entry).toBe(original)
    expect(grouped?.type === 'entry' && grouped.entry).toMatchObject({ _score: 0.7, _rerank: 0.9, _chunk: '命中片段' })
    expect(entries).toEqual([original])
  })
})

describe('时间线筛选与会话', () => {
  it.each(Array.from({ length: 64 }, (_, mask) => mask))('六个筛选开关组合 %i 保持独立边界', mask => {
    const searching = !!(mask & 1), kind = mask & 2 ? 'sleep' : null, onlyKnowledge = !!(mask & 4), showHidden = !!(mask & 8)
    const dateFrom = mask & 16 ? '2026-10-19' : '', dateTo = mask & 32 ? '2026-10-19' : ''
    const result = items(input({ entries: [entry(1)], kbEvents: [event(1)], chatSessions: [chat('visible'), chat('hidden', { hiddenScope: 'timeline' }),
      chat('older', { lastMessageAt: '2026-10-18 10:00:00' }), chat('newer', { lastMessageAt: '2026-10-20 10:00:00' })],
      searching, kind, onlyKnowledge, showHidden, dateFrom, dateTo }))
    expect(result.some(item => item.type === 'entry')).toBe(true)
    expect(result.filter(item => item.type === 'knowledge')).toHaveLength(searching || kind ? 0 : 1)
    const expectedChats = searching || kind || onlyKnowledge ? [] : showHidden ? ['chat-hidden'] :
      ['chat-visible', ...(!dateFrom ? ['chat-older'] : []), ...(!dateTo ? ['chat-newer'] : [])]
    expect(result.filter(item => item.type === 'chat').map(item => item.key).sort()).toEqual(expectedChats.sort())
  })
  it('会话优先使用最后消息，回退创建时间，空日期跳过且包含范围端点', () => {
    const result = items(input({ chatSessions: [chat('last'), chat('created', { lastMessageAt: null, createdAt: '2026-10-19 08:00:00', status: 'active' }),
      chat('empty', { lastMessageAt: null, createdAt: '' })], dateFrom: '2026-10-19', dateTo: '2026-10-19' }))
    expect(result.map(item => item.key)).toEqual(['chat-last', 'chat-created'])
    expect(result[1]).toMatchObject({ type: 'chat', sortTime: '08:00', status: 'active', messageCount: 2, tokenCount: 12 })
  })
  it('任意非 null 的会话隐藏范围都属于隐藏视图', () => {
    const result = items(input({ showHidden: true, chatSessions: [chat('a', { hiddenScope: '' }), chat('b', { hiddenScope: 'all' }), chat('visible')] }))
    expect(result.map(item => item.key)).toEqual(['chat-b', 'chat-a'])
  })
})

describe('时间线睡眠卡片', () => {
  it('首条当天累计覆盖时长，保留旧版和分段、最长时长与时间排序', () => {
    const records = [sleep(1, { recordType: 'daily_total', date: '2026-10-19', hours: 8 }, { entry_time: null }),
      sleep(2, { recordType: 'daily_total', date: '2026-10-19', hours: 12 }),
      sleep(3, { recordType: 'session', startAt: '2026-10-18 23:00', endAt: '2026-10-19 06:00', hours: 7 }, { entry_time: '06:00' }),
      sleep(4, { hours: 2 }, { entry_time: '11:00' })]
    expect(items(input({ entries: records }))[0]).toMatchObject({ type: 'sleep-day', key: 'sleep-2026-10-19', totalHours: 8,
      sessionCount: 1, longestHours: 7, sortTime: '11:00' })
    const item = items(input({ entries: records }))[0]
    expect(item.type === 'sleep-day' && item.segments.map(segment => segment.entry)).toEqual(records)
  })
  it('无当天累计时累加有效睡眠并四舍五入至一位小数', () => {
    expect(items(input({ entries: [sleep(1, { hours: 1.24 }), sleep(2, { hours: 1.24 })] }))[0])
      .toMatchObject({ type: 'sleep-day', totalHours: 2.5, sessionCount: 0, longestHours: null })
  })
  it('损坏睡眠在普通视图不显示，但条数仍统计', () => {
    const groups = buildTimelineGroups(input({ entries: [entry(1, { kind: 'sleep', content: 'broken' }), sleep(2, { text: '无时长' })] }))
    expect(groups).toEqual([{ date: '2026-10-19', items: [], recordCount: 2 }])
  })
  it('隐藏视图保留每一条睡眠对象以便恢复，包括损坏内容', () => {
    const records = [sleep(1, { hours: 7 }), entry(2, { kind: 'sleep', content: 'broken', hidden_scope: 'all' })]
    const result = items(input({ entries: records, showHidden: true }))
    expect(result.map(item => item.type)).toEqual(['entry', 'entry'])
    expect(result.find(item => item.key === 'entry-2')).toMatchObject({ entry: records[1] })
  })
})

describe('时间线响应式接线契约', () => {
  it('computed 内读取全部九项输入，数据和筛选变化后重新生成', () => {
    const entries = ref<EntryRow[]>([]), kbEvents = ref<KnowledgeRow[]>([]), chatSessions = ref<ChatSessionRow[]>([])
    const searching = ref(false), kind = ref<string | null>(null), onlyKnowledge = ref(false), showHidden = ref(false), dateFrom = ref(''), dateTo = ref('')
    const groups = computed(() => buildTimelineGroups({ entries: entries.value, kbEvents: kbEvents.value, chatSessions: chatSessions.value,
      searching: searching.value, kind: kind.value, onlyKnowledge: onlyKnowledge.value, showHidden: showHidden.value, dateFrom: dateFrom.value, dateTo: dateTo.value }))
    const count = () => groups.value.flatMap(day => day.items).length
    expect(count()).toBe(0)
    entries.value.push(entry(1)); expect(count()).toBe(1)
    kbEvents.value.push(event(1)); expect(count()).toBe(2)
    chatSessions.value.push(chat('a')); expect(count()).toBe(3)
    searching.value = true; expect(count()).toBe(1)
    searching.value = false; kind.value = 'idea'; expect(count()).toBe(1)
    kind.value = null; onlyKnowledge.value = true; expect(count()).toBe(2)
    onlyKnowledge.value = false; showHidden.value = true; expect(count()).toBe(2)
    showHidden.value = false; dateFrom.value = '2026-10-20'; expect(count()).toBe(2)
    dateFrom.value = ''; dateTo.value = '2026-10-18'; expect(count()).toBe(2)
    dateTo.value = ''; expect(count()).toBe(3)
  })
})
