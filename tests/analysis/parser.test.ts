import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LLMAdapter } from '../../electron/adapters/llm'
import { parseCaptureWith, parseDumpWith } from '../../electron/analysis/parser'

const fakeCfg = { baseUrl: 'https://x', apiKey: 'k', model: 'm' }

function fakeAdapter(): LLMAdapter {
  return new LLMAdapter(fakeCfg)
}

describe('parseDump', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('解析混合 dump 为多条结构化条目', async () => {
    const fake = fakeAdapter()
    fake.chat = async () =>
      JSON.stringify([
        { kind: 'sleep', content: { hours: 6.5 }, confidence: 0.95 },
        { kind: 'quote', content: { text: '纸上得来终觉浅' }, confidence: 0.9 }
      ])
    const out = await parseDumpWith(fake, '睡了6.5小时。今天看到一句话：纸上得来终觉浅')
    expect(out).toHaveLength(2)
    expect(out[0].kind).toBe('sleep')
    expect(out[1].kind).toBe('quote')
  })

  it('LLM 返回非法 JSON 时不崩溃并重试一次', async () => {
    const fake = fakeAdapter()
    let calls = 0
    fake.chat = async () => {
      calls++
      return calls === 1
        ? '抱歉我无法输出JSON'
        : JSON.stringify([{ kind: 'idea', content: { text: '测试' }, confidence: 0.8 }])
    }
    const out = await parseDumpWith(fake, '随便一句')
    expect(calls).toBe(2)
    expect(out[0].kind).toBe('idea')
  })

  it('两次都失败时整条降级为 other、confidence 0', async () => {
    const fake = fakeAdapter()
    fake.chat = async () => '还是不行'
    const out = await parseDumpWith(fake, '一段无法解析的话')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('other')
    expect(out[0].confidence).toBe(0)
    expect((out[0].content as { text: string }).text).toContain('一段无法解析的话')
  })

  it('丢弃 kind 非法的条目', async () => {
    const fake = fakeAdapter()
    fake.chat = async () =>
      JSON.stringify([
        { kind: 'sleep', content: { hours: 8 }, confidence: 0.9 },
        { kind: 'alien', content: {}, confidence: 1 }
      ])
    const out = await parseDumpWith(fake, '睡了8小时')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('sleep')
  })

  it('保留识别到的发生时间，并用本地今天补齐缺失日期', async () => {
    const fake = fakeAdapter()
    let call = 0
    fake.chat = async () => {
      call++
      return call === 1
        ? JSON.stringify({ entries: [{ kind: 'event', content: { text: '跨年聚会' }, confidence: 0.9, entryDate: '2025-12-31', entryTime: '23:30' }], profileDraft: {} })
        : JSON.stringify({ entries: [{ kind: 'idea', content: { text: '没有说日期' }, confidence: 0.8 }], profileDraft: {} })
    }
    const now = new Date(2026, 0, 1, 9, 5)
    const explicit = await parseCaptureWith(fake, '昨晚十一点半参加了跨年聚会', [], {}, now)
    const implicit = await parseCaptureWith(fake, '想到一个点子', [], {}, now)
    expect(explicit.entries[0]).toMatchObject({ entryDate: '2025-12-31', entryTime: '23:30' })
    expect(implicit.entries[0]).toMatchObject({ entryDate: '2026-01-01' })
    expect(implicit.entries[0].entryTime).toBeUndefined()
  })

  it('AI 返回空数组时保留原文为待确认的 other 条目', async () => {
    const fake = fakeAdapter()
    fake.chat = async () => JSON.stringify({ entries: [], profileDraft: {} })
    const out = await parseCaptureWith(fake, '这段话也不能丢', [], {}, new Date(2026, 8, 16, 12, 0))
    expect(out.entries).toEqual([
      { kind: 'other', originalKind: 'other', content: { text: '这段话也不能丢' }, confidence: 0, entryDate: '2026-09-16' }
    ])
  })
})
