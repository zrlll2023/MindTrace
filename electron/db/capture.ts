import { Database } from 'sql.js'
import { ParsedEntry, ProfileValues } from '../types'

export interface CaptureMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  parsed?: ParsedEntry[]
  profileDraft?: ProfileValues
  committed: boolean
  error?: string
  createdAt: string
  archivedEntryIds?: number[]
  sessionId: string
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

export interface CaptureSession {
  id: string
  title: string
  status: 'active' | 'archived'
  createdAt: string
  lastMessageAt: string | null
  archivedAt: string | null
  messageCount: number
  tokenCount: number
  /** 时间线隐去范围；null 表示正常显示 */
  hiddenScope: string | null
}

const ACTIVE_SESSION_ID = 'default'

/** 会话标题：压平空白并截断到 24 字，超长补省略号 */
function truncateTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  return flat.length > 24 ? `${flat.slice(0, 24)}…` : flat
}

function newSessionId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export class CaptureHistory {
  constructor(private db: Database) {}

  list(sessionId = 'default'): CaptureMessage[] {
    const r = this.db.exec('SELECT * FROM capture_messages WHERE session_id = ? ORDER BY id', [sessionId])
    if (!r.length) return []
    return r[0].values.map(values => {
      const row = Object.fromEntries(r[0].columns.map((c, i) => [c, values[i]])) as Record<string, unknown>
      return {
        id: Number(row.id), role: row.role as 'user' | 'assistant', text: String(row.text ?? ''),
        parsed: row.parsed_json ? JSON.parse(String(row.parsed_json)) : undefined,
        profileDraft: row.profile_draft_json ? JSON.parse(String(row.profile_draft_json)) : undefined,
        committed: Number(row.committed) === 1, error: String(row.error ?? '') || undefined,
        createdAt: String(row.created_at ?? ''),
        archivedEntryIds: row.archived_entry_ids_json ? JSON.parse(String(row.archived_entry_ids_json)) : undefined,
        sessionId: String(row.session_id ?? 'default'),
        usage: row.usage_json ? JSON.parse(String(row.usage_json)) : undefined
      }
    })
  }

  add(role: 'user' | 'assistant', text: string, opts: { parsed?: ParsedEntry[]; profileDraft?: ProfileValues; error?: string; usage?: CaptureMessage['usage']; sessionId?: string } = {}): CaptureMessage {
    const sessionId = opts.sessionId ?? ACTIVE_SESSION_ID
    this.db.run(
      'INSERT INTO capture_messages (role, text, parsed_json, profile_draft_json, error, session_id, usage_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [role, text, opts.parsed ? JSON.stringify(opts.parsed) : null, opts.profileDraft ? JSON.stringify(opts.profileDraft) : null, opts.error ?? '', sessionId, opts.usage ? JSON.stringify(opts.usage) : null]
    )
    const msg = this.list(sessionId).at(-1)!
    this.touchSession(sessionId, msg.createdAt, role === 'user' ? text : undefined)
    return msg
  }

  /** 写消息后同步会话元数据：确保会话行存在、刷新最近消息时间，并用首条用户消息补默认标题 */
  private touchSession(sessionId: string, messageAt: string, firstUserText?: string): void {
    this.db.run(
      `INSERT INTO capture_sessions (id, title, status, created_at, last_message_at)
       VALUES (?, '', 'active', ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_message_at = excluded.last_message_at`,
      [sessionId, messageAt, messageAt]
    )
    if (firstUserText != null) {
      const title = truncateTitle(firstUserText)
      if (title) {
        this.db.run(
          "UPDATE capture_sessions SET title = ? WHERE id = ? AND (title IS NULL OR title = '')",
          [title, sessionId]
        )
      }
    }
  }

  has(id: number): boolean {
    const result = this.db.exec('SELECT 1 FROM capture_messages WHERE id = ? LIMIT 1', [id])
    return result.length > 0 && result[0].values.length > 0
  }

  markCommitted(id: number, entryIds: number[], parsed: unknown[]): void {
    this.db.run(
      'UPDATE capture_messages SET committed = 1, parsed_json = ?, archived_entry_ids_json = ?, error = ? WHERE id = ?',
      [JSON.stringify(parsed), JSON.stringify(entryIds), '', id]
    )
  }

  markUncommitted(id: number): void {
    this.db.run(
      'UPDATE capture_messages SET committed = 0, archived_entry_ids_json = NULL, error = ? WHERE id = ?',
      ['', id]
    )
  }

  /** 会话默认标题：第一条非空用户消息，截断处理 */
  defaultTitle(sessionId = ACTIVE_SESSION_ID): string {
    const r = this.db.exec(
      "SELECT text FROM capture_messages WHERE session_id = ? AND role = 'user' AND text <> '' ORDER BY id LIMIT 1",
      [sessionId]
    )
    if (!r.length || !r[0].values.length) return ''
    return truncateTitle(String(r[0].values[0][0] ?? ''))
  }

  /**
   * 归档当前活跃会话：把 'default' 的全部消息整体迁到一个新会话 id，冻结时间并落标题。
   * 修复旧实现按每条消息 id 拆分 session 的错误。无消息时不产生空会话。
   */
  archiveSession(title?: string): string {
    const countRes = this.db.exec("SELECT COUNT(*), MIN(created_at), MAX(created_at) FROM capture_messages WHERE session_id = 'default'")
    const count = countRes.length ? Number(countRes[0].values[0][0]) : 0
    if (!count) {
      this.db.run("DELETE FROM capture_sessions WHERE id = 'default'")
      return ''
    }
    const createdAt = String(countRes[0].values[0][1] ?? '')
    const lastMessageAt = String(countRes[0].values[0][2] ?? '')
    const finalTitle = (title && title.trim()) ? truncateTitle(title) : this.defaultTitle(ACTIVE_SESSION_ID)
    const newId = newSessionId()
    this.db.run("UPDATE capture_messages SET session_id = ? WHERE session_id = 'default'", [newId])
    this.db.run(
      `INSERT INTO capture_sessions (id, title, status, created_at, last_message_at, archived_at)
       VALUES (?, ?, 'archived', ?, ?, datetime('now', 'localtime'))`,
      [newId, finalTitle, createdAt, lastMessageAt]
    )
    this.db.run("DELETE FROM capture_sessions WHERE id = 'default'")
    return newId
  }

  sessions(): CaptureSession[] {
    const r = this.db.exec(`
      SELECT s.id, s.title, s.status, s.created_at, s.last_message_at, s.archived_at,
             COUNT(m.id),
             COALESCE(SUM(CAST(json_extract(m.usage_json, '$.totalTokens') AS INTEGER)), 0),
             s.hidden_scope
      FROM capture_sessions s
      LEFT JOIN capture_messages m ON m.session_id = s.id
      GROUP BY s.id
      HAVING COUNT(m.id) > 0
      ORDER BY CASE WHEN s.status = 'active' THEN 0 ELSE 1 END,
               COALESCE(s.last_message_at, s.created_at) DESC,
               s.created_at DESC
    `)
    if (!r.length) return []
    return r[0].values.map(v => ({
      id: String(v[0]),
      title: String(v[1] ?? ''),
      status: (v[2] === 'active' ? 'active' : 'archived') as 'active' | 'archived',
      createdAt: String(v[3] ?? ''),
      lastMessageAt: v[4] != null ? String(v[4]) : null,
      archivedAt: v[5] != null ? String(v[5]) : null,
      messageCount: Number(v[6]),
      tokenCount: Number(v[7]),
      // 记录页仍要能打开被时间线隐去的会话，可见性由时间线自己判
      hiddenScope: v[8] ? String(v[8]) : null
    }))
  }

  context(maxMessages = 20, maxChars = 12000): { role: 'user' | 'assistant'; content: string }[] {
    const out: { role: 'user' | 'assistant'; content: string }[] = []
    let chars = 0
    for (const m of this.list().slice().reverse()) {
      if (!m.text) continue
      if (out.length >= maxMessages || chars + m.text.length > maxChars) break
      out.unshift({ role: m.role, content: m.text })
      chars += m.text.length
    }
    return out
  }
}
