import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import {
  CaptureEntry,
  ChatMessageItem,
  changeCaptureEntryKind,
  isCaptureEntryValid,
  toCaptureCommitPayload,
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
            undoCommit: vi.fn(async () => ({ ok: true, timelineCount: 1, knowledgeCount: 1 })),
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

  it('保存期间阻止重复提交并在成功后保留卡片', async () => {
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
    expect(msg.parsed).toHaveLength(1)
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

  it('提交前将 Vue 响应式条目转换为 Electron 可克隆载荷', async () => {
    const reactiveEntry = reactive(eventEntry()) as CaptureEntry
    expect(() => structuredClone([reactiveEntry])).toThrow()
    expect(() => structuredClone(toCaptureCommitPayload([reactiveEntry]))).not.toThrow()
    window.api.capture.commit = vi.fn(async (_messageId: number, entries: CaptureEntry[]) => {
      structuredClone(entries)
      return { ok: true, entries: [] }
    })
    const store = useCaptureStore()
    const msg: ChatMessageItem = { id: 9, role: 'assistant', text: '请确认', committed: false, parsed: [reactiveEntry] }
    expect(await store.commit(msg, msg.parsed!)).toBe(true)
  })

  it('撤回成功后恢复为可保存状态并保留卡片', async () => {
    const store = useCaptureStore()
    const msg: ChatMessageItem = {
      id: 10,
      role: 'assistant',
      text: '请确认',
      committed: true,
      parsed: [eventEntry()],
      archivedEntryIds: [21]
    }
    expect(await store.undo(msg)).toBe(true)
    expect(window.api.capture.undoCommit).toHaveBeenCalledWith(10)
    expect(msg.committed).toBe(false)
    expect(msg.parsed).toHaveLength(1)
    expect(msg.archivedEntryIds).toBeUndefined()
  })

  it('清空成功后重置消息、输入和提交状态', async () => {
    const store = useCaptureStore()
    store.messages = [{ id: 1, role: 'user', text: '旧内容' }]
    store.input = '未发送内容'

    expect(await store.clear()).toBe(true)
    expect(store.messages).toEqual([])
    expect(store.input).toBe('')
    expect(store.committingIds).toEqual([])
    expect(window.api.capture.clear).toHaveBeenCalledTimes(1)
  })

  it('解析或归档期间拒绝清空当前对话', async () => {
    const store = useCaptureStore()
    store.busy = true
    expect(await store.clear()).toBe(false)
    store.busy = false
    store.committingIds = [9]
    expect(await store.clear()).toBe(false)
    expect(window.api.capture.clear).not.toHaveBeenCalled()
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
