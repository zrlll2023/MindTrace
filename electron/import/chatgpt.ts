/**
 * ChatGPT 官方数据导出解析器。
 * 导出的 ZIP 内 conversations.json 结构：
 * [{ title, create_time(unix 秒), mapping: { nodeId: { message: { author: { role }, content: { content_type, parts }, create_time } } } }]
 */

export interface ImportedMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number | null // unix 秒
}

export interface ImportedConversation {
  source: 'chatgpt' | 'claude'
  externalId?: string
  title: string
  date: string // YYYY-MM-DD（会话开始日期，本地时区）
  messages: ImportedMessage[]
}

function unixToLocalDate(unixSeconds: number | undefined | null): string {
  if (!unixSeconds) return new Date().toISOString().slice(0, 10)
  const d = new Date(unixSeconds * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function extractText(content: { content_type?: string; parts?: unknown[] }): string | null {
  if (!content || content.content_type !== 'text') return null
  const parts = (content.parts ?? []).filter((p): p is string => typeof p === 'string')
  const joined = parts.join('\n').trim()
  return joined || null
}

export function parseChatGPTExport(jsonText: string): ImportedConversation[] {
  let data: unknown
  try {
    data = JSON.parse(jsonText)
  } catch {
    throw new Error('解析失败：不是有效的 conversations.json')
  }
  if (!Array.isArray(data)) {
    throw new Error('解析失败：conversations.json 顶层应为数组')
  }

  const out: ImportedConversation[] = []
  for (const conv of data as Array<Record<string, unknown>>) {
    const externalId = typeof conv.id === 'string' ? conv.id : undefined
    const title = typeof conv.title === 'string' ? conv.title : '未命名会话'
    const createTime = typeof conv.create_time === 'number' ? conv.create_time : null
    const mapping = conv.mapping as Record<
      string,
      { message?: { author?: { role?: string }; content?: { content_type?: string; parts?: unknown[] }; create_time?: number } } | undefined
    > | undefined

    const messages: ImportedMessage[] = []
    if (mapping && typeof mapping === 'object') {
      // 按时间排序保证对话顺序
      const nodes = Object.values(mapping)
        .map(n => n?.message)
        .filter((m): m is NonNullable<typeof m> => !!m)
        .map(m => ({
          role: m.author?.role,
          content: extractText(m.content ?? {}),
          timestamp: typeof m.create_time === 'number' ? m.create_time : null
        }))
        .filter((m): m is { role: string; content: string; timestamp: number | null } => !!m.content)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
      for (const m of nodes) {
        messages.push({ role: m.role as 'user' | 'assistant', content: m.content, timestamp: m.timestamp })
      }
    }

    out.push({
      source: 'chatgpt',
      externalId,
      title,
      date: unixToLocalDate(createTime ?? messages[0]?.timestamp),
      messages
    })
  }
  return out
}
