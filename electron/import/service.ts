import { unzipSync } from 'fflate'
import { parseChatGPTExport, ImportedConversation } from './chatgpt'
import { parseClaudeExport } from './claude'
import { Repo, NewEntry } from '../db/repository'
import { KnowledgeBase } from '../db/knowledge'
import crypto from 'node:crypto'

/** 从导出 ZIP 中提取会话（自动识别 ChatGPT / Claude） */
export function parseExportZip(zipBytes: Uint8Array): ImportedConversation[] {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(zipBytes)
  } catch {
    throw new Error('无法读取 ZIP 文件，请确认是官方导出的原始 ZIP')
  }

  const convFile =
    Object.keys(files).find(f => f.endsWith('conversations.json')) ??
    Object.keys(files).find(f => f.endsWith('.json'))

  if (!convFile) throw new Error('ZIP 中未找到 conversations.json——请上传未解压的官方导出包')

  const jsonText = new TextDecoder().decode(files[convFile])

  // ChatGPT 的 mapping 结构 vs Claude 的 chat_messages 结构
  const probe = JSON.parse(jsonText)
  if (Array.isArray(probe) && probe.some(c => c?.mapping)) {
    return parseChatGPTExport(jsonText)
  }
  if (Array.isArray(probe) && probe.some(c => c?.chat_messages)) {
    return parseClaudeExport(jsonText)
  }
  throw new Error('无法识别的导出格式（既非 ChatGPT 也非 Claude）')
}

export interface ImportSummary {
  conversations: number
  knowledgeItems: number
  timelineSummaries: number
  skipped: number
}

const MAX_IMPORT_CONVERSATIONS = 2000

function conversationMarkdown(conv: ImportedConversation): string {
  const lines = [`# ${conv.title}`, '', `- 来源：${conv.source === 'chatgpt' ? 'ChatGPT' : 'Claude'}`, `- 日期：${conv.date}`, `- 消息数：${conv.messages.length}`, '']
  for (const m of conv.messages) {
    const time = m.timestamp ? new Date(m.timestamp * 1000).toLocaleString('zh-CN') : ''
    lines.push(`## ${m.role === 'user' ? '我' : 'AI'}${time ? ` · ${time}` : ''}`, '', m.content, '')
  }
  return lines.join('\n')
}

function importKey(conv: ImportedConversation): string {
  const normalizedContent = JSON.stringify(conv.messages.map(m => [
    m.role,
    m.timestamp,
    m.content.replace(/\r\n/g, '\n').trim()
  ]))
  const contentHash = crypto.createHash('sha256').update(normalizedContent).digest('hex')
  const conversationId = conv.externalId?.trim() || `${conv.title.trim()}\n${conv.date}`
  return crypto.createHash('sha256').update(`${conv.source}\0${conversationId}\0${contentHash}`).digest('hex')
}

/** 每个会话写入一份完整知识资料，并在时间线写一条确定性摘要。 */
export async function importConversations(
  repo: Repo,
  conversations: ImportedConversation[]
): Promise<ImportSummary> {
  const limited = conversations.slice(0, MAX_IMPORT_CONVERSATIONS)
  const db = repo.getDb()
  const kb = new KnowledgeBase(db)
  const folder = kb.ensureSystemFolder('ai_conversation_import', 'AI 对话导入')
  let imported = 0
  let skipped = 0
  db.run('BEGIN')
  try {
    for (const conv of limited) {
      const key = importKey(conv)
      const found = db.exec('SELECT id FROM kb_items WHERE import_key = ?', [key])
      if (found.length) { skipped++; continue }
      const body = conversationMarkdown(conv)
      const item = kb.addItem({ folderId: folder.id, title: conv.title.slice(0, 200), sourceType: 'ai-conversation', body, importKey: key })
      const excerpt = conv.messages.find(m => m.role === 'user')?.content.replace(/\s+/g, ' ').slice(0, 160) ?? ''
      const summary = `导入 ${conv.source === 'chatgpt' ? 'ChatGPT' : 'Claude'} 会话《${conv.title}》，共 ${conv.messages.length} 条消息。${excerpt}`
      const entry: NewEntry = {
        raw_text: summary, kind: 'conversation', confidence: 1, source: `import:${conv.source}`,
        entry_date: conv.date, dedup_key: `conversation:${key}`,
        content: JSON.stringify({ text: summary, conversation: conv.title, messageCount: conv.messages.length, kbItemId: item.id })
      }
      await repo.insertEntry(entry)
      imported++
    }
    db.run('COMMIT')
    repo.save()
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
  return { conversations: limited.length, knowledgeItems: imported, timelineSummaries: imported, skipped }
}
