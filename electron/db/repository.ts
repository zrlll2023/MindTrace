import { Database } from 'sql.js'
import { HideScope } from '../types'
import { isFtsAvailable, persistDb } from './connection'

export type EntryKind = 'sleep' | 'event' | 'conversation' | 'quote' | 'idea' | 'other'
export type ReportType = 'daily' | 'weekly'
/** 时间线上的三类行：记录条目、知识库操作流水、归档对话会话 */
export type HiddenTarget = 'entry' | 'knowledge' | 'session'

export interface NewEntry {
  raw_text: string
  kind: EntryKind
  content: string
  confidence: number
  source: string
  /** 可选：显式指定所属日期（测试/导入用）；缺省取当天 */
  entry_date?: string
  /** 可选：事件发生时间，HH:mm；null/缺省表示用户未说明 */
  entry_time?: string | null
  /** 可选：导入去重键（如 chatgpt:convId:msgIdx）；相同键不重复导入 */
  dedup_key?: string
}

export interface Entry extends NewEntry {
  id: number
  created_at: string
  entry_date: string
  entry_time: string | null
}

export interface EntryFilter {
  dateFrom?: string
  dateTo?: string
  kind?: EntryKind
  limit?: number
  offset?: number
  /** 连被时间线隐去的记录一起返回：睡眠同日冲突检查需要看全 */
  includeHidden?: boolean
}

/** 时间线合并行：record_type 区分记录条目与知识库操作流水 */
export interface TimelineRow {
  record_type: 'entry' | 'knowledge'
  id: number
  event_date: string
  event_time: string | null
  created_at: string
  hidden_scope: string | null
  raw_text: string | null
  kind: string | null
  content: string | null
  confidence: number | null
  source: string | null
  item_id: number | null
  folder_id: number | null
  action: string | null
  item_title: string | null
  detail: string | null
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

  /** 底层数据库实例（向量存储等模块共用同一连接） */
  getDb(): Database {
    return this.db
  }

  // ---------- entries ----------

