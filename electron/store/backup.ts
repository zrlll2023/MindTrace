import fs from 'node:fs'
import path from 'node:path'

/**
 * 每日备份：<dataDir>/mindtrace.db → <dataDir>/backups/mindtrace-YYYY-MM-DD.db
 * 同日重复备份覆盖；超过 keep 份数时删除最旧的。
 */
export async function runBackup(dataDir: string, keep = 30): Promise<{ path: string } | null> {
  const dbFile = path.join(dataDir, 'mindtrace.db')
  if (!fs.existsSync(dbFile)) return null

  const backupsDir = path.join(dataDir, 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })

  const today = new Date().toISOString().slice(0, 10)
  const target = path.join(backupsDir, `mindtrace-${today}.db`)
  fs.copyFileSync(dbFile, target)

  // 轮转：按文件名排序（日期即序），超出 keep 的最旧文件删除
  const files = fs
    .readdirSync(backupsDir)
    .filter(f => /^mindtrace-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
  while (files.length > keep) {
    const oldest = files.shift()
    if (oldest) fs.rmSync(path.join(backupsDir, oldest), { force: true })
  }
  return { path: target }
}
