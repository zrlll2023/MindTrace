import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Database } from 'sql.js'
import { initDb, persistDb } from '../../electron/db/connection'

describe('schema 迁移', () => {
  it('创建核心表、知识流表、持久会话与资料表', async () => {
    const db = await initDb(':memory:')
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]
      .values.flat()
    expect(tables).toContain('entries')
    expect(tables).toContain('threads')
    expect(tables).toContain('entry_threads')
    expect(tables).toContain('reports')
    expect(tables).toContain('settings')
    expect(tables).toContain('kb_folders')
    expect(tables).toContain('kb_items')
    expect(tables).toContain('kb_events')
    expect(tables).toContain('capture_messages')
    expect(tables).toContain('profile_fields')
    const folderCols = db.exec('PRAGMA table_info(kb_folders)')[0].values.map(v => v[1])
    const itemCols = db.exec('PRAGMA table_info(kb_items)')[0].values.map(v => v[1])
    const entryCols = db.exec('PRAGMA table_info(entries)')[0].values.map(v => v[1])
    const eventCols = db.exec('PRAGMA table_info(kb_events)')[0].values.map(v => v[1])
    const captureCols = db.exec('PRAGMA table_info(capture_messages)')[0].values.map(v => v[1])
    const sessionCols = db.exec('PRAGMA table_info(capture_sessions)')[0].values.map(v => v[1])
    expect(folderCols).toContain('system_key')
    expect(folderCols).toContain('sort_order')
    expect(folderCols).toContain('tags')
    expect(itemCols).toContain('source_entry_id')
    expect(itemCols).toContain('import_key')
    expect(itemCols).toContain('title_locked')
    expect(itemCols).toContain('tags')
    expect(entryCols).toContain('entry_time')
    expect(captureCols).toContain('archived_entry_ids_json')
    // 三类会上时间线的行都要记住隐去范围，恢复后状态才不会丢
    expect(entryCols).toContain('hidden_scope')
    expect(eventCols).toContain('hidden_scope')
    expect(sessionCols).toContain('hidden_scope')
  })

  describe('升级到知识库操作流水', () => {
    let dir = ''
    function lastId(db: Database): number {
      return Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0])
    }

    function eventRows(db: Database): string[] {
      const r = db.exec('SELECT action, event_date, event_time FROM kb_events ORDER BY event_date, event_time')
      return r.length ? r[0].values.map(v => `${v[0]}:${v[1]} ${v[2]}`) : []
    }

    // 升级前的旧库：资料没有流水，导入对话的资料只靠 content 里的 kbItemId
    beforeEach(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindtrace-migrate-'))
      const db = await initDb(':memory:')
      db.run("INSERT INTO kb_folders (name) VALUES ('旧目录')")
      const folderId = lastId(db)
      // 三条资料都显式给出创建与更新时间：默认 updated_at 会把没编辑过的资料误判成改过
      db.run(
        `INSERT INTO kb_items (folder_id, title, source_type, body, created_at, updated_at)
         VALUES (?, '改过的旧资料', 'text', '内容', '2026-09-10 08:00:00', '2026-09-12 19:30:00')`,
        [folderId]
      )
      db.run(
        `INSERT INTO kb_items (folder_id, title, source_type, body, created_at, updated_at)
         VALUES (?, '只收录过', 'text', '内容', '2026-09-11 09:00:00', '2026-09-11 09:00:20')`,
        [folderId]
      )
      db.run(
        `INSERT INTO kb_items (folder_id, title, source_type, body, import_key, created_at, updated_at)
         VALUES (?, '导入的会话', 'ai-conversation', '全文', 'legacy-key-1', '2026-09-13 10:00:00', '2026-09-13 10:00:00')`,
        [folderId]
      )
      db.run(
        `INSERT INTO entries (raw_text, kind, content, confidence, source, entry_date, dedup_key)
         VALUES ('导入会话摘要', 'conversation', '{"text":"摘要"}', 1, 'import:chatgpt', '2026-09-13', 'conversation:legacy-key-1')`
      )
      persistDb(db, dir)
    })

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it('为历史资料回填收录与修改流水，并为旧导入资料补上记录关联', async () => {
      const db = await initDb(dir)
      expect(eventRows(db)).toEqual([
        'collect:2026-09-10 08:00',
        'collect:2026-09-11 09:00',
        'edit:2026-09-12 19:30',
        'collect:2026-09-13 10:00'
      ])
      const linked = db.exec('SELECT source_entry_id FROM kb_items WHERE import_key = ?', ['legacy-key-1'])
      expect(Number(linked[0].values[0][0])).toBe(1)
    })

    it('更新时间只晚几十秒不算一次修改，重复启动也不重复回填', async () => {
      const db = await initDb(dir)
      expect(Number(db.exec("SELECT COUNT(*) FROM kb_events WHERE action = 'edit'")[0].values[0][0])).toBe(1)
      persistDb(db, dir)
      expect(eventRows(await initDb(dir))).toHaveLength(4)
    })
  })

  describe('升级到文件夹手动顺序', () => {
    let dir = ''
    afterEach(() => {
      if (dir) fs.rmSync(dir, { recursive: true, force: true })
      dir = ''
    })

    it('老库的 sort_order 按 id 回填，显示顺序不变', async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindtrace-order-'))
      const before = await initDb(':memory:')
      before.run("INSERT INTO kb_folders (name) VALUES ('先建的')")
      before.run("INSERT INTO kb_folders (name) VALUES ('后建的')")
      before.run("INSERT INTO kb_items (folder_id, title, source_type, body) VALUES (1, '旧资料', 'entry', '内容')")
      before.run('UPDATE kb_folders SET sort_order = NULL')
      before.run('UPDATE kb_items SET title_locked = NULL')
      persistDb(before, dir)

      const db = await initDb(dir)
      const rows = db.exec('SELECT name, sort_order FROM kb_folders ORDER BY sort_order IS NULL, sort_order, id')[0].values
      expect(rows.map(r => r[0])).toEqual(['先建的', '后建的'])
      expect(rows.map(r => r[1])).toEqual([1, 2])
      // 老资料没有确认过标题，回填 0 之后正文改动仍按原规则同步标题
      expect(db.exec('SELECT title_locked FROM kb_items')[0].values).toEqual([[0]])
    })
  })
})
