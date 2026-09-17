import { describe, it, expect } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { Repo, NewEntry } from '../../electron/db/repository'
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
