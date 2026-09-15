import { Repo, Entry } from '../db/repository'
import { SemanticSearch, SemanticHit } from './semantic'

/**
 * 混合搜索（v2.5）：
 *   关键词（FTS/LIKE，精确字面）⊕ 语义（向量余弦，含义相近）
 *   → Reciprocal Rank Fusion 融合排序。
 *
 * RRF 公式：score(d) = Σ 1 / (k + rank_i(d))，k=60（论文标准值）。
 * 优点：无需调权重的标度问题——只看两个列表中的排名位置。
 */

export interface KeywordHit {
  entry: Entry
  score: number
  fused_via: ('keyword' | 'semantic')[]
  chunk_text?: string
}

export interface FusedHit {
  id: number
  score: number
}

const RRF_K = 60

/** Reciprocal Rank Fusion：按两列表的排名位置融合 */
export function rrfFuse(
  listA: { id: number; score: number }[],
  listB: { id: number; score: number }[],
  topK = 20
): FusedHit[] {
  const scores = new Map<number, { rrf: number; sources: Set<string> }>()
  const add = (list: { id: number; score: number }[], tag: string) => {
    list.forEach((hit, rank) => {
      const cur = scores.get(hit.id) ?? { rrf: 0, sources: new Set<string>() }
      cur.rrf += 1 / (RRF_K + rank + 1)
      cur.sources.add(tag)
      scores.set(hit.id, cur)
    })
  }
  add(listA, 'a')
  add(listB, 'b')
  return [...scores.entries()]
    .map(([id, s]) => ({ id, score: s.rrf, sources: s.sources }))
    .sort((x, y) => y.score - x.score)
    .slice(0, topK)
}

export class HybridSearch {
  constructor(
    private repo: Repo,
    private semantic: SemanticSearch | null
  ) {}

  /** 单路搜索（不扩展查询）：FTS ⊕ 语义 */
  async search(query: string, topK = 10): Promise<KeywordHit[]> {
    return this.searchMultiQuery([query], topK)
  }

  /** 多查询变体搜索：每路各自取候选，RRF 融合 */
  async searchMultiQuery(queries: string[], topK = 10): Promise<KeywordHit[]> {
    const cleaned = [...new Set(queries.map(q => q.trim()).filter(Boolean))]
    if (!cleaned.length) return []

    // 关键词路：每个变体都查 FTS（精确字面命中权重高）
    const kwLists: { id: number; score: number }[][] = []
    for (const q of cleaned) {
      const kw = await this.repo.searchEntries(q)
      kwLists.push(kw.slice(0, topK).map(e => ({ id: e.id, score: 1 - 0.01 * kw.indexOf(e) })))
    }

    // 语义路：所有变体一起送入语义搜索（内部自行向量化）
    let semHits: SemanticHit[] = []
    if (this.semantic?.available) {
      try {
        const merged = new Map<number, SemanticHit>()
        for (const q of cleaned) {
          for (const h of await this.semantic.search(q, topK)) {
            const prev = merged.get(h.entry.id)
            if (!prev || prev.score < h.score) merged.set(h.entry.id, h)
          }
        }
        semHits = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, topK)
      } catch {
        // 语义失败静默降级为纯关键词
      }
    }

    const semList = semHits.map(h => ({ id: h.entry.id, score: h.score }))
    const fused = rrfFuse(kwLists.flat(), semList, topK)
    if (!fused.length) return []

    const entries = await this.repo.getEntriesByIds(fused.map(f => f.id))
    const byId = new Map(entries.map(e => [e.id, e]))
    const kwOnly = new Set(kwLists.flat().map(h => h.id))
    const semOnly = new Set(semHits.map(h => h.entry.id))

    const chunkByTextId = new Map(semHits.map(h => [h.entry.id, h.chunk_text]))
    return fused
      .filter(f => byId.has(f.id))
      .map(f => ({
        entry: byId.get(f.id)!,
        score: Number(f.score.toFixed(4)),
        fused_via: [
          ...(kwOnly.has(f.id) ? (['keyword'] as const) : []),
          ...(semOnly.has(f.id) ? (['semantic'] as const) : [])
        ],
        chunk_text: chunkByTextId.get(f.id)
      }))
  }

  /**
   * 查询扩展（可选增强）：LLM 把原查询改写为 2 个变体（同义/上位/英文），
   * 变体失败不影响主流程——最多返回 [原查询]，绝不抛错。
   */
  async expandQuery(
    query: string,
    llm: { chat: (m: { role: 'system' | 'user'; content: string }[]) => Promise<string> }
  ): Promise<string[]> {
    const variants = [query]
    try {
      const out = await llm.chat([
        {
          role: 'system',
          content:
            '你是搜索查询改写器。把用户的搜索词改写为 2 个变体：1 个同义中文表述，1 个英文表述。只输出 JSON：{"variants": ["...", "..."]}'
        },
        { role: 'user', content: query.slice(0, 100) }
      ])
      const start = out.indexOf('{')
      const end = out.lastIndexOf('}')
      const parsed = JSON.parse(out.slice(start, end + 1)) as { variants?: unknown }
      if (Array.isArray(parsed.variants)) {
        for (const v of parsed.variants) {
          if (typeof v === 'string' && v.trim() && variants.length < 3) {
            variants.push(v.trim().slice(0, 100))
          }
        }
      }
    } catch {
      // LLM 失败/非法输出 → 只用原查询
    }
    return variants
  }
}
