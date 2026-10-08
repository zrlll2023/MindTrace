import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import path from 'node:path'
import fs from 'node:fs'

let SQL: SqlJsStatic | null = null

/**
 * 定位 sql-wasm.wasm：
 * - 开发/测试环境：从 node_modules 读取
 * - Electron 打包后：从 extraResources 目录读取
 */
function locateWasmPath(): string {
  const candidates = [
    // 打包后：extraResources（process.resourcesPath）
    (process as unknown as { resourcesPath?: string }).resourcesPath &&
      path.join((process as unknown as { resourcesPath: string }).resourcesPath, 'sql-wasm.wasm'),
    // 显式指定（测试用）
    process.env.MINDTRACE_WASM_DIR && path.join(process.env.MINDTRACE_WASM_DIR, 'sql-wasm.wasm'),
    // 开发环境：node_modules
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  ].filter(Boolean) as string[]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
}

/**
 * 初始化数据库（sql.js）。
 * @param dataDir 数据目录；传入 ':memory:' 时使用内存库（测试用）
 * 返回的实例已建好全部表结构；对于文件库，内容由调用方调用 persist 持久化。
 */
export async function initDb(dataDir: string): Promise<Database> {
  if (!SQL) {
    const wasmBinary = fs.readFileSync(locateWasmPath())
    SQL = await initSqlJs({ wasmBinary: wasmBinary as unknown as ArrayBuffer })
  }

  if (dataDir === ':memory:') {
    const db = new SQL.Database()
    migrate(db)
    return db
  }

  fs.mkdirSync(dataDir, { recursive: true })
  const dbFile = path.join(dataDir, 'mindtrace.db')
  const db = fs.existsSync(dbFile)
    ? new SQL.Database(fs.readFileSync(dbFile))
    : new SQL.Database()
  migrate(db)
  return db
}

/** 将内存中的数据库落盘到 <dataDir>/mindtrace.db */
export function persistDb(db: Database, dataDir: string): void {
  if (dataDir === ':memory:') return
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'mindtrace.db'), Buffer.from(db.export()))
}

