import { describe, expect, it } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { CaptureHistory } from '../../electron/db/capture'
import { ProfileStore } from '../../electron/db/profile'

describe('持久快速记录与用户资料', () => {
  it('保存消息、解析结果并限制发送上下文', async () => {
    const history = new CaptureHistory(await initDb(':memory:'))
    history.add('user', '我今天睡了八小时')
    const assistant = history.add('assistant', '请确认', { parsed: [{ kind: 'sleep', content: { hours: 8 }, confidence: 1, entryDate: '2026-09-16' }] })
    expect(history.list()[1].parsed?.[0].kind).toBe('sleep')
    history.markCommitted(assistant.id, [12], assistant.parsed ?? [])
    expect(history.list()[1].committed).toBe(true)
    expect(history.list()[1].archivedEntryIds).toEqual([12])
    expect(history.context(1)).toHaveLength(1)
    history.clear()
    expect(history.list()).toHaveLength(0)
  })

  it('AI 草稿只补空字段，手填资料始终优先', async () => {
    const profile = new ProfileStore(await initDb(':memory:'))
    profile.saveManual({ name: '小林', location: '上海' })
    profile.confirmDraft({ name: '错误名字', identity: '学生', location: '北京' })
    expect(profile.values()).toMatchObject({ name: '小林', identity: '学生', location: '上海' })
    expect(profile.get().name?.source).toBe('manual')
    expect(profile.get().identity?.source).toBe('ai')
    profile.saveManual({ name: '林同学', identity: '开发者' })
    expect(profile.values()).toMatchObject({ name: '林同学', identity: '开发者' })
  })
})