  async insertEntry(e: NewEntry): Promise<Entry> {
    const cols = ['raw_text', 'kind', 'content', 'confidence', 'source']
    const vals: (string | number)[] = [e.raw_text, e.kind, e.content, e.confidence, e.source]
    if (e.entry_date) {
      cols.push('entry_date')
      vals.push(e.entry_date)
    }
    if (e.entry_time) {
      cols.push('entry_time')
      vals.push(e.entry_time)
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

  // ---------- 语义搜索支持 ----------

  /** 需要嵌入的条目（无向量或 content 已变更），带 content_hash */
  async entriesNeedingEmbedding(): Promise<
    { id: number; content: string; content_hash: string }[]
  > {
    const crypto = await import('node:crypto')
    const res = this.db.exec(`
      SELECT e.id, e.content, v.content_hash
      FROM entries e
      LEFT JOIN vectors v ON v.entry_id = e.id
    `)
    if (!res.length) return []
    const out: { id: number; content: string; content_hash: string }[] = []
    for (const [id, content, hash] of res[0].values as [number, string, string | null][]) {
      const h = crypto.createHash('sha1').update(content).digest('hex')
      if (hash !== h) out.push({ id, content, content_hash: h })
    }
    return out
  }

  /** 按 id 批量取条目（语义搜索结果关联用）；隐去范围为 all/listing 的不再出现在搜索命中里 */
  async getEntriesByIds(ids: number[]): Promise<Entry[]> {
    if (!ids.length) return []
    const placeholders = ids.map(() => '?').join(',')
    const res = this.db.exec(
      `SELECT * FROM entries WHERE id IN (${placeholders}) AND (hidden_scope IS NULL OR hidden_scope = 'timeline')`,
      ids
    )
    if (!res.length) return []
    return res[0].values.map((_: unknown[], i: number) =>
      this.valuesToEntry(res[0].columns, res[0].values[i])
    )
  }

  async listEntries(filter: EntryFilter): Promise<Entry[]> {
    const where: string[] = []
    const params: (string | number)[] = []
    // 报告、趋势与 AI 取数只隐去 all 范围；冲突检查需要看全，由 includeHidden 放开
    if (!filter.includeHidden) where.push("(hidden_scope IS NULL OR hidden_scope <> 'all')")
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
      ORDER BY entry_date DESC,
        CASE WHEN entry_time IS NULL OR entry_time = '' THEN 1 ELSE 0 END,
        entry_time DESC,
        created_at DESC,
        id DESC
      LIMIT ? OFFSET ?`
    const res = this.db.exec(sql, [...params, limit, offset])
    if (!res.length) return []
    return res[0].values.map(() => null as never).map((_: never[], i: number) =>
      this.valuesToEntry(res[0].columns, res[0].values[i])
    )
  }

  /**
   * 时间线单一游标分页：记录条目与知识库操作流水合成一条流。
   * 分两次查询再前端拼接会让「只有知识操作、没写记录的那一天」永远不出现在分组里。
   */
  async listTimeline(
    filter: EntryFilter & { record?: 'entry' | 'knowledge'; showHidden?: boolean }
  ): Promise<TimelineRow[]> {
    const branches: string[] = []
    const params: (string | number)[] = []
    const wantEntries = filter.record !== 'knowledge'
    // 按记录类型筛选时不混入流水，与对话条目在类型筛选下同样被排除的既有行为一致
    const wantEvents = filter.record === 'knowledge' || (filter.record !== 'entry' && !filter.kind)
    // 时间线默认只见未隐去的行；showHidden 反转为「已隐去」回收视图，供逐行恢复
    const visibility = filter.showHidden ? 'hidden_scope IS NOT NULL' : 'hidden_scope IS NULL'

    if (wantEntries) {
      const where: string[] = [visibility]
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
      branches.push(`SELECT 'entry' AS record_type, id, entry_date AS event_date, entry_time AS event_time, created_at,
          hidden_scope,
          raw_text, kind, content, confidence, source,
          NULL AS item_id, NULL AS folder_id, NULL AS action, NULL AS item_title, NULL AS detail
        FROM entries WHERE ${where.join(' AND ')}`)
    }

    if (wantEvents) {
      const where: string[] = [visibility]
      if (filter.dateFrom) {
        where.push('event_date >= ?')
        params.push(filter.dateFrom)
      }
      if (filter.dateTo) {
        where.push('event_date <= ?')
        params.push(filter.dateTo)
      }
      branches.push(`SELECT 'knowledge' AS record_type, id, event_date, event_time, created_at,
          hidden_scope,
          NULL AS raw_text, NULL AS kind, NULL AS content, NULL AS confidence, NULL AS source,
          item_id, folder_id, action, item_title, detail
        FROM kb_events WHERE ${where.join(' AND ')}`)
    }

    if (!branches.length) return []
    const limit = filter.limit ?? DEFAULT_LIMIT
    const offset = filter.offset ?? 0
    // limit/offset 的 ? 排在所有分支条件之后，与 SQL 文本中占位符的出现顺序一致
    params.push(limit, offset)
    const sql = `SELECT * FROM (${branches.join(' UNION ALL ')})
      ORDER BY event_date DESC,
        CASE WHEN event_time IS NULL OR event_time = '' THEN 1 ELSE 0 END,
        event_time DESC,
        created_at DESC,
        record_type,
        id DESC
      LIMIT ? OFFSET ?`
    const res = this.db.exec(sql, params)
    if (!res.length) return []
    return res[0].values.map((_: unknown[], i: number) =>
      this.valuesToTimelineRow(res[0].columns, res[0].values[i])
    )
  }

  /** 已隐去的行数（记录 + 知识流水 + 有消息的会话），用于时间线的已隐藏入口 */
  async countHidden(): Promise<number> {
    const res = this.db.exec(`
      SELECT (SELECT COUNT(*) FROM entries WHERE hidden_scope IS NOT NULL)
           + (SELECT COUNT(*) FROM kb_events WHERE hidden_scope IS NOT NULL)
           + (SELECT COUNT(*) FROM capture_sessions s
              WHERE s.hidden_scope IS NOT NULL
                AND EXISTS (SELECT 1 FROM capture_messages m WHERE m.session_id = s.id))
    `)
    return Number(res[0]?.values[0]?.[0] ?? 0)
  }

  async searchEntries(keyword: string): Promise<Entry[]> {
    if (!keyword.trim()) return []
    if (this.hasFts()) {
      try {
        // trigram tokenizer：直接用 LIKE 模式作为 FTS 查询，支持子串匹配
        const res = this.db.exec(
          `SELECT e.* FROM entries e
           JOIN entries_fts f ON e.id = f.rowid
           WHERE entries_fts MATCH ? AND (e.hidden_scope IS NULL OR e.hidden_scope = 'timeline')`,
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
      `SELECT * FROM entries WHERE (content LIKE ? OR raw_text LIKE ?)
        AND (hidden_scope IS NULL OR hidden_scope = 'timeline')
       ORDER BY created_at DESC LIMIT 200`,
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

  /** Update corrected structured data while preserving the immutable capture snapshot. */
  async updateEntryContent(id: number, content: string, entryDate?: string, entryTime?: string | null): Promise<void> {
    if (entryDate) {
      this.db.run('UPDATE entries SET content = ?, entry_date = ?, entry_time = ? WHERE id = ?', [content, entryDate, entryTime ?? null, id])
    } else {
      this.db.run('UPDATE entries SET content = ? WHERE id = ?', [content, id])
    }
    this.save()
  }

  /** 删除条目（用户手动操作的完整权利）；同步清理其向量 */
  async deleteEntry(id: number): Promise<void> {
    this.db.run('DELETE FROM entries WHERE id = ?', [id])
    try {
      this.db.run('DELETE FROM vectors WHERE entry_id = ?', [id])
    } catch {
      // vectors 表不存在（旧库未迁移）时忽略
    }
    this.save()
  }

  /** 只切换时间线可见性范围，内容一律不动；表名由固定分支映射，不拼接外部输入 */
  async setHidden(target: HiddenTarget, id: number | string, scope: HideScope | null): Promise<void> {
    const table = target === 'knowledge' ? 'kb_events' : target === 'session' ? 'capture_sessions' : 'entries'
    this.db.run(`UPDATE ${table} SET hidden_scope = ? WHERE id = ?`, [scope, id])
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

  private valuesToTimelineRow(columns: string[], values: unknown[]): TimelineRow {
    const obj: Record<string, unknown> = {}
    columns.forEach((c, i) => (obj[c] = values[i]))
    return obj as unknown as TimelineRow
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
