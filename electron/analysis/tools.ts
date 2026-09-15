import { Repo, Entry } from '../db/repository'

/**
 * 有界 Agent 的本地工具集（spec §6.2）。
 * 工具只能查询本地数据；v1 不提供任何联网工具。
 * 每个工具返回 JSON 字符串（作为 tool message 内容回传给 LLM）。
 */

/** 从 JSON content 中按路径取值，如 sleep.hours / event.negative_count */
function metricValue(content: Record<string, unknown>, path: string): number | null {
  // 特殊路径：event.negative_count 之类由调用方按日聚合，这里只支持 content 内的数值路径
  const parts = path.split('.')
  let cur: unknown = content
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) return null
    cur = (cur as Record<string, unknown>)[p]
  }
  return typeof cur === 'number' ? cur : null
}

export class AnalysisTools {
  constructor(private repo: Repo) {}

  async query_entries(args: {
    keyword?: string
    kind?: string
    dateFrom?: string
    dateTo?: string
    limit?: number
  }): Promise<string> {
    let entries: Entry[] = []
    if (args.keyword) {
      entries = await this.repo.searchEntries(args.keyword)
    } else {
      entries = await this.repo.listEntries({
        kind: args.kind as never,
        dateFrom: args.dateFrom,
        dateTo: args.dateTo,
        limit: args.limit ?? 50
      })
    }
    const trimmed = entries.slice(0, args.limit ?? 50).map(e => ({
      id: e.id,
      entry_date: e.entry_date,
      kind: e.kind,
      content: JSON.parse(e.content) as Record<string, unknown>
    }))
    return JSON.stringify({ count: trimmed.length, entries: trimmed })
  }

  async get_thread(args: { title?: string }): Promise<string> {
    const threads = await this.repo.listThreads()
    const filtered = args.title
      ? threads.filter(t => t.title.includes(args.title!))
      : threads
    return JSON.stringify({
      count: filtered.length,
      threads: filtered.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        updated_at: t.updated_at
      }))
    })
  }

  /**
   * 按日聚合两个指标并计算皮尔逊相关系数。
   * 支持 metric 形如 "sleep.hours"（当日 sleep 条目 content.hours 的均值）
   * 与 "event.negative_count"（当日 negative=true 的事件条数）。
   */
  async correlate(args: {
    metricA: string
    metricB: string
    dateFrom: string
    dateTo: string
  }): Promise<string> {
    const entries = await this.repo.listEntries({
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      limit: 2000
    })
    const byDate = new Map<string, Entry[]>()
    for (const e of entries) {
      const arr = byDate.get(e.entry_date) ?? []
      arr.push(e)
      byDate.set(e.entry_date, arr)
    }

    const agg = (dayEntries: Entry[], metric: string): number | null => {
      if (metric === 'event.negative_count') {
        return dayEntries.filter(
          e => e.kind === 'event' && (JSON.parse(e.content) as { negative?: boolean }).negative === true
        ).length
      }
      const [kind, ...rest] = metric.split('.')
      const field = rest.join('.')
      const vals = dayEntries
        .filter(e => e.kind === kind)
        .map(e => metricValue(JSON.parse(e.content) as Record<string, unknown>, field))
        .filter((v): v is number => v !== null)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }

    const xs: number[] = []
    const ys: number[] = []
    for (const [, dayEntries] of byDate) {
      const x = agg(dayEntries, args.metricA)
      const y = agg(dayEntries, args.metricB)
      if (x !== null && y !== null) {
        xs.push(x)
        ys.push(y)
      }
    }
    if (xs.length < 3) {
      return JSON.stringify({ error: 'insufficient_data', n: xs.length, need: 3 })
    }

    const mx = xs.reduce((a, b) => a + b, 0) / xs.length
    const my = ys.reduce((a, b) => a + b, 0) / ys.length
    let num = 0
    let dx = 0
    let dy = 0
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my)
      dx += (xs[i] - mx) ** 2
      dy += (ys[i] - my) ** 2
    }
    const coefficient = dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy)
    return JSON.stringify({ coefficient: Number(coefficient.toFixed(4)), n: xs.length, metricA: args.metricA, metricB: args.metricB })
  }
}

/** 工具名 → 执行函数映射（引擎的 executor 直接使用） */
export function createTools(repo: Repo): AnalysisTools {
  return new AnalysisTools(repo)
}
