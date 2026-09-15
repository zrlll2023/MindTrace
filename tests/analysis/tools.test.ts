import { describe, it, expect } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { Repo } from '../../electron/db/repository'
import { createTools } from '../../electron/analysis/tools'

async function seededRepo(): Promise<Repo> {
  const repo = new Repo(await initDb(':memory:'))
  const rows: [string, string, Record<string, unknown>, string][] = [
    ['a', 'sleep', { hours: 5 }, '2026-09-01'],
    ['b', 'event', { text: '吵架', negative: true }, '2026-09-01'],
    ['c', 'sleep', { hours: 8 }, '2026-09-02'],
    ['d', 'event', { text: '平静', negative: false }, '2026-09-02'],
    ['e', 'sleep', { hours: 4 }, '2026-09-03'],
    ['f', 'event', { text: '被骂', negative: true }, '2026-09-03'],
    ['g', 'idea', { text: 'RAG评估' }, '2026-09-03'],
    ['h', 'quote', { text: '纸上得来终觉浅' }, '2026-09-04']
  ]
  for (const [raw, kind, content, date] of rows) {
    await repo.insertEntry({
      raw_text: raw,
      kind: kind as never,
      content: JSON.stringify(content),
      confidence: 0.9,
      source: 'chat',
      entry_date: date
    })
  }
  return repo
}

describe('analysis tools', () => {
  it('query_entries 按关键词检索返回条目', async () => {
    const repo = await seededRepo()
    const tools = createTools(repo)
    const out = JSON.parse(await tools.query_entries({ keyword: 'RAG' }))
    expect(out.count).toBe(1)
    expect(out.entries[0].content.text).toContain('RAG')
  })

  it('query_entries 按类型+日期范围检索', async () => {
    const repo = await seededRepo()
    const tools = createTools(repo)
    const out = JSON.parse(
      await tools.query_entries({ kind: 'sleep', dateFrom: '2026-09-01', dateTo: '2026-09-03' })
    )
    expect(out.count).toBe(3)
  })

  it('correlate 计算睡眠时长与负面事件数的负相关', async () => {
    const repo = await seededRepo()
    const tools = createTools(repo)
    const r = JSON.parse(
      await tools.correlate({
        metricA: 'sleep.hours',
        metricB: 'event.negative_count',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-03'
      })
    )
    // 睡得少的日期负面事件多（9-1: 5h/1负面, 9-2: 8h/0, 9-3: 4h/1）
    expect(r.coefficient).toBeLessThan(-0.5)
  })

  it('correlate 数据不足时返回 insufficient_data', async () => {
    const repo = await seededRepo()
    const tools = createTools(repo)
    const r = JSON.parse(
      await tools.correlate({
        metricA: 'sleep.hours',
        metricB: 'event.negative_count',
        dateFrom: '2026-09-04',
        dateTo: '2026-09-04'
      })
    )
    expect(r.error).toBe('insufficient_data')
  })
})
