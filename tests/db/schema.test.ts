import { describe, it, expect } from 'vitest'
import { initDb } from '../../electron/db/connection'

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
    expect(tables).toContain('capture_messages')
    expect(tables).toContain('profile_fields')
    const folderCols = db.exec('PRAGMA table_info(kb_folders)')[0].values.map(v => v[1])
    const itemCols = db.exec('PRAGMA table_info(kb_items)')[0].values.map(v => v[1])
    const entryCols = db.exec('PRAGMA table_info(entries)')[0].values.map(v => v[1])
    expect(folderCols).toContain('system_key')
    expect(itemCols).toContain('source_entry_id')
    expect(itemCols).toContain('import_key')
    expect(entryCols).toContain('entry_time')
  })
})
