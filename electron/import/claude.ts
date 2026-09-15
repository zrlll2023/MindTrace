/**
 * Claude（claude.ai）官方数据导出解析器。
 * 导出的 conversations.json 结构：
 * [{ name, created_at(ISO), chat_messages: [{ sender: 'human'|'assistant', text, created_at }] }]
 */
import { ImportedConversation, ImportedMessage } from './chatgpt'

function isoToLocalDate(iso: string | undefined): string {
  if (!iso) return new Date().toISOString().slice(0, 10)
  const d = new Date(iso)
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseClaudeExport(jsonText: string): ImportedConversation[] {
  let data: unknown
  try {
    data = JSON.parse(jsonText)
  } catch {
    throw new Error('解析失败：不是有效的 conversations.json')
  }
  if (!Array.isArray(data) || data.length === 0) {
    // Claude 导出可能为空数组（无会话）
    if (Array.isArray(data)) return []
    throw new Error('解析失败：结构不符（顶层应为数组）')
  }

  const out: ImportedConversation[] = []
  for (const conv of data as Array<Record<string, unknown>>) {
    const externalId = typeof conv.uuid === 'string' ? conv.uuid : undefined
    const title = typeof conv.name === 'string' ? conv.name : '未命名会话'
    const createdAt = typeof conv.created_at === 'string' ? conv.created_at : undefined
    const rawMessages = Array.isArray(conv.chat_messages) ? conv.chat_messages : []

    const messages: ImportedMessage[] = rawMessages
      .map((m: Record<string, unknown>) => ({
        role: m.sender === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: typeof m.text === 'string' ? m.text.trim() : '',
        timestamp: typeof m.created_at === 'string' ? Math.floor(new Date(m.created_at).getTime() / 1000) : null
      }))
      .filter(m => m.content)

    out.push({
      source: 'claude',
      externalId,
      title,
      date: isoToLocalDate(createdAt),
      messages
    })
  }
  return out
}
