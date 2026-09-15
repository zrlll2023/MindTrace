import { describe, it, expect } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { Repo } from '../../electron/db/repository'
import { VectorStore } from '../../electron/db/vectors'
import { EmbeddingAdapter, cosineSimilarity } from '../../electron/adapters/embedding'

async function setup() {
  const db = await initDb(':memory:')
  const repo = new Repo(db)
  const vs = new VectorStore(db)
  return { repo, vs }
}

// 手工向量：dim 2 便于断言
function fakeEmbed(map: Record<string, number[]>): EmbeddingAdapter {
  const a = new EmbeddingAdapter({ baseUrl: 'x', apiKey: 'k', model: 'm' })
  a.embed = async (texts: string[]) => texts.map(t => map[t] ?? [0, 0])
  return a
}

describe('VectorStore', () => {
  it('upsert + 按余弦相似度排序搜索', async () => {
    const { repo, vs } = await setup()
    const e1 = await repo.insertEntry({ raw_text: 'r1', kind: 'idea', content: '{"text":"RAG 评估"}', confidence: 1, source: 'chat' })
    const e2 = await repo.insertEntry({ raw_text: 'r2', kind: 'idea', content: '{"text":"睡眠不足"}', confidence: 1, source: 'chat' })
    await vs.upsert(e1.id, [1, 0], 'h1')
    await vs.upsert(e2.id, [0, 1], 'h2')
    await vs.upsert(e1.id, [0.9, 0.1], 'h1b') // 更新覆盖

    const results = await vs.search([1, 0], 2, 0)
    expect(results[0].entry_id).toBe(e1.id)
    expect(results[0].score).toBeCloseTo(0.994, 2)
    expect(results).toHaveLength(2)
  })

  it('embedMissing 只为缺失/过期的条目生成向量', async () => {
    const { repo, vs } = await setup()
    const e1 = await repo.insertEntry({ raw_text: 'r1', kind: 'idea', content: '{"text":"RAG 评估"}', confidence: 1, source: 'chat' })
    const e2 = await repo.insertEntry({ raw_text: 'r2', kind: 'idea', content: '{"text":"睡眠不足"}', confidence: 1, source: 'chat' })
    const emb = fakeEmbed({ 'RAG 评估': [1, 0], '睡眠不足': [0, 1] })

    const n1 = await vs.embedMissing(repo, emb)
    expect(n1).toBe(2)
    // content 未变 → 无需重新嵌入
    const n2 = await vs.embedMissing(repo, emb)
    expect(n2).toBe(0)
    // 更新 content → 需要重新嵌入
    await repo.updateEntryContent(e1.id, '{"text":"RAG 评估新方法"}')
    const emb2 = fakeEmbed({ 'RAG 评估新方法': [1, 0], '睡眠不足': [0, 1] })
    const n3 = await vs.embedMissing(repo, emb2)
    expect(n3).toBe(1)
    void e2
  })

  it('删除向量（条目重建场景）', async () => {
    const { repo, vs } = await setup()
    const e = await repo.insertEntry({ raw_text: 'r', kind: 'idea', content: '{"text":"x"}', confidence: 1, source: 'chat' })
    await vs.upsert(e.id, [1, 1], 'h')
    await vs.remove(e.id)
    const results = await vs.search([1, 1], 5, 0)
    expect(results).toHaveLength(0)
  })

  it('cosineSimilarity 用于语义相关性：同主题高于无关主题', () => {
    // 简单调向量模拟："RAG评估" 与 "评估方法" 相似、"今天天气" 无关
    const rag = [1, 0.9, 0]
    const evalM = [0.9, 1, 0]
    const weather = [0, 0, 1]
    expect(cosineSimilarity(rag, evalM)).toBeGreaterThan(cosineSimilarity(rag, weather))
  })
})
