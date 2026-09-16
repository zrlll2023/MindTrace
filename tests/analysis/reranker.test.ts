import { describe, it, expect } from 'vitest'
import { rerank } from '../../electron/analysis/reranker'
import { HybridSearch, KeywordHit } from '../../electron/analysis/hybrid'

function hit(id: number, text: string): KeywordHit {
  return {
    entry: {
      id,
      raw_text: text,
      kind: 'idea',
      content: JSON.stringify({ text }),
      confidence: 1,
      source: 'chat',
    created_at: '2026-09-15 10:00:00',
    entry_date: '2026-09-15',
    entry_time: null
    },
    score: 0.5,
    fused_via: ['keyword']
  }
}

const llmWith = (scores: Array<{ index: number; relevance: number }>) => ({
  chat: async () => JSON.stringify({ scores })
})

describe('rerank', () => {
  it('按 LLM 精读分数重排', async () => {
    const hits = [hit(1, '低相关A'), hit(2, '高相关B'), hit(3, '中相关C')]
    const out = await rerank('查询', hits, llmWith([{ index: 0, relevance: 0.1 }, { index: 1, relevance: 0.95 }, { index: 2, relevance: 0.5 }]))
    expect(out.map(h => h.entry.id)).toEqual([2, 3, 1])
    expect(out[0].rerank_score).toBe(0.95)
  })

  it('LLM 失败时保持原序不抛错', async () => {
    const hits = [hit(1, 'a'), hit(2, 'b')]
    const bad = { chat: async () => { throw new Error('网络挂了') } }
    const out = await rerank('q', hits, bad as never)
    expect(out.map(h => h.entry.id)).toEqual([1, 2])
  })

  it('非法 JSON / 缺 scores 保持原序', async () => {
    const hits = [hit(1, 'a'), hit(2, 'b')]
    expect((await rerank('q', hits, { chat: async () => '乱写' } as never)).map(h => h.entry.id)).toEqual([1, 2])
    expect((await rerank('q', hits, { chat: async () => '{"nope":1}' } as never)).map(h => h.entry.id)).toEqual([1, 2])
  })

  it('越界 index 被忽略；分数越界收敛 [0,1]；未覆盖的条目排在有分条目之后', async () => {
    const hits = [hit(1, 'a'), hit(2, 'b'), hit(3, 'c'), hit(4, 'd')]
    const out = await rerank('q', hits, llmWith([
      { index: 99, relevance: 1 }, // 越界
      { index: 1, relevance: 2.5 }, // 收敛到 1（index 1 = 条目2）
      { index: 0, relevance: -1 } // 收敛到 0（index 0 = 条目1）
    ]))
    // 有分的 2(relevance=1) > 1(relevance=0)；未覆盖的 3,4 在最后保持原相对顺序
    expect(out.map(h => h.entry.id)).toEqual([2, 1, 3, 4])
    expect(out.find(h => h.entry.id === 2)!.rerank_score).toBe(1)
  })

  it('空列表直接返回空', async () => {
    expect(await rerank('q', [], llmWith([]))).toEqual([])
  })

  it('条目数 ≤1 时不调用 LLM 直接返回', async () => {
    const hits = [hit(1, 'a')]
    let called = 0
    const llm = { chat: async () => { called++; return '{}' } }
    const out = await rerank('q', hits, llm as never)
    expect(called).toBe(0)
    expect(out).toHaveLength(1)
  })
})
