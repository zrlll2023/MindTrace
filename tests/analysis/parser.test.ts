import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LLMAdapter } from '../../electron/adapters/llm'
import { parseDumpWith } from '../../electron/analysis/parser'

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
})
