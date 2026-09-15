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
      entry_date TEXT NOT NULL DEFAULT (date('now', 'localtime'))
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
}
