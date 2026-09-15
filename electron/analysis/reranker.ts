import { KeywordHit } from './hybrid'

export interface RerankedHit extends KeywordHit {
  rerank_score?: number
}

/**
 * LLM 精排（Reranking，搜索质量升级 B）：
 * 混合搜索融合后的 top-N 由 LLM 逐条精读打分后重排。
 *
 * 契约与兜底（docs/ai-content-contract.md §4）：
 * - 一次批量调用（成本有界）
 * - LLM 失败/非法输出/部分缺失 → 未覆盖条目保持原相对顺序排在有分条目之后
 * - 分数越界收敛 [0,1]，越界 index 忽略，绝不抛错、绝不丢结果
 */

const MAX_RERANK = 20

export async function rerank(
  query: string,
  hits: KeywordHit[],
  llm: { chat: (m: { role: 'system' | 'user'; content: string }[]) => Promise<string> },
  maxHits = MAX_RERANK
): Promise<RerankedHit[]> {
  if (hits.length <= 1) return hits
  const candidates = hits.slice(0, maxHits)
  const rest = hits.slice(maxHits)

  try {
    const out = await llm.chat([
      {
        role: 'system',
        content:
          '你是搜索结果精排器。给你一个查询和若干候选文本（带序号），对每个候选评估与查询的真实相关性，输出 0~1 分。只输出 JSON：{"scores":[{"index":序号,"relevance":0到1}]}，必须覆盖所有序号。'
      },
      {
        role: 'user',
        content: JSON.stringify({
          query: query.slice(0, 200),
          candidates: candidates.map((h, i) => ({
            index: i,
            text: h.entry.raw_text.slice(0, 300)
          }))
        })
      }
    ])
    const start = out.indexOf('{')
    const end = out.lastIndexOf('}')
    const parsed = JSON.parse(out.slice(start, end + 1)) as { scores?: unknown }
    if (!Array.isArray(parsed.scores)) return hits // 非法 → 保序

    const scored = new Map<number, number>()
    for (const s of parsed.scores as Array<{ index?: unknown; relevance?: unknown }>) {
      const idx = typeof s.index === 'number' ? s.index : NaN
      const rel = typeof s.relevance === 'number' && isFinite(s.relevance) ? s.relevance : null
      if (Number.isInteger(idx) && idx >= 0 && idx < candidates.length && rel !== null) {
        scored.set(idx, Math.min(1, Math.max(0, rel)))
      }
    }
    if (!scored.size) return hits // 全部缺失 → 保序

    const withScore = candidates
      .map((h, i) => ({
        h,
        i,
        ...(scored.has(i) ? { rerank_score: scored.get(i) } : {})
      }))
      .sort((a, b) => {
        const sa = a.rerank_score ?? -1
        const sb = b.rerank_score ?? -1
        if (sa !== sb) return sb - sa
        return a.i - b.i // 同分/均无分 → 原相对顺序稳定
      })
      .map(x => ({ ...x.h, ...(x.rerank_score !== undefined ? { rerank_score: x.rerank_score } : {}) }))
    return [...withScore, ...rest]
  } catch {
    return hits // 任何失败 → 保序
  }
}
