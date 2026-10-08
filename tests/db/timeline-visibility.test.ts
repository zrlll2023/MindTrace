import { describe, it, expect } from 'vitest'
import { Database } from 'sql.js'
import { initDb } from '../../electron/db/connection'
import { Repo } from '../../electron/db/repository'
import { KnowledgeBase } from '../../electron/db/knowledge'
import { CaptureHistory } from '../../electron/db/capture'
import { dailyMetrics } from '../../electron/analysis/labs'

const TEXT = '一次不想出现在时间线里的谈话'

async function seededIdea(scope: 'all' | 'listing' | 'timeline'): Promise<{ repo: Repo; id: number }> {
  const repo = new Repo(await initDb(':memory:'))
  const saved = await repo.insertEntry({
    raw_text: TEXT, kind: 'conversation', content: JSON.stringify({ text: TEXT }),
    confidence: 1, source: 'chat', entry_date: '2026-09-16', entry_time: '20:00'
  })
  await repo.setHidden('entry', saved.id, scope)
  return { repo, id: saved.id }
}

function sessionCount(db: Database): number {
  return Number(db.exec("SELECT COUNT(*) FROM entries WHERE hidden_scope IS NOT NULL")[0].values[0][0])
}

describe('时间线隐去只改可见性', () => {
  it('all 范围：时间线、搜索、报告与趋势都看不到它', async () => {
    const { repo, id } = await seededIdea('all')
    expect(await repo.listTimeline({})).toHaveLength(0)
    expect(await repo.searchEntries('谈话')).toHaveLength(0)
    expect(await repo.getEntriesByIds([id])).toHaveLength(0)
    expect(await repo.listEntries({})).toHaveLength(0)
    const [day] = await dailyMetrics(repo, '2026-09-16', '2026-09-16')
    expect(day.entry_count).toBe(0)
  })

  it('listing 范围：时间线与搜索看不到，报告与趋势仍统计', async () => {
    const { repo, id } = await seededIdea('listing')
    expect(await repo.listTimeline({})).toHaveLength(0)
    expect(await repo.searchEntries('谈话')).toHaveLength(0)
    expect(await repo.getEntriesByIds([id])).toHaveLength(0)
    const [day] = await dailyMetrics(repo, '2026-09-16', '2026-09-16')
    expect(day.entry_count).toBe(1)
  })

  it('timeline 范围：只有时间线列表看不到，搜索与统计仍算', async () => {
    const { repo } = await seededIdea('timeline')
    expect(await repo.listTimeline({})).toHaveLength(0)
    expect(await repo.searchEntries('谈话')).toHaveLength(1)
    const [day] = await dailyMetrics(repo, '2026-09-16', '2026-09-16')
    expect(day.entry_count).toBe(1)
  })

  it('隐去不删内容：原文、条目数与记录本体都还在', async () => {
    const { repo, id } = await seededIdea('all')
    expect(sessionCount(repo.getDb())).toBe(1)
    expect(await repo.getEntry(id)).toMatchObject({ raw_text: TEXT, entry_date: '2026-09-16' })
  })

  it('已隐藏视图只列隐去的行并带出范围，恢复后回到时间线', async () => {
    const { repo, id } = await seededIdea('listing')
    const hidden = await repo.listTimeline({ showHidden: true })
    expect(hidden).toHaveLength(1)
    expect(hidden[0]).toMatchObject({ record_type: 'entry', hidden_scope: 'listing' })

    await repo.setHidden('entry', id, null)
    expect(await repo.listTimeline({ showHidden: true })).toHaveLength(0)
    expect(await repo.listTimeline({})).toHaveLength(1)
    expect(await repo.searchEntries('谈话')).toHaveLength(1)
  })

  it('隐去知识流水不影响资料本身，也不影响同源记录', async () => {
    const db = await initDb(':memory:')
    const repo = new Repo(db)
    const kb = new KnowledgeBase(db)
    const folder = kb.addFolder('喜欢的句子')
    const collected = kb.addItem({ folderId: folder.id, title: '纸上得来终觉浅', sourceType: 'text', body: '绝知此事要躬行' })
    const event = (await repo.listTimeline({}))[0]
    const idea = await repo.insertEntry({
      raw_text: 'r', kind: 'idea', content: JSON.stringify({ text: '想法' }),
      confidence: 1, source: 'chat', entry_date: '2026-09-16'
    })
    // 由这条记录收录而来的资料不产生流水，时间线上只有那条记录本身
    kb.addItem({ folderId: folder.id, title: '想法：想法', sourceType: 'entry', body: '想法', sourceEntryId: idea.id })
    expect(await repo.listTimeline({})).toHaveLength(2)

    await repo.setHidden('knowledge', event.id, 'timeline')
    const visible = await repo.listTimeline({})
    expect(visible.map(row => row.record_type)).toEqual(['entry'])
    expect(await repo.listTimeline({ record: 'knowledge' })).toHaveLength(0)
    expect(await repo.listTimeline({ showHidden: true })).toHaveLength(1)
    expect(kb.getItem(collected.id)).toMatchObject({ title: '纸上得来终觉浅', body: '绝知此事要躬行' })
    expect(kb.findItemsForEntries([idea.id])).toHaveLength(1)
  })

  it('隐去会话行只标记会话，记录页仍能取到它', async () => {
    const db = await initDb(':memory:')
    const repo = new Repo(db)
    const history = new CaptureHistory(db)
    history.add('user', '在聊论文')
    history.add('assistant', 'RAG 评估……')
    const sessionId = history.archiveSession('论文讨论')

    expect(history.sessions().find(s => s.id === sessionId)?.hiddenScope).toBeNull()
    await repo.setHidden('session', sessionId, 'timeline')
    // 记录页不过滤，可见性由时间线自己判
    const session = history.sessions().find(s => s.id === sessionId)
    expect(session?.hiddenScope).toBe('timeline')
    expect(session?.messageCount).toBe(2)
  })

  it('已隐藏数量统计三类行，空会话不算，恢复后回落', async () => {
    const db = await initDb(':memory:')
    const repo = new Repo(db)
    const kb = new KnowledgeBase(db)
    const history = new CaptureHistory(db)
    const idea = await repo.insertEntry({
      raw_text: 'r', kind: 'idea', content: JSON.stringify({ text: '想法' }),
      confidence: 1, source: 'chat', entry_date: '2026-09-16'
    })
    kb.addItem({ folderId: kb.addFolder('喜欢的句子').id, title: '一句诗', sourceType: 'text', body: '纸上得来终觉浅' })
    history.add('user', '在聊论文')
    history.add('assistant', 'RAG 评估……')
    const sessionId = history.archiveSession('论文讨论')
    // 空会话不会出现在时间线上，也就不该计入数量
    db.run("INSERT INTO capture_sessions (id, title, status, created_at) VALUES ('s-empty', '空会话', 'archived', datetime('now','localtime'))")

    await repo.setHidden('entry', idea.id, 'all')
    await repo.setHidden('knowledge', (await repo.listTimeline({ record: 'knowledge' }))[0].id, 'timeline')
    await repo.setHidden('session', 's-empty', 'timeline')
    expect(await repo.countHidden()).toBe(2)

    await repo.setHidden('session', sessionId, 'timeline')
    expect(await repo.countHidden()).toBe(3)

    await repo.setHidden('entry', idea.id, null)
    expect(await repo.countHidden()).toBe(2)
  })
})
