import { describe, it, expect } from 'vitest'
import { Database } from 'sql.js'
import { initDb } from '../../electron/db/connection'
import { Repo, NewEntry } from '../../electron/db/repository'
import { KnowledgeBase } from '../../electron/db/knowledge'
import { resolveEntryMoment } from '../../electron/timeline-moment'
import { dailyMetrics } from '../../electron/analysis/labs'

async function seededDb(): Promise<Repo> {
  const repo = new Repo(await initDb(':memory:'))
  const make = (raw: string, kind: NewEntry['kind'], date: string, content = {}): NewEntry => ({
    raw_text: raw,
    kind,
    content: JSON.stringify(content),
    confidence: 0.9,
    source: 'chat',
    // 直接指定 entry_date 以便测试日期过滤
    ...({ entry_date: date } as object)
  })
  const entries = [
    make('a', 'sleep', '2026-09-10', { hours: 7 }),
    make('b', 'idea', '2026-09-10', { text: 'i1' }),
    make('c', 'event', '2026-09-11', { text: 'e1' }),
    make('d', 'sleep', '2026-09-12', { hours: 6 }),
    make('e', 'quote', '2026-09-12', { text: 'q1' })
  ]
  for (const e of entries) {
    await repo.insertEntry(e)
  }
  return repo
}

describe('时间线查询', () => {
  it('按日期范围+类型组合过滤，created_at 倒序分页', async () => {
    const repo = await seededDb()
    const page1 = await repo.listEntries({
      dateFrom: '2026-09-10',
      dateTo: '2026-09-12',
      kind: 'sleep',
      limit: 1,
      offset: 0
    })
    const page2 = await repo.listEntries({
      dateFrom: '2026-09-10',
      dateTo: '2026-09-12',
      kind: 'sleep',
      limit: 1,
      offset: 1
    })
    expect(page1).toHaveLength(1)
    expect(page2).toHaveLength(1)
    expect(page1[0].id).not.toBe(page2[0].id)
    // 插入顺序 a(9-10) 在前 d(9-12) 在后 → 倒序时 d 在第一页
    expect(page1[0].entry_date).toBe('2026-09-12')
    expect(page2[0].entry_date).toBe('2026-09-10')
  })

  it('无过滤条件返回全部条目', async () => {
    const repo = await seededDb()
    const all = await repo.listEntries({})
    expect(all).toHaveLength(5)
  })

  it('同一天优先按发生时间倒序，未标时间按保存顺序排在后面', async () => {
    const repo = new Repo(await initDb(':memory:'))
    const base = { raw_text: 'r', kind: 'event' as const, content: JSON.stringify({ text: 'x' }), confidence: 1, source: 'chat', entry_date: '2026-09-16' }
    await repo.insertEntry({ ...base, content: JSON.stringify({ text: '未标时间' }) })
    await repo.insertEntry({ ...base, content: JSON.stringify({ text: '上午' }), entry_time: '09:00' })
    await repo.insertEntry({ ...base, content: JSON.stringify({ text: '晚上' }), entry_time: '20:30' })
    const entries = await repo.listEntries({})
    expect(entries.map(entry => entry.entry_time)).toEqual(['20:30', '09:00', null])
  })

  it('生活趋势将同日多个睡眠段求和而不是取平均', async () => {
    const repo = new Repo(await initDb(':memory:'))
    const base = { raw_text: 'sleep', kind: 'sleep' as const, confidence: 1, source: 'manual', entry_date: '2026-09-17' }
    await repo.insertEntry({ ...base, content: JSON.stringify({ recordType: 'session', startAt: '2026-09-16 23:00', endAt: '2026-09-17 06:00', hours: 7 }) })
    await repo.insertEntry({ ...base, content: JSON.stringify({ recordType: 'session', startAt: '2026-09-17 13:30', endAt: '2026-09-17 14:30', hours: 1 }) })
    const [day] = await dailyMetrics(repo, '2026-09-17', '2026-09-17')
    expect(day).toMatchObject({ sleep_hours: 8, sleep_sessions: 2, longest_sleep_hours: 7, sleep_data_mode: 'sessions' })
  })

  it('生活趋势区分未填写事件分类与明确的非负面事件', async () => {
    const repo = new Repo(await initDb(':memory:'))
    const base = { raw_text: 'event', kind: 'event' as const, confidence: 1, source: 'manual' }
    await repo.insertEntry({ ...base, entry_date: '2026-09-15', content: JSON.stringify({ text: '未分类事件' }) })
    await repo.insertEntry({ ...base, entry_date: '2026-09-16', content: JSON.stringify({ text: '普通事件', negative: false }) })
    await repo.insertEntry({ ...base, entry_date: '2026-09-16', content: JSON.stringify({ text: '负面事件', negative: true }) })

    const metrics = await dailyMetrics(repo, '2026-09-14', '2026-09-16')
    expect(metrics.find(day => day.date === '2026-09-14')).toMatchObject({ entry_count: 0, classified_event_count: 0, negative_count: 0 })
    expect(metrics.find(day => day.date === '2026-09-15')).toMatchObject({ entry_count: 1, classified_event_count: 0, negative_count: 0 })
    expect(metrics.find(day => day.date === '2026-09-16')).toMatchObject({ entry_count: 2, classified_event_count: 2, negative_count: 1 })
  })
})

