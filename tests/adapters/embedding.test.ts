import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EmbeddingAdapter, cosineSimilarity } from '../../electron/adapters/embedding'

describe('EmbeddingAdapter (OpenAI 兼容 /embeddings)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('发送批量文本返回向量', async () => {
    let captured: { url: string; body: any } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(init.body as string) }
      return new Response(
        JSON.stringify({
          data: [
            { index: 0, embedding: [0.1, 0.2, 0.3] },
            { index: 1, embedding: [0.4, 0.5, 0.6] }
          ]
        }),
        { status: 200 }
      )
    })
    const a = new EmbeddingAdapter({ baseUrl: 'https://api.example.com', apiKey: 'k', model: 'emb-1' })
    const vecs = await a.embed(['你好', '世界'])
    expect(captured!.url).toBe('https://api.example.com/v1/embeddings')
    expect(captured!.body.model).toBe('emb-1')
    expect(captured!.body.input).toEqual(['你好', '世界'])
    expect(vecs).toHaveLength(2)
    expect(vecs[0][0]).toBeCloseTo(0.1)
  })

  it('HTTP 错误抛出可读信息', async () => {
    vi.stubGlobal('fetch', async () => new Response('no key', { status: 401 }))
    const a = new EmbeddingAdapter({ baseUrl: 'https://x', apiKey: 'k', model: 'm' })
    await expect(a.embed(['x'])).rejects.toThrow(/401/)
  })
})

describe('cosineSimilarity', () => {
  it('同向为 1，反向为 -1，正交为 0', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('零向量安全返回 0', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})
