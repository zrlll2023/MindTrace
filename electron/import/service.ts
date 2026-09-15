import { unzipSync } from 'fflate'
import { parseChatGPTExport, ImportedConversation } from './chatgpt'
import { parseClaudeExport } from './claude'
import { Repo, NewEntry } from '../db/repository'

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
  imported: number
  skipped: number
}

const MAX_IMPORT_CONVERSATIONS = 2000

/** 将解析出的会话写入 entries（kind=conversation，按消息粒度去重） */
export async function importConversations(
  repo: Repo,
  conversations: ImportedConversation[]
): Promise<ImportSummary> {
  const limited = conversations.slice(0, MAX_IMPORT_CONVERSATIONS)
  const newEntries: (NewEntry & { dedup_key: string })[] = []

  limited.forEach((conv, ci) => {
    const convKey = `${conv.source}:${ci}:${conv.title}`.slice(0, 120)
    conv.messages.forEach((m, mi) => {
      newEntries.push({
        raw_text: m.content,
        kind: 'conversation',
        content: JSON.stringify({
          text: m.content,
          with: conv.title,
          role: m.role,
          conversation: conv.title
        }),
        confidence: 1,
        source: `import:${conv.source}`,
        entry_date: conv.date,
        dedup_key: `${conv.source}:${conv.title}:${m.timestamp ?? mi}:${mi}`.slice(0, 180)
      })
      void convKey
    })
  })

  const keys = newEntries.map(e => e.dedup_key)
  const existing = await repo.existingDedupKeys(keys)
  const toInsert = newEntries.filter(e => !existing.has(e.dedup_key))

  for (const e of toInsert) {
    await repo.insertEntry(e)
  }
  repo.save()

  return {
    conversations: limited.length,
    imported: toInsert.length,
    skipped: newEntries.length - toInsert.length
  }
}
