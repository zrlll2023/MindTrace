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
}

export class CaptureHistory {
  constructor(private db: Database) {}

  list(): CaptureMessage[] {
    const r = this.db.exec('SELECT * FROM capture_messages ORDER BY id')
    if (!r.length) return []
    return r[0].values.map(values => {
      const row = Object.fromEntries(r[0].columns.map((c, i) => [c, values[i]])) as Record<string, unknown>
      return {
        id: Number(row.id), role: row.role as 'user' | 'assistant', text: String(row.text ?? ''),
        parsed: row.parsed_json ? JSON.parse(String(row.parsed_json)) : undefined,
        profileDraft: row.profile_draft_json ? JSON.parse(String(row.profile_draft_json)) : undefined,
        committed: Number(row.committed) === 1, error: String(row.error ?? '') || undefined,
        createdAt: String(row.created_at ?? ''),
        archivedEntryIds: row.archived_entry_ids_json ? JSON.parse(String(row.archived_entry_ids_json)) : undefined
      }
    })
  }

  add(role: 'user' | 'assistant', text: string, opts: { parsed?: ParsedEntry[]; profileDraft?: ProfileValues; error?: string } = {}): CaptureMessage {
    this.db.run(
      'INSERT INTO capture_messages (role, text, parsed_json, profile_draft_json, error) VALUES (?, ?, ?, ?, ?)',
      [role, text, opts.parsed ? JSON.stringify(opts.parsed) : null, opts.profileDraft ? JSON.stringify(opts.profileDraft) : null, opts.error ?? '']
    )
    return this.list().at(-1)!
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

  clear(): void { this.db.run('DELETE FROM capture_messages') }

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
