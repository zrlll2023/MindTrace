import { describe, it, expect } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { Repo, NewEntry } from '../../electron/db/repository'

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
})