/** FTS5 可用性检测；不可用时上层降级为 LIKE 检索 */
export function isFtsAvailable(db: Database): boolean {
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(a); DROP TABLE _fts_probe;")
    return true
  } catch {
    return false
  }
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_text TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('sleep','event','conversation','quote','idea','other')),
      content TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'chat',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      entry_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      entry_time TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(entry_date);
    CREATE INDEX IF NOT EXISTS idx_entries_kind ON entries(kind);

    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS entry_threads (
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      thread_id INTEGER NOT NULL REFERENCES threads(id),
      PRIMARY KEY (entry_id, thread_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('daily','weekly')),
      period TEXT NOT NULL,
      content_md TEXT NOT NULL,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE (type, period)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  if (isFtsAvailable(db)) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        content, content='entries', content_rowid='id', tokenize='trigram'
      );
      CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
        INSERT INTO entries_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE OF content ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO entries_fts(rowid, content) VALUES (new.id, new.content);
      END;
    `)
  }

  // 增量迁移：导入去重键（幂等）
  const cols = db.exec("PRAGMA table_info(entries)")
  const hasEntryTime = cols.length && cols[0].values.some(v => v[1] === 'entry_time')
  if (!hasEntryTime) db.exec('ALTER TABLE entries ADD COLUMN entry_time TEXT')
  const hasDedup = cols.length && cols[0].values.some(v => v[1] === 'dedup_key')
  if (!hasDedup) {
    db.exec('ALTER TABLE entries ADD COLUMN dedup_key TEXT')
    db.exec('CREATE INDEX IF NOT EXISTS idx_entries_dedup ON entries(dedup_key)')
  }

  // 增量迁移：分块向量表（复合主键，Chunking 升级，幂等）
  const vcols = db.exec('PRAGMA table_info(vectors)')
  const hasChunkKey = vcols.length && vcols[0].values.some(v => v[1] === 'chunk_index')
  if (!hasChunkKey) {
    // 旧单向量表（若有）重建为分块结构
    db.exec('DROP TABLE IF EXISTS vectors')
    db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        entry_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        chunk_text TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        embedding TEXT NOT NULL,
        PRIMARY KEY (entry_id, chunk_index)
      );
    `)
  }

  // ---------- 知识库（v3）----------
  db.run(`CREATE TABLE IF NOT EXISTS kb_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    system_key TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS kb_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER NOT NULL REFERENCES kb_folders(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'markdown',
    body TEXT DEFAULT '',
    file_path TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    reflection TEXT DEFAULT '',
    ai_summary TEXT DEFAULT '',
    source_entry_id INTEGER,
    import_key TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  )`)

  const folderCols = db.exec('PRAGMA table_info(kb_folders)')
  if (folderCols.length && !folderCols[0].values.some(v => v[1] === 'system_key')) {
    db.run('ALTER TABLE kb_folders ADD COLUMN system_key TEXT')
  }
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_folders_system_key ON kb_folders(system_key) WHERE system_key IS NOT NULL')

  const itemCols = db.exec('PRAGMA table_info(kb_items)')
  if (itemCols.length && !itemCols[0].values.some(v => v[1] === 'source_entry_id')) {
    db.run('ALTER TABLE kb_items ADD COLUMN source_entry_id INTEGER')
  }
  if (itemCols.length && !itemCols[0].values.some(v => v[1] === 'import_key')) {
    db.run('ALTER TABLE kb_items ADD COLUMN import_key TEXT')
  }
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_items_import_key ON kb_items(import_key) WHERE import_key IS NOT NULL')
  db.run('CREATE INDEX IF NOT EXISTS idx_kb_items_source_entry ON kb_items(source_entry_id)')

  // ---------- 知识库操作流水（供时间线回溯「哪天动了哪些资料」）----------
  db.run(`CREATE TABLE IF NOT EXISTS kb_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    folder_id INTEGER,
    action TEXT NOT NULL CHECK (action IN ('collect','edit','reflect','summarize','extend','import','delete')),
    item_title TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL,
    event_time TEXT,
    dedup_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_kb_events_date ON kb_events(event_date)')
  // 实时流水的 dedup_key 必须留 NULL：资料 id 会被 SQLite 复用，若参与唯一约束会静默吞掉新资料的收录事件
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_events_dedup ON kb_events(dedup_key) WHERE dedup_key IS NOT NULL')

  backfillKnowledgeEvents(db)
  linkImportedKnowledgeItems(db)

  db.run(`CREATE TABLE IF NOT EXISTS capture_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    text TEXT NOT NULL DEFAULT '',
    parsed_json TEXT,
    profile_draft_json TEXT,
    committed INTEGER NOT NULL DEFAULT 0,
    error TEXT DEFAULT '',
    archived_entry_ids_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    session_id TEXT NOT NULL DEFAULT 'default',
    usage_json TEXT
  )`)
  const captureCols = db.exec('PRAGMA table_info(capture_messages)')
  if (captureCols.length && !captureCols[0].values.some(v => v[1] === 'archived_entry_ids_json')) {
    db.run('ALTER TABLE capture_messages ADD COLUMN archived_entry_ids_json TEXT')
  }
  if (captureCols.length && !captureCols[0].values.some(v => v[1] === 'session_id')) db.run("ALTER TABLE capture_messages ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'")
  if (captureCols.length && !captureCols[0].values.some(v => v[1] === 'usage_json')) db.run('ALTER TABLE capture_messages ADD COLUMN usage_json TEXT')

  db.run(`CREATE TABLE IF NOT EXISTS capture_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_message_at TEXT,
    archived_at TEXT
  )`)
  // 回填：为已存在消息但缺会话行的 session_id 补建元数据（兼容旧库，也收拾历史碎片）
  db.run(`INSERT INTO capture_sessions (id, title, status, created_at, last_message_at, archived_at)
    SELECT
      m.session_id,
      COALESCE((SELECT substr(replace(replace(m2.text, char(10), ' '), char(13), ' '), 1, 24)
                  FROM capture_messages m2
                 WHERE m2.session_id = m.session_id AND m2.role = 'user' AND m2.text <> ''
                 ORDER BY m2.id LIMIT 1), ''),
      CASE WHEN m.session_id = 'default' THEN 'active' ELSE 'archived' END,
      MIN(m.created_at),
      MAX(m.created_at),
      CASE WHEN m.session_id = 'default' THEN NULL ELSE MAX(m.created_at) END
    FROM capture_messages m
    WHERE m.session_id NOT IN (SELECT id FROM capture_sessions)
    GROUP BY m.session_id`)

  db.run(`CREATE TABLE IF NOT EXISTS profile_fields (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual','ai')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )`)

  // 增量迁移：时间线隐去标记（只改变可见性，不删改任何内容；三张会上时间线的表都需要）
  for (const table of ['entries', 'kb_events', 'capture_sessions']) {
    const tableCols = db.exec(`PRAGMA table_info(${table})`)
    if (tableCols.length && !tableCols[0].values.some(v => v[1] === 'hidden_scope')) {
      db.run(`ALTER TABLE ${table} ADD COLUMN hidden_scope TEXT`)
    }
  }
}

/** 升级前已有的资料没有流水，按其创建/更新时间补写收录与修改事件 */
function backfillKnowledgeEvents(db: Database): void {
  db.run(`INSERT OR IGNORE INTO kb_events (item_id, folder_id, action, item_title, event_date, event_time, dedup_key, created_at)
    SELECT i.id, i.folder_id, 'collect', i.title, substr(i.created_at, 1, 10), substr(i.created_at, 12, 5),
           'backfill:collect:' || i.id, i.created_at
    FROM kb_items i
    WHERE length(i.created_at) >= 16`)
  db.run(`INSERT OR IGNORE INTO kb_events (item_id, folder_id, action, item_title, event_date, event_time, dedup_key, created_at)
    SELECT i.id, i.folder_id, 'edit', i.title, substr(i.updated_at, 1, 10), substr(i.updated_at, 12, 5),
           'backfill:edit:' || i.id, i.updated_at
    FROM kb_items i
    WHERE length(i.updated_at) >= 16 AND datetime(i.updated_at) > datetime(i.created_at, '+60 seconds')`)
}

/** 导入对话生成的记录只在 content 里留了 kbItemId（契约白名单会丢弃），改用 source_entry_id 作为关联真相 */
function linkImportedKnowledgeItems(db: Database): void {
  db.run(`UPDATE kb_items SET source_entry_id = (
      SELECT e.id FROM entries e WHERE e.dedup_key = 'conversation:' || kb_items.import_key
    )
    WHERE source_entry_id IS NULL AND import_key IS NOT NULL`)
}
