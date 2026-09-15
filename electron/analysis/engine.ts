import { Repo } from '../db/repository'
import { LLMAdapter, ChatMessage, ToolSpec, ToolCall } from '../adapters/llm'
import { AnalysisTools } from './tools'
import { Report } from '../db/repository'

const MAX_TOOL_CALLS = 6

const TOOL_SPECS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'query_entries',
      description:
        '查询用户的本地生活记录。可按关键词全文检索，或按类型+日期范围过滤。返回条目数组（含 id、日期、类型、内容）。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '全文检索关键词（与 kind/date 二选一）' },
          kind: {
            type: 'string',
            enum: ['sleep', 'event', 'conversation', 'quote', 'idea', 'other'],
            description: '条目类型过滤'
          },
          dateFrom: { type: 'string', description: '起始日期 YYYY-MM-DD' },
          dateTo: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          limit: { type: 'number', description: '最多返回条数，默认 50' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_thread',
      description: '查询用户的长期兴趣线（threads）。可选按标题模糊过滤。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '兴趣线标题关键词（可选）' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'correlate',
      description:
        '计算两个按日聚合指标的相关系数（至少需要 3 天数据）。指标支持 sleep.hours（当日平均睡眠）与 event.negative_count（当日负面事件数）。',
      parameters: {
        type: 'object',
        properties: {
          metricA: { type: 'string', enum: ['sleep.hours', 'event.negative_count'] },
          metricB: { type: 'string', enum: ['sleep.hours', 'event.negative_count'] },
          dateFrom: { type: 'string', description: '起始日期 YYYY-MM-DD' },
          dateTo: { type: 'string', description: '结束日期 YYYY-MM-DD' }
        },
        required: ['metricA', 'metricB', 'dateFrom', 'dateTo']
      }
    }
  }
]

const SYSTEM_PROMPT = `你是 MindTrace 的个人成长分析师。用户会给你某一天的全部生活记录（睡眠、事件、对话、句子、想法）。你的任务是为用户写一份有价值的中文日报。

写作要求：
1. **不要复述**记录内容，要提炼：概况一段带过；重点放在规律、联系、用户自己可能没意识到的点。
2. 主动使用工具深入挖掘：检索相关历史（query_entries）、查看兴趣线（get_thread）、计算相关性（correlate）。**工具调用不超过 6 次。**
3. 报告须包含这些小节：## 今天概况 / ## 规律与洞察 / ## 兴趣线推进（如有）/ ## 明日建议
4. 若兴趣线有推进，在「兴趣线推进」小节说明这条线是什么、今天的记录如何推进了它。

最终输出：一个 JSON 对象（不要 markdown 代码块），形如：
{
  "report_md": "完整的 Markdown 报告正文",
  "threads": [
    { "title": "兴趣线标题（简短）", "description": "这条线在关注什么", "status": "active|done", "linked_entry_ids": [相关条目id] }
  ]
}
threads 可为空数组；只有真正形成持续关注主题时才建线。`

interface ThreadPayload {
  title: string
  description?: string
  status?: string
  linked_entry_ids?: number[]
}

function extractJsonObject(text: string): { report_md?: string; threads?: ThreadPayload[] } {
  const trimmed = text.trim()
  let candidate = trimmed
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) candidate = fence[1].trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) candidate = candidate.slice(start, end + 1)
  return JSON.parse(candidate)
}

export class AnalyzeEngine {
  private tools: AnalysisTools

  constructor(
    private repo: Repo,
    private llm: LLMAdapter
  ) {
    this.tools = new AnalysisTools(repo)
  }

