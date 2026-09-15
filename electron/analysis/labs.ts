import { Repo } from '../db/repository'

/**
 * v3 实验性功能（spec §9 v3，均标注“实验”）：
 * 1. 相关性仪表盘：按日聚合睡眠/负面事件等指标，供前端画曲线
 * 2. 引导式周度研究：AI 出搜索词 → 人工在浏览器搜索并粘贴感兴趣内容 → 入库为 quote/idea
 */

export interface DayMetrics {
  date: string
  sleep_hours: number | null
  negative_count: number
  entry_count: number
  idea_count: number
}

export async function dailyMetrics(repo: Repo, dateFrom: string, dateTo: string): Promise<DayMetrics[]> {
  const entries = await repo.listEntries({ dateFrom, dateTo, limit: 5000 })
  const byDate = new Map<string, { sleep: number[]; neg: number; ideas: number; total: number }>()
  // 先铺满日期区间（含无记录日）
  const start = new Date(dateFrom)
  const end = new Date(dateTo)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    byDate.set(key, { sleep: [], neg: 0, ideas: 0, total: 0 })
  }
  for (const e of entries) {
    const day = byDate.get(e.entry_date)
    if (!day) continue
    day.total++
    let content: Record<string, unknown> = {}
    try {
      content = JSON.parse(e.content) as Record<string, unknown>
    } catch {
      continue
    }
    if (e.kind === 'sleep' && typeof content.hours === 'number') day.sleep.push(content.hours)
    if (e.kind === 'event' && content.negative === true) day.neg++
    if (e.kind === 'idea') day.ideas++
  }
  return [...byDate.entries()].map(([date, d]) => ({
    date,
    sleep_hours: d.sleep.length ? d.sleep.reduce((a, b) => a + b, 0) / d.sleep.length : null,
    negative_count: d.neg,
    entry_count: d.total,
    idea_count: d.ideas
  }))
}

/** 引导式研究会话：AI 生成 3~5 个搜索词 + 推荐搜索引擎链接 */
export async function planResearch(
  llm: { chat: (m: { role: 'system' | 'user'; content: string }[]) => Promise<string> },
  threadTitles: string[],
  recentIdeas: string[]
): Promise<{ queries: string[]; note: string }> {
  const messages: { role: 'system' | 'user'; content: string }[] = [
    {
      role: 'system',
      content:
        '你是 MindTrace 的研究向导。基于用户的兴趣线与最近想法，生成 3~5 个值得本周深入搜索的问题式搜索词（中文或英文，具体明确，适合搜索引擎）。只输出 JSON：{"queries": ["...", "..."], "note": "一句话说明为什么这些值得研究"}'
    },
    {
      role: 'user',
      content: `兴趣线：${JSON.stringify(threadTitles)}\n最近想法：${JSON.stringify(recentIdeas.slice(0, 10))}`
    }
  ]
  const out = await llm.chat(messages)
  try {
    const start = out.indexOf('{')
    const end = out.lastIndexOf('}')
    const parsed = JSON.parse(out.slice(start, end + 1)) as { queries?: unknown; note?: unknown }
    const queries = Array.isArray(parsed.queries)
      ? parsed.queries.filter((q): q is string => typeof q === 'string').slice(0, 5)
      : []
    return { queries, note: typeof parsed.note === 'string' ? parsed.note : '' }
  } catch {
    return { queries: [], note: '（研究计划生成失败，请稍后重试）' }
  }
}
