import { Database } from 'sql.js'
import { Repo } from './repository'
import { EmbeddingAdapter, cosineSimilarity } from '../adapters/embedding'
import { chunkText } from '../analysis/chunker'

export interface VectorHit {
  entry_id: number
  score: number
  chunk_index: number
  chunk_text: string
}

export interface ChunkInput {
  index: number
  text: string
  vector: number[]
}

/**
 * 分块向量存储（Chunking 升级）：
 * vectors 表复合主键 (entry_id, chunk_index)，一条长条目 → 多个语义块向量。
 * - 内容哈希存于每条目第一块（content_hash 相同则整条跳过）
 * - 搜索命中返回 chunk_text（匹配到的具体片段）
 */
export class VectorStore {
  constructor(private db: Database) {}

  /** 单块写入（兼容旧调用） */
  async upsert(entryId: number, embedding: number[], contentHash: string): Promise<void> {
    await this.upsertChunks(entryId, [{ index: 0, text: '', vector: embedding }], contentHash)
  }

  /** 多块写入：先清旧块再插入 */
  async upsertChunks(entryId: number, chunks: ChunkInput[], contentHash = ''): Promise<void> {
    this.db.run('DELETE FROM vectors WHERE entry_id = ?', [entryId])
    for (const c of chunks) {
      this.db.run(
        'INSERT INTO vectors (entry_id, chunk_index, chunk_text, content_hash, embedding) VALUES (?, ?, ?, ?, ?)',
        [entryId, c.index, c.text, contentHash, JSON.stringify(c.vector)]
      )
    }
  }

  /** 内容更新：替换整条目的所有块 */
  async replaceEntryChunks(entryId: number, chunks: ChunkInput[]): Promise<void> {
    this.db.run('DELETE FROM vectors WHERE entry_id = ?', [entryId])
    if (chunks.length) await this.upsertChunks(entryId, chunks)
  }

  async remove(entryId: number): Promise<void> {
    this.db.run('DELETE FROM vectors WHERE entry_id = ?', [entryId])
  }

  /** 余弦相似度搜索；命中含 chunk 信息 */
  async search(queryVector: number[], topK = 10, minScore = 0.3): Promise<VectorHit[]> {
    const res = this.db.exec('SELECT entry_id, chunk_index, chunk_text, embedding FROM vectors')
    if (!res.length) return []
    const hits: VectorHit[] = []
    for (const [entryId, chunkIndex, chunkText, embJson] of res[0].values as [
      number,
      number,
      string,
      string
    ][]) {
      try {
        const vec = JSON.parse(embJson) as number[]
        const score = cosineSimilarity(queryVector, vec)
        if (score >= minScore) {
          hits.push({ entry_id: entryId, score, chunk_index: chunkIndex as number, chunk_text: chunkText })
        }
      } catch {
        // 损坏向量跳过
      }
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, topK)
  }

  /**
   * 增量分块嵌入：只为新增/内容变更的条目调 API。
   * 返回本次嵌入的块数。
   */
  async embedEntryChunks(repo: Repo, emb: EmbeddingAdapter, maxChunkLen = 400): Promise<number> {
    const pending = await repo.entriesNeedingEmbedding()
    let embedded = 0
    for (const e of pending) {
      const text = this.entryText(e)
      const parts = chunkText(text, maxChunkLen, 60)
      if (!parts.length) continue
      const vectors = await emb.embed(parts.map(p => p.text))
      await this.upsertChunks(
        e.id,
        parts.map((p, i) => ({ index: i, text: p.text, vector: vectors[i] })),
        e.content_hash
      )
      embedded += parts.length
    }
    return embedded
  }

  /** 兼容旧名（底层已是分块实现） */
  async embedMissing(repo: Repo, emb: EmbeddingAdapter): Promise<number> {
    return this.embedEntryChunks(repo, emb)
  }

  private entryText(e: { content: string }): string {
    try {
      const c = JSON.parse(e.content) as Record<string, unknown>
      return Object.entries(c)
        .filter(([k]) => !k.startsWith('_'))
        .map(([, v]) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''))
        .join(' ')
        .slice(0, 8000) // 放宽：分块器会把长文本切碎
    } catch {
      return ''
    }
  }

  async count(): Promise<number> {
    const r = this.db.exec('SELECT COUNT(*) FROM vectors')
    return (r[0]?.values[0]?.[0] as number) ?? 0
  }
}

/** 同条目多块命中去重：保留最高分块（供"条目级"展示用） */
export function dedupByEntry(hits: VectorHit[]): VectorHit[] {
  const best = new Map<number, VectorHit>()
  for (const h of hits) {
    const prev = best.get(h.entry_id)
    if (!prev || prev.score < h.score) best.set(h.entry_id, h)
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}