  /** 生成某日日报。当日无 entries 返回 null。 */
  async analyzeDay(date: string): Promise<Report | null> {
    const dayEntries = await this.repo.listEntries({
      dateFrom: date,
      dateTo: date,
      limit: 500
    })
    if (!dayEntries.length) return null

    const digest = dayEntries.map(e => ({
      id: e.id,
      kind: e.kind,
      created_at: e.created_at,
      content: JSON.parse(e.content)
    }))

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `日期：${date}\n当日记录（JSON）：\n${JSON.stringify(digest, null, 2)}`
      }
    ]

    let toolCalls = 0
    let finalText = ''
    let degraded = false

    for (let round = 0; round <= MAX_TOOL_CALLS; round++) {
      const isFinalRound = round === MAX_TOOL_CALLS
      let msg: { content: string | null; tool_calls?: ToolCall[] }
      try {
        msg = await this.llm.chatFull(
          messages,
          isFinalRound ? {} : { tools: TOOL_SPECS }
        )
      } catch {
        degraded = true
        break
      }
      messages.push({
        role: 'assistant',
        content: msg.content ?? null,
        ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {})
      })

      if (!msg.tool_calls?.length) {
        finalText = msg.content ?? ''
        break
      }
      for (const tc of msg.tool_calls) {
        if (toolCalls >= MAX_TOOL_CALLS) continue
        toolCalls++
        let result: string
        try {
          result = await this.executeTool(tc)
        } catch (e) {
          result = JSON.stringify({ error: String((e as Error).message ?? e) })
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
      if (toolCalls >= MAX_TOOL_CALLS) {
        messages.push({
          role: 'user',
          content: '工具调用次数已达上限，请立即基于已有信息输出最终 JSON 报告。'
        })
      }
    }

    let reportMd = ''
    let threads: ThreadPayload[] = []
    try {
      const payload = extractJsonObject(finalText)
      reportMd = payload.report_md ?? finalText
      threads = Array.isArray(payload.threads) ? payload.threads : []
    } catch {
      // 输出不是 JSON：若内容看起来像完整报告则直接采用，否则标记降级
      if (finalText.includes('##')) {
        reportMd = finalText
      } else {
        degraded = true
        reportMd = finalText || '（报告生成失败，请稍后重试）'
      }
    }

    const quotedIds = this.collectQuotedIds(dayEntries, reportMd, threads)

    // 更新兴趣线（按 title 幂等）
    const threadIdMap = new Map<number, number>()
    for (const t of threads) {
      if (!t.title) continue
      const th = await this.repo.upsertThread({
        title: t.title,
        description: t.description ?? '',
        status: t.status ?? 'active'
      })
      for (const eid of t.linked_entry_ids ?? []) {
        await this.repo.associateEntryToThread(eid, th.id)
      }
      threadIdMap.set(th.id, th.id)
    }

    const meta = {
      generated_at: new Date().toISOString(),
      tool_calls: toolCalls,
      quoted_entry_ids: quotedIds,
      entries_count: dayEntries.length,
      threads: threads.map(t => t.title),
      degraded
    }

    return this.repo.insertReport({
      type: 'daily',
      period: date,
      content_md: reportMd,
      meta: JSON.stringify(meta)
    })
  }

  /** 生成某日所在周的周报（汇总 7 天 entries + 引用已有日报） */
  async analyzeWeek(weekEndDate: string): Promise<Report | null> {
    const end = new Date(weekEndDate)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    const fmt = (d: Date): string => d.toISOString().slice(0, 10)
    const dateFrom = fmt(start)
    const dateTo = fmt(end)

    const entries = await this.repo.listEntries({ dateFrom, dateTo, limit: 2000 })
    if (!entries.length) return null

    const dailyReports = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      const r = await this.repo.getReport('daily', fmt(d))
      if (r) dailyReports.push({ period: r.period, summary: r.content_md.slice(0, 500) })
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是 MindTrace 的个人成长分析师。请基于一周的生活记录与已有日报，写一份中文周报。要求：提炼一周的规律与变化（对比前半周与后半周）、推进中的兴趣线、下周建议。小节：## 一周概况 / ## 规律与变化 / ## 兴趣线进展 / ## 下周建议。直接输出 Markdown 正文，不要代码块。`
      },
      {
        role: 'user',
        content: `周期：${dateFrom} 至 ${dateTo}\n\n本周记录条数：${entries.length}\n\n已有日报摘要：\n${JSON.stringify(dailyReports, null, 2)}\n\n本周全部条目（JSON）：\n${JSON.stringify(
          entries.map(e => ({ id: e.id, date: e.entry_date, kind: e.kind, content: JSON.parse(e.content) })),
          null, 2
        ).slice(0, 20000)}`
      }
    ]

    let md = ''
    try {
      md = await this.llm.chat(messages)
    } catch {
      md = '（周报生成失败，请稍后重试）'
    }

    return this.repo.insertReport({
      type: 'weekly',
      period: dateTo,
      content_md: md,
      meta: JSON.stringify({
        generated_at: new Date().toISOString(),
        date_from: dateFrom,
        date_to: dateTo,
        entries_count: entries.length
      })
    })
  }

  private async executeTool(tc: ToolCall): Promise<string> {
    const args = JSON.parse(tc.function.arguments || '{}')
    switch (tc.function.name) {
      case 'query_entries':
        return this.tools.query_entries(args)
      case 'get_thread':
        return this.tools.get_thread(args)
      case 'correlate':
        return this.tools.correlate(args)
      default:
        return JSON.stringify({ error: `unknown tool: ${tc.function.name}` })
    }
  }

  private collectQuotedIds(
    dayEntries: { id: number; content: string }[],
    reportMd: string,
    threads: ThreadPayload[]
  ): number[] {
    const ids = new Set<number>()
    for (const t of threads) for (const id of t.linked_entry_ids ?? []) ids.add(id)
    // 从报告文本中引用了原文关键词的条目也算"被引用"
    for (const e of dayEntries) {
      try {
        const c = JSON.parse(e.content) as { text?: string }
        if (c.text && c.text.length > 3 && reportMd.includes(c.text.slice(0, 12))) ids.add(e.id)
      } catch {
        // ignore
      }
    }
    return [...ids]
  }
}
