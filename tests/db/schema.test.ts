import { describe, it, expect } from 'vitest'
import { initDb } from '../../electron/db/connection'

describe('schema 迁移', () => {
  it('创建 entries/threads/entry_threads/reports/settings 表', async () => {
    const db = await initDb(':memory:')
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]
      .values.flat()
    expect(tables).toContain('entries')
    expect(tables).toContain('threads')
    expect(tables).toContain('entry_threads')
    expect(tables).toContain('reports')
    expect(tables).toContain('settings')
  })
})
