import { validateEntryMoment, validateParsedEntry } from './analysis/validators'
import { CaptureHistory } from './db/capture'
import { KnowledgeBase } from './db/knowledge'
import { Entry, NewEntry, Repo } from './db/repository'

export interface CaptureChoice {
  kind: string
  content: object
  confidence: number
  entryDate: string
  entryTime?: string
  originalKind?: string
  addToKnowledge?: boolean
  folderId?: number
  reason?: string
}

function knowledgeText(content: Record<string, unknown>, raw: string): string {
  return typeof content.text === 'string' ? content.text : raw || JSON.stringify(content, null, 2)
}

function knowledgeTitle(kind: string, text: string): string {
  const names: Record<string, string> = { event: '事件', conversation: '对话', quote: '句子', idea: '想法', other: '记录' }
  const compact = text.replace(/\s+/g, ' ').trim()
  return `${names[kind] ?? '记录'}：${compact.slice(0, 48) || '未命名'}`
}

export async function commitCaptureEntries(repo: Repo, messageId: number, entries: CaptureChoice[]): Promise<Entry[]> {
  if (!entries.length) throw new Error('没有可保存的记录')
  const db = repo.getDb()
  const history = new CaptureHistory(db)
  const messages = history.list()
  const assistantIndex = messages.findIndex(message => message.id === messageId && message.role === 'assistant')
  if (assistantIndex <= 0 || messages[assistantIndex].committed) throw new Error('待确认的 AI 解析结果不存在或已归档')
  const raw = [...messages.slice(0, assistantIndex)].reverse().find(message => message.role === 'user')?.text ?? ''
  const saved: Entry[] = []
  const kb = new KnowledgeBase(db)

  db.run('BEGIN')
  try {
    for (const [index, entry] of entries.entries()) {
      if (entry.kind === 'sleep' && entry.originalKind !== 'sleep') {
        throw new Error(`第 ${index + 1} 条记录：非睡眠内容不能改为睡眠`)
      }
      const moment = validateEntryMoment(entry.entryDate, entry.entryTime)
      if (!moment.ok) throw new Error(`第 ${index + 1} 条记录：${moment.reason}`)
      const validated = validateParsedEntry(entry)
      if (!validated.ok || !validated.entry) throw new Error(`第 ${index + 1} 条记录内容无效`)
      const value = validated.entry
      const newEntry: NewEntry = {
        raw_text: raw,
        kind: value.kind,
        content: JSON.stringify(value.content),
        confidence: value.confidence,
        source: 'chat',
        entry_date: entry.entryDate,
        entry_time: entry.entryTime || null
      }
      const savedEntry = await repo.insertEntry(newEntry)
      saved.push(savedEntry)
      if (value.kind !== 'sleep' && entry.addToKnowledge) {
        const folderId = entry.folderId ?? kb.ensureSystemFolder('ai_quick_capture', 'AI 快速记录').id
        if (!kb.listFolders().some(folder => folder.id === folderId)) throw new Error('选择的知识库文件夹不存在')
        const body = knowledgeText(value.content, raw)
        kb.addItem({
          folderId,
          title: knowledgeTitle(value.kind, body),
          sourceType: 'entry',
          body,
          reason: entry.reason,
          sourceEntryId: savedEntry.id
        })
      }
    }
    history.markCommitted(messageId, `已保存 ${saved.length} 条到时间线`)
    db.run('COMMIT')
    repo.save()
    return saved
  } catch (error) {
    try { db.run('ROLLBACK') } catch { /* no active transaction */ }
    throw error
  }
}
