import { describe, expect, it } from 'vitest'
import { commitCaptureEntries, CaptureChoice } from '../../electron/capture-commit'
import { CaptureHistory } from '../../electron/db/capture'
import { initDb } from '../../electron/db/connection'
import { KnowledgeBase } from '../../electron/db/knowledge'
import { Repo } from '../../electron/db/repository'

async function fixture(): Promise<{ repo: Repo; history: CaptureHistory; messageId: number }> {
  const repo = new Repo(await initDb(':memory:'))
  const history = new CaptureHistory(repo.getDb())
  history.add('user', '昨晚九点和导师讨论论文')
  const assistant = history.add('assistant', '请确认', {
    parsed: [{ kind: 'event', content: { text: '和导师讨论论文' }, confidence: 0.9, entryDate: '2026-09-15', entryTime: '21:00' }]
  })
  return { repo, history, messageId: assistant.id }
}

function choice(patch: Partial<CaptureChoice> = {}): CaptureChoice {
  return {
    kind: 'event',
    content: { text: '和导师讨论论文' },
    confidence: 0.9,
    entryDate: '2026-09-15',
    entryTime: '21:00',
    originalKind: 'event',
    ...patch
  }
}

describe('AI 快速记录归档事务', () => {
  it('默认只写时间线，不创建知识资料', async () => {
    const { repo, history, messageId } = await fixture()
    const saved = await commitCaptureEntries(repo, messageId, [choice()])
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ entry_date: '2026-09-15', entry_time: '21:00' })
    expect(new KnowledgeBase(repo.getDb()).listFolders()).toHaveLength(0)
    expect(history.list().find(message => message.id === messageId)).toMatchObject({ committed: true, text: '已保存 1 条到时间线' })
  })

  it('用户勾选后同时写入默认知识库文件夹', async () => {
    const { repo, messageId } = await fixture()
    await commitCaptureEntries(repo, messageId, [choice({ addToKnowledge: true })])
    const kb = new KnowledgeBase(repo.getDb())
    const folder = kb.listFolders().find(item => item.system_key === 'ai_quick_capture')
    expect(folder).toBeTruthy()
    expect(kb.listItems(folder!.id)).toHaveLength(1)
  })

  it('批量中任一条无效时回滚全部记录并保留待确认状态', async () => {
    const { repo, history, messageId } = await fixture()
    await expect(commitCaptureEntries(repo, messageId, [choice(), choice({ entryTime: '24:00' })])).rejects.toThrow('第 2 条记录')
    expect(await repo.listEntries({})).toHaveLength(0)
    expect(history.list().find(message => message.id === messageId)?.committed).toBe(false)
  })

  it('同一条 AI 回复不能重复归档', async () => {
    const { repo, messageId } = await fixture()
    await commitCaptureEntries(repo, messageId, [choice()])
    await expect(commitCaptureEntries(repo, messageId, [choice()])).rejects.toThrow('不存在或已归档')
    expect(await repo.listEntries({})).toHaveLength(1)
  })

  it('服务端拒绝把非睡眠解析结果改成睡眠', async () => {
    const { repo, messageId } = await fixture()
    await expect(commitCaptureEntries(repo, messageId, [choice({
      kind: 'sleep',
      content: { hours: 8 },
      originalKind: 'event'
    })])).rejects.toThrow('非睡眠内容不能改为睡眠')
    expect(await repo.listEntries({})).toHaveLength(0)
  })

  it('AI 睡眠不会与当天已有睡眠重复累计', async () => {
    const { repo, messageId } = await fixture()
    await repo.insertEntry({
      raw_text: '已有睡眠段', kind: 'sleep',
      content: JSON.stringify({ recordType: 'session', startAt: '2026-09-14 23:00', endAt: '2026-09-15 07:00', hours: 8 }),
      confidence: 1, source: 'manual', entry_date: '2026-09-15'
    })
    await expect(commitCaptureEntries(repo, messageId, [choice({
      kind: 'sleep', content: { hours: 8 }, originalKind: 'sleep'
    })])).rejects.toThrow('当天已有睡眠记录')
    expect(await repo.listEntries({ kind: 'sleep' })).toHaveLength(1)
  })
})
