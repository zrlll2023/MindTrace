import { describe, it, expect } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { Repo } from '../../electron/db/repository'

describe('repository', () => {
  it('插入并按类型查询 entry', async () => {
    const repo = new Repo(await initDb(':memory:'))
    await repo.insertEntry({
      raw_text: '睡了6.5小时',
      kind: 'sleep',
      content: JSON.stringify({ hours: 6.5 }),
      confidence: 0.9,
      source: 'chat'
    })
    const got = await repo.listEntries({ kind: 'sleep' })
    expect(got).toHaveLength(1)
    expect(got[0].raw_text).toBe('睡了6.5小时')
  })

  it('FTS/LIKE 兜底检索', async () => {
    const repo = new Repo(await initDb(':memory:'))
    await repo.insertEntry({
      raw_text: 'x',
      kind: 'idea',
      content: JSON.stringify({ text: 'RAG评估新方法' }),
      confidence: 1,
      source: 'chat'
    })
    expect((await repo.searchEntries('RAG')).length).toBe(1)
  })

  it('round-trip：insertEntry 返回带 id 和 created_at 的完整 Entry', async () => {
    const repo = new Repo(await initDb(':memory:'))
    const e = await repo.insertEntry({
      raw_text: '今天被导师骂了',
      kind: 'event',
      content: JSON.stringify({ text: '今天被导师骂了', negative: true }),
      confidence: 0.8,
      source: 'chat'
    })
    expect(e.id).toBeGreaterThan(0)
    expect(e.created_at).toBeTruthy()
    expect(e.raw_text).toBe('今天被导师骂了')
  })

  it('raw_text 不可通过 update 修改（接口层面只允许改 content）', async () => {
    const repo = new Repo(await initDb(':memory:'))
    const e = await repo.insertEntry({
      raw_text: '原始文本',
      kind: 'other',
      content: JSON.stringify({ text: '原始文本' }),
      confidence: 0,
      source: 'chat'
    })
    await repo.updateEntryContent(e.id, JSON.stringify({ text: '修正后的内容' }))
    const all = await repo.listEntries({})
    expect(all[0].raw_text).toBe('原始文本')
    expect(JSON.parse(all[0].content as string).text).toBe('修正后的内容')
  })

  it('报告写入与读取', async () => {
    const repo = new Repo(await initDb(':memory:'))
    const r = await repo.insertReport({
      type: 'daily',
      period: '2026-09-14',
      content_md: '# 日报',
      meta: '{}'
    })
    const got = await repo.getReport('daily', '2026-09-14')
    expect(got).not.toBeNull()
    expect(got!.content_md).toBe('# 日报')
    expect(got!.id).toBe(r.id)
  })

  it('设置读写', async () => {
    const repo = new Repo(await initDb(':memory:'))
    expect(await repo.getSetting('nonexistent')).toBeNull()
    await repo.setSetting('k', 'v1')
    await repo.setSetting('k', 'v2')
    expect(await repo.getSetting('k')).toBe('v2')
  })
})
