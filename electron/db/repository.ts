import { Database } from 'sql.js'
import { isFtsAvailable, persistDb } from './connection'

export type EntryKind = 'sleep' | 'event' | 'conversation' | 'quote' | 'idea' | 'other'
export type ReportType = 'daily' | 'weekly'

export interface NewEntry {
  raw_text: string
  kind: EntryKind
  content: string
  confidence: number
  source: string
  /** 可选：显式指定所属日期（测试/导入用）；缺省取当天 */
  entry_date?: string
  /** 可选：导入去重键（如 chatgpt:convId:msgIdx）；相同键不重复导入 */
  dedup_key?: string
}

export interface Entry extends NewEntry {
  id: number
  created_at: string
  entry_date: string
}

export interface EntryFilter {
  dateFrom?: string
  dateTo?: string
  kind?: EntryKind
  limit?: number
  offset?: number
}

export interface NewReport {
  type: ReportType
  period: string
  content_md: string
  meta: string
}

export interface Report extends NewReport {
  id: number
  created_at: string
}

export interface Thread {
  id: number
  title: string
  description: string
  status: string
  created_at: string
  updated_at: string
}

export interface NewThread {
  title: string
  description?: string
  status?: string
}

const DEFAULT_LIMIT = 200

export class Repo {
  constructor(
    private db: Database,
    private dataDir: string = ':memory:'
  ) {}

  private ftsAvailable: boolean | null = null

  private hasFts(): boolean {
    if (this.ftsAvailable === null) this.ftsAvailable = isFtsAvailable(this.db)
    return this.ftsAvailable
  }

  /** 持久化数据库到磁盘（文件模式时） */
  save(): void {
    persistDb(this.db, this.dataDir)
  }

  // ---------- entries ----------

