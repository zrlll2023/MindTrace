/**
 * Embedding 适配器（语义搜索 v2.5）：OpenAI 兼容 /embeddings 端点。
 * 兼容 DeepSeek/智谱/SiliconFlow/OpenAI 等提供 embedding 的服务商，以及本地 Ollama。
 */

export interface EmbeddingConfig {
  baseUrl: string
  apiKey: string
  model: string
}

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

export class EmbeddingAdapter {
  constructor(private cfg: EmbeddingConfig) {}

  /** 批量向量化。返回与输入顺序一致的向量数组。 */
  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return []
    const res = await fetch(`${normalizeBase(this.cfg.baseUrl)}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`
      },
      body: JSON.stringify({ model: this.cfg.model, input: texts })
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Embedding 请求失败 HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    const data = (await res.json()) as { data?: { index: number; embedding: number[] }[] }
    const arr = (data.data ?? []).slice().sort((a, b) => a.index - b.index)
    return arr.map(d => d.embedding)
  }

  async embedOne(text: string): Promise<number[]> {
    const [v] = await this.embed([text])
    return v
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const v = await this.embedOne('测试')
      return { ok: v.length > 0 }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
}

/** 余弦相似度；零向量安全 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
