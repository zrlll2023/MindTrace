import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  CaptureEntry,
  ChatMessageItem,
  changeCaptureEntryKind,
  isCaptureEntryValid,
  useCaptureStore
} from '../../src/stores/capture'

function eventEntry(): CaptureEntry {
  return {
    kind: 'event',
    content: { text: '和导师讨论论文' },
    confidence: 0.9,
    entryDate: '2026-09-16'
  }
}

describe('AI 快速记录状态', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        api: {
          capture: {
            list: vi.fn(async () => []),
            parse: vi.fn(),
            commit: vi.fn(async () => ({ ok: true, entries: [] })),
            clear: vi.fn(async () => ({ ok: true }))
          }
        }
      }
    })
  })

  it('载入待确认条目时知识库默认不勾选', async () => {
    window.api.capture.list = vi.fn(async () => [{
      id: 1,
      role: 'assistant' as const,
      text: '请确认',
      committed: false,
      parsed: [{ ...eventEntry(), addToKnowledge: true }]
    }])
    const store = useCaptureStore()
    await store.load()
    expect(store.messages[0].parsed?.[0].addToKnowledge).toBe(false)
  })

  it('保存期间阻止重复提交并在成功后折叠卡片', async () => {
    let finish!: (value: { ok: true; entries: unknown[] }) => void
    window.api.capture.commit = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const store = useCaptureStore()
    const msg: ChatMessageItem = { id: 7, role: 'assistant', text: '请确认', committed: false, parsed: [eventEntry()] }
    const first = store.commit(msg, msg.parsed!)
    const duplicate = await store.commit(msg, msg.parsed!)
    expect(duplicate).toBe(false)
    expect(window.api.capture.commit).toHaveBeenCalledTimes(1)
    finish({ ok: true, entries: [] })
    expect(await first).toBe(true)
    expect(msg.committed).toBe(true)
    expect(msg.parsed).toBeUndefined()
  })

  it('IPC 抛错时显示错误并允许再次提交', async () => {
    window.api.capture.commit = vi.fn()
      .mockRejectedValueOnce(new Error('数据库写入失败'))
      .mockResolvedValueOnce({ ok: true, entries: [] })
    const store = useCaptureStore()
    const msg: ChatMessageItem = { id: 8, role: 'assistant', text: '请确认', committed: false, parsed: [eventEntry()] }
    expect(await store.commit(msg, msg.parsed!)).toBe(false)
    expect(msg.error).toBe('数据库写入失败')
    expect(await store.commit(msg, msg.parsed!)).toBe(true)
  })

  it('切换类型时重建字段并阻止无效内容保存', () => {
    const entry = { ...eventEntry(), originalKind: 'event' as const }
    changeCaptureEntryKind(entry, 'idea')
    expect(entry.content).toEqual({ text: '和导师讨论论文' })
    changeCaptureEntryKind(entry, 'sleep')
    expect(entry.kind).toBe('idea')
    expect(entry.content).toEqual({ text: '和导师讨论论文' })
    expect(isCaptureEntryValid(entry)).toBe(true)

    const sleep = { ...eventEntry(), kind: 'sleep' as const, originalKind: 'sleep' as const, content: { hours: 7.5 } }
    changeCaptureEntryKind(sleep, 'event')
    expect(sleep.content).toEqual({ text: '', negative: false })
    expect(sleep.kind).toBe('event')
    expect(isCaptureEntryValid(sleep)).toBe(false)
  })

  it('非睡眠条目不能通过状态函数改成睡眠', () => {
    const entry = { ...eventEntry(), originalKind: 'event' as const }
    changeCaptureEntryKind(entry, 'sleep')
    expect(entry.content).toEqual({ text: '和导师讨论论文' })
    expect(isCaptureEntryValid(entry)).toBe(true)
    expect(entry.kind).toBe('event')
  })

  it('拒绝无效日期与时间', () => {
    expect(isCaptureEntryValid({ ...eventEntry(), entryDate: '2026-02-30' })).toBe(false)
    expect(isCaptureEntryValid({ ...eventEntry(), entryTime: '24:00' })).toBe(false)
  })
})
