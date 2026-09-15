import { describe, it, expect } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { Repo } from '../../electron/db/repository'
import { VectorStore } from '../../electron/db/vectors'
import { SemanticSearch } from '../../electron/analysis/semantic'
import { HybridSearch, rrfFuse } from '../../electron/analysis/hybrid'
import { EmbeddingAdapter } from '../../electron/adapters/embedding'

async function setup() {
  const repo = new Repo(await initDb(':memory:'))
  const vs = new VectorStore(repo.getDb())
  // 三条条目：两条 RAG 主题，一条睡眠主题
  const e1 = await repo.insertEntry({ raw_text: 'r1', kind: 'idea', content: '{"text":"RAG 评估指标 faithfulness"}', confidence: 1, source: 'chat' })
  const e2 = await repo.insertEntry({ raw_text: 'r2', kind: 'conversation', content: '{"text":"讨论 RAG 检索增强生成 的评估"}', confidence: 1, source: 'import:chatgpt' })
  const e3 = await repo.insertEntry({ raw_text: 'r3', kind: 'sleep', content: '{"hours":6.5}', confidence: 1, source: 'chat' })
  // 手工向量：RAG 主题 [1,0]，睡眠 [0,1]
  await vs.upsert(e1.id, [1, 0.05, 0], 'h')
  await vs.upsert(e2.id, [0.95, 0, 0.1], 'h')
  await vs.upsert(e3.id, [0, 0, 1], 'h')
  const emb = new (class {
    async embedOne(q: string) {
      // 查询含"评估/RAG"→ RAG 方向；否则睡眠方向
      return /评估|RAG/i.test(q) ? [1, 0.1, 0] : [0, 0, 1]
    }
  })() as unknown as EmbeddingAdapter
  const sem = new SemanticSearch(repo, vs, emb)
  const hybrid = new HybridSearch(repo, sem)
  return { repo, hybrid, e1, e2, e3 }
}

describe('rrfFuse', () => {
  it('两个列表共同命中的条目得分最高', () => {
    const fused = rrfFuse(
      [
        { id: 1, score: 0.9 },
        { id: 2, score: 0.8 }
      ],
      [
        { id: 2, score: 0.95 },
        { id: 3, score: 0.7 }
      ]
    )
    // id=2 双方都命中 → 融合后第一
    expect(fused[0].id).toBe(2)
    expect(fused).toHaveLength(3)
  })

  it('单列表退化为按原排序', () => {
    const fused = rrfFuse([{ id: 5, score: 1 }], [])
    expect(fused).toHaveLength(1)
    expect(fused[0].id).toBe(5)
  })

  it('空输入返回空', () => {
    expect(rrfFuse([], [])).toHaveLength(0)
  })
})

describe('HybridSearch', () => {
  it('关键词命中 + 语义命中融合，共同命中排最前', async () => {
    const { hybrid } = await setup()
    // "评估" 命中 FTS（e1/e2 的 content 含"评估"），语义方向也偏 RAG（e1/e2）
    const hits = await hybrid.search('评估', 5)
    expect(hits.length).toBeGreaterThanOrEqual(2)
    const topTexts = hits.map(h => JSON.parse(h.entry.content) as { text?: string })
    // 前两名都应是 RAG 相关（e1 或 e2），不应出现睡眠条目在头部
    expect(JSON.stringify(topTexts.slice(0, 2))).toMatch(/评估|RAG/)
    expect(hits[0].entry.kind).not.toBe('sleep')
  })

  it('语义不可用时回退纯关键词搜索', async () => {
    const repo = new Repo(await initDb(':memory:'))
    const e1 = await repo.insertEntry({ raw_text: 'r', kind: 'idea', content: '{"text":"RAG 评估"}', confidence: 1, source: 'chat' })
    const hybrid = new HybridSearch(repo, null)
    const hits = await hybrid.search('RAG', 5)
    expect(hits).toHaveLength(1)
    expect(hits[0].entry.id).toBe(e1.id)
    expect(hits[0].fused_via).toContain('keyword')
  })

  it('expandQuery：LLM 返回变体时合并去重原查询', async () => {
    const { hybrid } = await setup()
    const fakeLlm = {
      chat: async () => JSON.stringify({ variants: ['评估指标 RAGAS', 'retrieval evaluation'] })
    }
    const out = await hybrid.expandQuery('RAG 评估', fakeLlm as never)
    expect(out).toContain('RAG 评估')
    expect(out).toContain('评估指标 RAGAS')
    expect(out).toHaveLength(3)
  })

  it('expandQuery：LLM 失败/非法输出时只返回原查询', async () => {
    const { hybrid } = await setup()
    const bad = { chat: async () => '不是 JSON' }
    const out = await hybrid.expandQuery('RAG', bad as never)
    expect(out).toEqual(['RAG'])
  })

  it('searchMultiQuery：多变体结果融合去重', async () => {
    const { hybrid } = await setup()
    const hits = await hybrid.searchMultiQuery(['评估', '检索增强生成'], 5)
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })
})
