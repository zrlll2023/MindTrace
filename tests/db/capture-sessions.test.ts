import { describe, expect, it } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { CaptureHistory } from '../../electron/db/capture'

describe('记录会话归档与列表', () => {
  it('活跃会话用首条用户消息作默认标题并聚合 token', async () => {
    const history = new CaptureHistory(await initDb(':memory:'))
    history.add('user', '今天想聊聊论文进度')
    history.add('assistant', '好的，先说说现状', { usage: { totalTokens: 100 } })
    history.add('assistant', '再给点建议', { usage: { totalTokens: 50 } })

    const sessions = history.sessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      id: 'default',
      title: '今天想聊聊论文进度',
      status: 'active',
      messageCount: 3,
      tokenCount: 150
    })
  })

  it('归档把整段对话放进同一个会话并冻结标题', async () => {
    const history = new CaptureHistory(await initDb(':memory:'))
    history.add('user', '第一条')
    history.add('assistant', '回复一', { usage: { totalTokens: 30 } })
    history.add('user', '第二条')
    history.add('assistant', '回复二', { usage: { totalTokens: 40 } })

    const archivedId = history.archiveSession('论文讨论')
    expect(archivedId).toBeTruthy()
    expect(history.list('default')).toHaveLength(0)

    // 原文整体可回看，且没有碎成一条条独立会话
    expect(history.list(archivedId)).toHaveLength(4)

    const sessions = history.sessions()
    const archived = sessions.find(s => s.id === archivedId)
    expect(archived).toMatchObject({ title: '论文讨论', status: 'archived', messageCount: 4, tokenCount: 70 })
    expect(archived?.archivedAt).toBeTruthy()
  })

  it('无消息时归档不产生空会话', async () => {
    const history = new CaptureHistory(await initDb(':memory:'))
    expect(history.archiveSession()).toBe('')
    expect(history.sessions()).toHaveLength(0)
  })
})
