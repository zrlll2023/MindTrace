import { describe, it, expect } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { Repo } from '../../electron/db/repository'
import { VectorStore } from '../../electron/db/vectors'

describe('VectorStore 分块存储', () => {
  async function setup() {
    const repo = new Repo(await initDb(':memory:'))
    const vs = new VectorStore(repo.getDb())
    return { repo, vs }
  }

  it('同条目多块分别存储，search 返回 chunk_index/chunk_text', async () => {
    const { repo, vs } = await setup()
    const e = await repo.insertEntry({
      raw_text: 'r',
      kind: 'conversation',
      content: '{"text":"很长的一段对话","role":"user"}',
      confidence: 1,
      source: 'import:chatgpt'
    })
    await vs.upsertChunks(e.id, [
      { index: 0, text: '第一块：RAG 评估', vector: [1, 0, 0] },
      { index: 1, text: '第二块：睡眠建议', vector: [0, 1, 0] }
    ])

    const hits = await vs.search([1, 0, 0], 5, 0)
    expect(hits).toHaveLength(2) // 同条目两块都在
    const top = hits[0]
    expect(top.entry_id).toBe(e.id)
    expect(top.chunk_index).toBe(0)
    expect(top.chunk_text).toContain('RAG')
  })

  it('replaceEntryChunks：内容更新时旧块全部清除', async () => {
    const { repo, vs } = await setup()
    const e = await repo.insertEntry({ raw_text: 'r', kind: 'idea', content: '{"text":"v1 内容很长".repeat(50)}', confidence: 1, source: 'chat' })
    await vs.upsertChunks(e.id, [
      { index: 0, text: 'a', vector: [1, 0] },
      { index: 1, text: 'b', vector: [0.9, 0.1] }
    ])
    await vs.replaceEntryChunks(e.id, [{ index: 0, text: '新内容', vector: [0, 1] }])
    const hits = await vs.search([0, 1], 10, 0)
    expect(hits).toHaveLength(1)
    expect(hits[0].chunk_text).toBe('新内容')
  })

  it('embedEntryChunks：长条目自动分块嵌入，短条目单块', async () => {
    const { repo, vs } = await setup()
    const long = await repo.insertEntry({
      raw_text: 'r',
      kind: 'conversation',
      content: JSON.stringify({ text: '句子一。'.repeat(100) }),
      confidence: 1,
      source: 'import:chatgpt'
    })
    const short = await repo.insertEntry({ raw_text: 'r2', kind: 'idea', content: '{"text":"短想法"}', confidence: 1, source: 'chat' })

    // 假 embedding：向量与块文本长度挂钩以便断言
    let embedCalls = 0
    const fakeEmb = new (class {
      async embed(texts: string[]) {
        embedCalls += texts.length
        return texts.map(t => [t.length % 7 / 7, 1 - t.length % 7 / 7, 0])
      }
    })() as unknown as import('../../electron/adapters/embedding').EmbeddingAdapter

    const n = await vs.embedEntryChunks(repo, fakeEmb)
    expect(n).toBeGreaterThanOrEqual(2) // 长条目多块 + 短条目 1 块
    const count = await vs.count()
    expect(count).toBe(embedCalls)
    void long
    void short
  })

  it('同条目多块命中 search 去重取最高分', async () => {
    const { repo, vs } = await setup()
    const e = await repo.insertEntry({ raw_text: 'r', kind: 'idea', content: '{"text":"主题讨论"}', confidence: 1, source: 'chat' })
    await vs.upsertChunks(e.id, [
      { index: 0, text: '块A', vector: [0.9, 0.1, 0] },
      { index: 1, text: '块B', vector: [0.8, 0.2, 0] }
    ])
    const { dedupByEntry } = await import('../../electron/db/vectors')
    const hits = dedupByEntry(await vs.search([1, 0, 0], 10, 0))
    expect(hits).toHaveLength(1)
    expect(hits[0].chunk_index).toBe(0) // 最高分块
  })
})
