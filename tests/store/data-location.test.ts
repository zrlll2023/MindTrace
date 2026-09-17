import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  dataLocationStatus,
  defaultDataDir,
  inspectMigration,
  migrateData,
  refreshScheduledMigration,
  resolveDataDir,
  restoreDefaultDataDir,
  undoScheduledMigration
} from '../../electron/store/data-location'

const roots: string[] = []
function temp(name: string): string { const p = fs.mkdtempSync(path.join(os.tmpdir(), `mindtrace-${name}-`)); roots.push(p); return p }
afterEach(() => { for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true }) })

describe('数据目录迁移', () => {
  it('复制并校验文件，原子记录新旧目录且保留源目录', () => {
    const userData = temp('user'), source = temp('source'), target = temp('target')
    fs.writeFileSync(path.join(source, 'mindtrace.db'), 'database')
    fs.mkdirSync(path.join(source, 'backups')); fs.writeFileSync(path.join(source, 'backups', 'one.db'), 'backup')
    expect(inspectMigration(source, target).ok).toBe(true)
    migrateData(source, target, userData)
    expect(fs.readFileSync(path.join(target, 'mindtrace.db'), 'utf8')).toBe('database')
    expect(fs.existsSync(path.join(source, 'mindtrace.db'))).toBe(true)
    expect(resolveDataDir(userData)).toBe(path.resolve(target))
    expect(dataLocationStatus(userData).previousDir).toBe(path.resolve(source))
  })

  it('拒绝非空目录和源目录内部目标', () => {
    const source = temp('source'), target = temp('target')
    fs.writeFileSync(path.join(target, 'existing.txt'), 'x')
    expect(inspectMigration(source, target).ok).toBe(false)
    expect(inspectMigration(source, path.join(source, 'nested')).ok).toBe(false)
  })

  it('允许在重启前撤销已经准备好的目录切换', () => {
    const userData = temp('user'), source = defaultDataDir(userData), target = temp('target')
    fs.mkdirSync(source, { recursive: true })
    fs.writeFileSync(path.join(source, 'mindtrace.db'), 'database')
    migrateData(source, target, userData)

    expect(resolveDataDir(userData)).toBe(path.resolve(target))
    expect(undoScheduledMigration(source, userData)).toBe(path.resolve(target))
    expect(resolveDataDir(userData)).toBe(path.resolve(source))
    expect(fs.existsSync(path.join(target, 'mindtrace.db'))).toBe(true)
  })

  it('重启前重新同步并校验迁移后产生的新数据', () => {
    const userData = temp('user'), source = temp('source'), target = temp('target')
    fs.writeFileSync(path.join(source, 'mindtrace.db'), 'before')
    migrateData(source, target, userData)
    fs.writeFileSync(path.join(source, 'mindtrace.db'), 'after')
    fs.writeFileSync(path.join(source, 'new-entry.txt'), 'latest')

    expect(refreshScheduledMigration(source, userData)).toBe(path.resolve(target))
    expect(fs.readFileSync(path.join(target, 'mindtrace.db'), 'utf8')).toBe('after')
    expect(fs.readFileSync(path.join(target, 'new-entry.txt'), 'utf8')).toBe('latest')
  })

  it('恢复默认目录时归档旧快照并复制当前完整数据', () => {
    const userData = temp('user'), source = temp('custom'), target = defaultDataDir(userData)
    fs.writeFileSync(path.join(source, 'mindtrace.db'), 'current')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'mindtrace.db'), 'stale')

    const result = restoreDefaultDataDir(source, userData)

    expect(result.target).toBe(path.resolve(target))
    expect(result.archivedDir).toBeTruthy()
    expect(fs.readFileSync(path.join(target, 'mindtrace.db'), 'utf8')).toBe('current')
    expect(fs.readFileSync(path.join(result.archivedDir!, 'mindtrace.db'), 'utf8')).toBe('stale')
    expect(resolveDataDir(userData)).toBe(path.resolve(target))
    expect(fs.existsSync(path.join(source, 'mindtrace.db'))).toBe(true)
  })
})
