import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

interface LocationConfig { dataDir: string; previousDir?: string }
export interface LocationStatus { configuredDir: string | null; previousDir: string | null }

export function locationFile(userDataDir: string): string { return path.join(userDataDir, 'data-location.json') }

export function resolveDataDir(userDataDir: string): string {
  const fallback = path.join(userDataDir, 'data')
  try {
    const cfg = JSON.parse(fs.readFileSync(locationFile(userDataDir), 'utf8')) as LocationConfig
    if (cfg.dataDir && fs.existsSync(cfg.dataDir)) return path.resolve(cfg.dataDir)
    if (cfg.previousDir && fs.existsSync(cfg.previousDir)) return path.resolve(cfg.previousDir)
  } catch { /* use default */ }
  return fallback
}

export function dataLocationStatus(userDataDir: string): LocationStatus {
  try {
    const cfg = JSON.parse(fs.readFileSync(locationFile(userDataDir), 'utf8')) as LocationConfig
    return { configuredDir: cfg.dataDir ? path.resolve(cfg.dataDir) : null, previousDir: cfg.previousDir ? path.resolve(cfg.previousDir) : null }
  } catch { return { configuredDir: null, previousDir: null } }
}

function filesUnder(root: string): string[] {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => {
    const full = path.join(root, e.name)
    return e.isDirectory() ? filesUnder(full) : [full]
  })
}

function digest(file: string): string { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }

export function inspectMigration(source: string, target: string): { ok: boolean; error?: string; bytes: number; freeBytes: number } {
  const src = path.resolve(source)
  const dst = path.resolve(target)
  const bytes = filesUnder(src).reduce((n, f) => n + fs.statSync(f).size, 0)
  if (src.toLowerCase() === dst.toLowerCase()) return { ok: false, error: '目标目录与当前目录相同', bytes, freeBytes: 0 }
  if (dst.toLowerCase().startsWith(src.toLowerCase() + path.sep)) return { ok: false, error: '目标目录不能位于当前数据目录内部', bytes, freeBytes: 0 }
  fs.mkdirSync(dst, { recursive: true })
  if (fs.readdirSync(dst).length) return { ok: false, error: '请选择一个空目录', bytes, freeBytes: 0 }
  const probe = path.join(dst, '.mindtrace-write-test')
  try { fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe) } catch { return { ok: false, error: '目标目录不可写', bytes, freeBytes: 0 } }
  const stat = fs.statfsSync(dst)
  const freeBytes = Number(stat.bavail) * Number(stat.bsize)
  if (freeBytes < bytes * 1.2) return { ok: false, error: '目标磁盘剩余空间不足', bytes, freeBytes }
  return { ok: true, bytes, freeBytes }
}

export function migrateData(source: string, target: string, userDataDir: string): void {
  const check = inspectMigration(source, target)
  if (!check.ok) throw new Error(check.error)
  const marker = path.join(target, '.migration-incomplete')
  fs.writeFileSync(marker, new Date().toISOString())
  try {
    fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: true })
    for (const srcFile of filesUnder(source)) {
      const rel = path.relative(source, srcFile)
      const dstFile = path.join(target, rel)
      if (!fs.existsSync(dstFile) || fs.statSync(srcFile).size !== fs.statSync(dstFile).size || digest(srcFile) !== digest(dstFile)) {
        throw new Error(`文件校验失败：${rel}`)
      }
    }
    fs.unlinkSync(marker)
    const configPath = locationFile(userDataDir)
    const tempPath = `${configPath}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify({ dataDir: path.resolve(target), previousDir: path.resolve(source) }, null, 2))
    fs.renameSync(tempPath, configPath)
  } catch (error) {
    try { fs.rmSync(marker, { force: true }) } catch { /* keep original error */ }
    throw error
  }
}

export function previousDataDir(userDataDir: string): string | null {
  try { return (JSON.parse(fs.readFileSync(locationFile(userDataDir), 'utf8')) as LocationConfig).previousDir ?? null } catch { return null }
}