  async insertEntry(e: NewEntry): Promise<Entry> {
    const cols = ['raw_text', 'kind', 'content', 'confidence', 'source']
    const vals: (string | number)[] = [e.raw_text, e.kind, e.content, e.confidence, e.source]
    if (e.entry_date) {
      cols.push('entry_date')
      vals.push(e.entry_date)
    }
    if (e.dedup_key) {
      cols.push('dedup_key')
      vals.push(e.dedup_key)
    }
    this.db.run(
      `INSERT INTO entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      vals
    )
    const id = this.lastId()
    const row = this.db.exec('SELECT * FROM entries WHERE id = ?', [id])[0]
    return this.rowToEntry(row)
  }

  /** 导入去重：返回已存在的 dedup_key 集合 */
  async existingDedupKeys(keys: string[]): Promise<Set<string>> {
    const found = new Set<string>()
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500)
      const placeholders = chunk.map(() => '?').join(',')
      const res = this.db.exec(
        `SELECT dedup_key FROM entries WHERE dedup_key IN (${placeholders})`,
        chunk
      )
      if (res.length) for (const v of res[0].values) found.add(v[0] as string)
    }
    return found
  }

  async listEntries(filter: EntryFilter): Promise<Entry[]> {
    const where: string[] = []
    const params: (string | number)[] = []
    if (filter.dateFrom) {
      where.push('entry_date >= ?')
      params.push(filter.dateFrom)
    }
    if (filter.dateTo) {
      where.push('entry_date <= ?')
      params.push(filter.dateTo)
    }
    if (filter.kind) {
      where.push('kind = ?')
      params.push(filter.kind)
    }
    const limit = filter.limit ?? DEFAULT_LIMIT
    const offset = filter.offset ?? 0
    const sql = `SELECT * FROM entries
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`
    const res = this.db.exec(sql, [...params, limit, offset])
    if (!res.length) return []
    return res[0].values.map(() => null as never).map((_: never[], i: number) =>
      this.valuesToEntry(res[0].columns, res[0].values[i])
    )
  }

  async searchEntries(keyword: string): Promise<Entry[]> {
    if (!keyword.trim()) return []
    if (this.hasFts()) {
      try {
        // trigram tokenizer：直接用 LIKE 模式作为 FTS 查询，支持子串匹配
        const res = this.db.exec(
          `SELECT e.* FROM entries e
           JOIN entries_fts f ON e.id = f.rowid
           WHERE entries_fts MATCH ?`,
          [`"${keyword.replace(/"/g, '""')}"`]
        )
        if (res.length) return res[0].values.map((_: unknown[], i: number) => this.valuesToEntry(res[0].columns, res[0].values[i]))
        return []
      } catch {
        // FTS 查询语法问题则降级
      }
    }
    const like = `%${keyword}%`
    const res = this.db.exec(
      'SELECT * FROM entries WHERE content LIKE ? OR raw_text LIKE ? ORDER BY created_at DESC LIMIT 200',
      [like, like]
    )
    if (!res.length) return []
    return res[0].values.map((_: unknown[], i: number) => this.valuesToEntry(res[0].columns, res[0].values[i]))
  }

  async getEntry(id: number): Promise<Entry | null> {
    const res = this.db.exec('SELECT * FROM entries WHERE id = ?', [id])
    if (!res.length) return null
    return this.valuesToEntry(res[0].columns, res[0].values[0])
  }

  /** 仅更新 content；raw_text 永不修改（spec §4.1） */
  async updateEntryContent(id: number, content: string): Promise<void> {
    this.db.run('UPDATE entries SET content = ? WHERE id = ?', [content, id])
    this.save()
  }

  // ---------- reports ----------

  async insertReport(r: NewReport): Promise<Report> {
    this.db.run(
      `INSERT INTO reports (type, period, content_md, meta) VALUES (?, ?, ?, ?)
       ON CONFLICT(type, period) DO UPDATE SET content_md = excluded.content_md, meta = excluded.meta`,
      [r.type, r.period, r.content_md, r.meta]
    )
    const res = this.db.exec('SELECT * FROM reports WHERE type = ? AND period = ?', [r.type, r.period])
    return this.valuesToReport(res[0].columns, res[0].values[0])
  }

  async getReport(type: ReportType, period: string): Promise<Report | null> {
    const res = this.db.exec('SELECT * FROM reports WHERE type = ? AND period = ?', [type, period])
    if (!res.length) return null
    return this.valuesToReport(res[0].columns, res[0].values[0])
  }

  async listReports(type?: ReportType): Promise<Report[]> {
    const res = type
      ? this.db.exec('SELECT * FROM reports WHERE type = ? ORDER BY period DESC', [type])
      : this.db.exec('SELECT * FROM reports ORDER BY period DESC')
    if (!res.length) return []
    return res[0].values.map((_: unknown[], i: number) => this.valuesToReport(res[0].columns, res[0].values[i]))
  }

  // ---------- threads ----------

  async upsertThread(t: NewThread): Promise<Thread> {
    this.db.run(
      `INSERT INTO threads (title, description, status) VALUES (?, ?, ?)
       ON CONFLICT(title) DO UPDATE SET
         description = excluded.description,
         status = excluded.status,
         updated_at = datetime('now', 'localtime')`,
      [t.title, t.description ?? '', t.status ?? 'active']
    )
    const res = this.db.exec('SELECT * FROM threads WHERE title = ?', [t.title])
    return this.rowToThread(res[0])
  }

  async listThreads(): Promise<Thread[]> {
    const res = this.db.exec('SELECT * FROM threads ORDER BY updated_at DESC')
    if (!res.length) return []
    return res[0].values.map((_: unknown[], i: number) => this.rowToThreadFromValues(res[0].columns, res[0].values[i]))
  }

  async associateEntryToThread(entryId: number, threadId: number): Promise<void> {
    this.db.run(
      'INSERT OR IGNORE INTO entry_threads (entry_id, thread_id) VALUES (?, ?)',
      [entryId, threadId]
    )
  }

  async getThreadByTitle(title: string): Promise<Thread | null> {
    const res = this.db.exec('SELECT * FROM threads WHERE title = ?', [title])
    if (!res.length) return null
    return this.rowToThread(res[0])
  }

  // ---------- settings ----------

  async getSetting(key: string): Promise<string | null> {
    const res = this.db.exec('SELECT value FROM settings WHERE key = ?', [key])
    if (!res.length) return null
    return res[0].values[0][0] as string
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    )
  }

  // ---------- internals ----------

  private lastId(): number {
    const res = this.db.exec('SELECT last_insert_rowid()')
    return res[0].values[0][0] as number
  }

  private rowToEntry(row: { columns: string[]; values: unknown[][] }): Entry {
    return this.valuesToEntry(row.columns, row.values[0])
  }

  private valuesToEntry(columns: string[], values: unknown[]): Entry {
    const obj: Record<string, unknown> = {}
    columns.forEach((c, i) => (obj[c] = values[i]))
    return obj as unknown as Entry
  }

  private valuesToReport(columns: string[], values: unknown[]): Report {
    const obj: Record<string, unknown> = {}
    columns.forEach((c, i) => (obj[c] = values[i]))
    return obj as unknown as Report
  }

  private rowToThread(row: { columns: string[]; values: unknown[][] }): Thread {
    return this.rowToThreadFromValues(row.columns, row.values[0])
  }

  private rowToThreadFromValues(columns: string[], values: unknown[]): Thread {
    const obj: Record<string, unknown> = {}
    columns.forEach((c, i) => (obj[c] = values[i]))
    return obj as unknown as Thread
  }
}
