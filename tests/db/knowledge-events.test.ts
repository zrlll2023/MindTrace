import { describe, it, expect } from 'vitest'
import { Database } from 'sql.js'
import { initDb } from '../../electron/db/connection'
import { KnowledgeBase, NewKbItem } from '../../electron/db/knowledge'

function events(db: Database): { action: string; title: string; detail: string; itemId: number | null }[] {
  const r = db.exec('SELECT action, item_title, detail, item_id FROM kb_events ORDER BY id')
  if (!r.length) return []
  return r[0].values.map(v => ({ action: String(v[0]), title: String(v[1]), detail: String(v[2]), itemId: v[3] as number | null }))
}

async function seeded(): Promise<{ db: Database; kb: KnowledgeBase; folderId: number }> {
  const db = await initDb(':memory:')
  const kb = new KnowledgeBase(db)
  return { db, kb, folderId: kb.addFolder('喜欢的句子').id }
}

const item = (folderId: number, title = '纸上得来终觉浅'): NewKbItem => ({
  folderId,
  title,
  sourceType: 'text',
  body: '绝知此事要躬行'
})

describe('知识库操作流水', () => {
  it('收录、修改、感受、总结、延伸、导入、删除各留一条流水', async () => {
    const { db, kb, folderId } = await seeded()
    const collected = kb.addItem(item(folderId))
    kb.addItem({ ...item(folderId, '导入的资料'), action: 'import' })
    kb.addItem({ ...item(folderId, '延伸的资料'), action: 'extend' })
    kb.updateItem(collected.id, { body: '改过的内容' })
    kb.updateReflection(collected.id, '这句话提醒我重实践')
    kb.updateSummary(collected.id, 'AI 摘要')
    kb.deleteItem(collected.id)

    const log = events(db)
    expect(log.map(e => e.action)).toEqual(['collect', 'import', 'extend', 'edit', 'reflect', 'summarize', 'delete'])
    expect(log[0]).toMatchObject({ title: '纸上得来终觉浅', itemId: collected.id })
    expect(log[3].detail).toBe('修改了内容')
    expect(log[4].detail).toBe('')
  })

  it('没有实质变更的保存既不写库也不留痕', async () => {
    const { db, kb, folderId } = await seeded()
    const created = kb.addItem(item(folderId))
    kb.updateItem(created.id, { body: '绝知此事要躬行' })
    kb.updateReflection(created.id, '')
    kb.updateItem(created.id, { reason: '提醒自己重实践' })
    expect(events(db).map(e => `${e.action}:${e.detail}`)).toEqual(['collect:', 'edit:修改了收录原因'])
  })

  it('删除资料后仍保留标题快照与资料 id，时间线点进去能说清去向', async () => {
    const { db, kb, folderId } = await seeded()
    const created = kb.addItem(item(folderId))
    kb.deleteItem(created.id)
    const last = events(db).at(-1)
    expect(last).toMatchObject({ action: 'delete', title: '纸上得来终觉浅', itemId: created.id, detail: '资料已被删除' })
  })

  it('删除文件夹只留一条流水，不让大批量删除刷屏', async () => {
    const { db, kb, folderId } = await seeded()
    kb.addItem(item(folderId, '资料一'))
    kb.addItem(item(folderId, '资料二'))
    kb.deleteFolder(folderId)
    const log = events(db)
    // 两条收录流水本来就在；删除只额外补一条，而不是逐条资料刷屏
    expect(log).toHaveLength(3)
    expect(log.slice(2)).toHaveLength(1)
    expect(log[2]).toMatchObject({ action: 'delete', itemId: null, title: '文件夹「喜欢的句子」', detail: '连同 2 条资料一起删除' })
  })

  it('由某条记录收录而来的资料不另记流水，避免时间线同一天出现两行', async () => {
    const { db, kb, folderId } = await seeded()
    kb.addItem({ ...item(folderId, '来自记录的资料'), sourceEntryId: 7 })
    kb.addItem({ ...item(folderId, '手动收录的资料') })
    kb.addItemFromQuickCapture({ folderId, title: 'AI 快速记录的资料', sourceType: 'entry', body: '内容', sourceEntryId: 8 })
    expect(events(db).map(e => e.title)).toEqual(['手动收录的资料'])
  })

  it('同一记录对应多份资料时按资料新旧倒序返回，跳转取最新一份', async () => {
    const { kb, folderId } = await seeded()
    const first = kb.addItem({ ...item(folderId, '先收录的'), sourceEntryId: 42 })
    const latest = kb.addItem({ ...item(folderId, '后收录的'), sourceEntryId: 42 })
    kb.addItem({ ...item(folderId, '无关资料'), sourceEntryId: 43 })
    expect(kb.findItemsForEntries([42, 999]).map(f => f.itemId)).toEqual([latest.id, first.id])
  })

  it('流水按本地时钟同时写入日期与时间，时间线无需再解析 created_at', async () => {
    const { db, kb, folderId } = await seeded()
    kb.addItem(item(folderId))
    const row = db.exec('SELECT event_date, event_time, created_at FROM kb_events')[0].values[0]
    expect(String(row[0])).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(String(row[1])).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    expect(`${row[0]} ${row[1]}`).toBe(String(row[2]).slice(0, 16))
  })
})
