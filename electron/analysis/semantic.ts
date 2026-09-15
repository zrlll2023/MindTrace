import { Repo } from '../db/repository'
import { VectorStore } from '../db/vectors'
import { EmbeddingAdapter } from '../adapters/embedding'
import { Entry } from '../db/repository'

export interface SemanticHit {
  entry: Entry
  score: number
}

/**
 * 语义搜索：查询向量化 → 余弦搜索 → 关联条目。
 * - 未配置 embedding 或库为空时返回空数组（UI 静默降级为关键词搜索）
 * - 查询文本脱敏与否不影响相似度语义，但按契约仍不外发原文外的信息
 */
export class SemanticSearch {
  constructor(
    private repo: Repo,
    private vectors: VectorStore,
    private emb: EmbeddingAdapter | null
  ) {}

  get available(): boolean {
    return this.emb !== null
  }

  /** 首次/增量向量化所有条目。返回本次嵌入数。 */
  async indexAll(): Promise<number> {
    if (!this.emb) throw new Error('未配置 Embedding 服务')
    return this.vectors.embedMissing(this.repo, this.emb)
  }

  async search(query: string, topK = 10, minScore = 0.25): Promise<SemanticHit[]> {
    if (!this.emb || !query.trim()) return []
    const qv = await this.emb.embedOne(query.slice(0, 500))
    if (!qv.length) return []
    const hits = await this.vectors.search(qv, topK, minScore)
    if (!hits.length) return []
    const entries = await this.repo.getEntriesByIds(hits.map(h => h.entry_id))
    const byId = new Map(entries.map(e => [e.id, e]))
    return hits
      .filter(h => byId.has(h.entry_id))
      .map(h => ({ entry: byId.get(h.entry_id)!, score: h.score }))
  }
}
