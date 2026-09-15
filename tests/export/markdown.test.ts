import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { exportMarkdown } from '../../electron/export/markdown'
import { runBackup } from '../../electron/store/backup'

describe('Markdown 导出', () => {
  let dir: string
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-export-'))))
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('导出文件名含日期与类型，内容含报告正文', async () => {
    const r = await exportMarkdown(
      { type: 'daily', period: '2026-09-14', content_md: '# 日报\n\n今天睡了6.5小时', meta: '{}' },
      dir
    )
    expect(r.path).toContain('2026-09-14')
    expect(r.path).toContain('日报')
    expect(r.path.endsWith('.md')).toBe(true)
    const content = fs.readFileSync(r.path, 'utf8')
    expect(content).toContain('# 日报')
    expect(content).toContain('今天睡了6.5小时')
  })

  it('同名文件覆盖', async () => {
    const report = { type: 'daily' as const, period: '2026-09-14', content_md: 'v2', meta: '{}' }
    await exportMarkdown(report, dir)
    const r2 = await exportMarkdown(report, dir)
    expect(r2.path).toBeTruthy()
    expect(fs.readFileSync(r2.path, 'utf8')).toContain('v2')
  })
})

describe('备份轮转', () => {
  let dir: string
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-backup-'))))
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('备份文件生成于 backups 目录', async () => {
    fs.writeFileSync(path.join(dir, 'mindtrace.db'), 'fake-db')
    await runBackup(dir, 30)
    const files = fs.readdirSync(path.join(dir, 'backups'))
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^mindtrace-\d{4}-\d{2}-\d{2}\.db$/)
  })

  it('超过保留数量时最旧的被删除', async () => {
    fs.writeFileSync(path.join(dir, 'mindtrace.db'), 'fake-db')
    const backupsDir = path.join(dir, 'backups')
    fs.mkdirSync(backupsDir)
    // 造 32 份历史备份（早于今天的 30 天）
    for (let i = 1; i <= 32; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      fs.writeFileSync(path.join(backupsDir, `mindtrace-${d.toISOString().slice(0, 10)}.db`), 'old')
    }
    await runBackup(dir, 30)
    const files = fs.readdirSync(backupsDir)
    expect(files.length).toBe(30)
    // 最旧的（32 天前）被删
    const oldest = new Date()
    oldest.setDate(oldest.getDate() - 32)
    expect(files).not.toContain(`mindtrace-${oldest.toISOString().slice(0, 10)}.db`)
  })
})