describe('时间线合并知识库操作流水', () => {
  function addEvent(db: Database, event: { date: string; time?: string; action: string; title: string }): void {
    db.run(
      `INSERT INTO kb_events (item_id, folder_id, action, item_title, detail, event_date, event_time, created_at)
       VALUES (?, ?, ?, ?, '', ?, ?, ?)`,
      [1, 1, event.action, event.title, event.date, event.time ?? null, `${event.date} ${event.time ?? '00:00'}:00`]
    )
  }

  async function seededTimeline(): Promise<Repo> {
    const db = await initDb(':memory:')
    const repo = new Repo(db)
    const base = { raw_text: 'r', kind: 'event' as const, confidence: 1, source: 'chat' }
    await repo.insertEntry({ ...base, content: JSON.stringify({ text: '晚上记录' }), entry_date: '2026-09-16', entry_time: '21:00' })
    await repo.insertEntry({ ...base, content: JSON.stringify({ text: '未标时间记录' }), entry_date: '2026-09-16' })
    addEvent(db, { date: '2026-09-16', time: '09:30', action: 'collect', title: '早间收录的资料' })
    addEvent(db, { date: '2026-09-14', time: '20:00', action: 'reflect', title: '只有知识操作的那天' })
    return repo
  }

  it('记录与知识事件按发生时间倒序合成一条流，未标时间的行仍排在最后', async () => {
    const repo = await seededTimeline()
    const rows = await repo.listTimeline({ dateFrom: '2026-09-16', dateTo: '2026-09-16' })
    expect(rows.map(row => `${row.record_type}:${row.event_time ?? '未标'}`)).toEqual([
      'entry:21:00',
      'knowledge:09:30',
      'entry:未标'
    ])
    expect(rows[0]).toMatchObject({ raw_text: 'r', content: JSON.stringify({ text: '晚上记录' }) })
    expect(rows[1]).toMatchObject({ item_title: '早间收录的资料', action: 'collect', content: null })
  })

  it('只有知识事件、没写记录的那一天仍然出现在时间线', async () => {
    const repo = await seededTimeline()
    const rows = await repo.listTimeline({})
    expect(rows.filter(row => row.event_date === '2026-09-14').map(row => row.record_type)).toEqual(['knowledge'])
  })

  it('按记录类型筛选时不混入知识流水，record 为 knowledge 时只返流水', async () => {
    const repo = await seededTimeline()
    expect(await repo.listTimeline({ kind: 'event' })).toHaveLength(2)
    const onlyEvents = await repo.listTimeline({ record: 'knowledge' })
    expect(onlyEvents).toHaveLength(2)
    expect(onlyEvents.every(row => row.record_type === 'knowledge')).toBe(true)
    expect(await repo.listTimeline({ record: 'entry' })).toHaveLength(2)
  })

  it('合并分页共用一个游标，翻页不重不漏', async () => {
    const repo = await seededTimeline()
    const page1 = await repo.listTimeline({ limit: 2, offset: 0 })
    const page2 = await repo.listTimeline({ limit: 2, offset: 2 })
    const all = await repo.listTimeline({})
    const keys = (rows: Awaited<ReturnType<typeof repo.listTimeline>>) => rows.map(row => `${row.record_type}:${row.id}`)
    expect(keys([...page1, ...page2])).toEqual(keys(all))
    expect(new Set(keys(all)).size).toBe(all.length)
  })

  it('通过数据层收录资料会立刻产出一条 collect 流水', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const folder = kb.addFolder('喜欢的句子')
    const item = kb.addItem({ folderId: folder.id, title: '纸上得来终觉浅', sourceType: 'text', body: '绝知此事要躬行' })
    const rows = await new Repo(db).listTimeline({ record: 'knowledge' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'collect', item_title: '纸上得来终觉浅', item_id: item.id })
    expect(rows[0].event_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('listEntries 绝不掺入知识流水（统计与 AI 取数的回归底线）', async () => {
    const repo = await seededTimeline()
    const entries = await repo.listEntries({})
    expect(entries).toHaveLength(2)
    expect(entries.every(entry => typeof entry.content === 'string')).toBe(true)
  })

  it('把一条想法改到另一天并清空时间后，合并查询只在新日期出现它', async () => {
    const repo = new Repo(await initDb(':memory:'))
    const saved = await repo.insertEntry({
      raw_text: 'r', kind: 'idea', content: JSON.stringify({ text: '记错天的想法' }),
      confidence: 1, source: 'chat', entry_date: '2026-09-16', entry_time: '21:00'
    })
    // 复刻 timeline:updateContent 的取数与写库步骤，时间推导与校验由 resolveEntryMoment 承担
    const moment = resolveEntryMoment((await repo.getEntry(saved.id))!, { text: '记错天的想法' }, { entryDate: '2026-09-14', entryTime: '' })
    if (!moment.ok) throw new Error(moment.error)
    await repo.updateEntryContent(saved.id, saved.content, moment.moment.entryDate, moment.moment.entryTime)

    expect(await repo.getEntry(saved.id)).toMatchObject({ entry_date: '2026-09-14', entry_time: null })
    const rows = await repo.listTimeline({ dateFrom: '2026-09-14', dateTo: '2026-09-16' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ record_type: 'entry', event_date: '2026-09-14', event_time: null })
  })
})
