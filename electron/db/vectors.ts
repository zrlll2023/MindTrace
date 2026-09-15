import { Database } from 'sql.js'
import { Repo } from './repository'
import { EmbeddingAdapter } from '../adapters/embedding'
import { cosineSimilarity } from '../adapters/embedding'

export interface VectorHit {
  entry_id: number
  score: number
}

/**
 * 向量存储（语义搜索）：vectors 表（entry_id, content_hash, embedding JSON）。
 * - 不依赖 sqlite 扩展（全项目禁原生模块），余弦相似度在 JS 中计算
 * - embedMissing 增量嵌入：只为新增/内容变更的条目调 API
 */
export class VectorStore {
  constructor(private db: Database) {}

  async upsert(entryId: number, embedding: number[], contentHash: string): Promise<void> {
    this.db.run(
      `INSERT INTO vectors (entry_id, content_hash, embedding) VALUES (?, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET content_hash = excluded.content_hash, embedding = excluded.embedding`,
      [entryId, contentHash, JSON.stringify(embedding)]
    )
  }

  async remove(entryId: number): Promise<void> {
    this.db.run('DELETE FROM vectors WHERE entry_id = ?', [entryId])
  }

  /** 余弦相似度搜索，返回按分数倒序的命中（score ∈ [-1,1]） */
  async search(queryVector: number[], topK = 10, minScore = 0.3): Promise<VectorHit[]> {
    const res = this.db.exec('SELECT entry_id, embedding FROM vectors')
    if (!res.length) return []
    const hits: VectorHit[] = []
    for (const [id, embJson] of res[0].values as [number, string][]) {
      try {
        const vec = JSON.parse(embJson) as number[]
        const score = cosineSimilarity(queryVector, vec)
        if (score >= minScore) hits.push({ entry_id: id, score })
      } catch {
        // 损坏向量跳过
      }
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, topK)
  }

  /** 为缺失/变更的条目生成向量；返回本次嵌入数量 */
  async embedMissing(repo: Repo, emb: EmbeddingAdapter, batchSize = 32): Promise<number> {
    const pending = await repo.entriesNeedingEmbedding()
    let count = 0
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize)
      const texts = batch.map(e => this.entryText(e))
      const vectors = await emb.embed(texts)
      for (let j = 0; j < batch.length; j++) {
        await this.upsert(batch[j].id, vectors[j], batch[j].content_hash)
        count++
      }
    }
    return count
  }

  /** 条目文本表示：content 各字符串字段拼接（脱敏在 embed 前由调用方决定） */
  private entryText(e: { content: string }): string {
    try {
      const c = JSON.parse(e.content) as Record<string, unknown>
      return Object.entries(c)
        .filter(([k]) => !k.startsWith('_'))
        .map(([, v]) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''))
        .join(' ')
        .slice(0, 1000)
    } catch {
      return ''
    }
  }

  async count(): Promise<number> {
    const r = this.db.exec('SELECT COUNT(*) FROM vectors')
    return (r[0]?.values[0]?.[0] as number) ?? 0
  }
}
