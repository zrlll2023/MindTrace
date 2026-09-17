import { app } from 'electron'
import log from 'electron-log/main'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'

const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000
const SECRET_PATTERN = /(api[_-]?key|token|password)([\s:=]+)([^\s,;]+)/gi

export function sanitizeDiagnosticText(value: unknown, maxLength = 12000): string {
  const raw = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ''}` : String(value)
  return raw
    .replace(/(authorization\s*[:=]\s*bearer\s+)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/(bearer\s+)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(SECRET_PATTERN, '$1$2[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .slice(0, maxLength)
}

export function logsDirectory(): string {
  return app.getPath('logs')
}

export function initializeLogger(): void {
  const dir = logsDirectory()
  fs.mkdirSync(dir, { recursive: true })
  log.initialize({ spyRendererConsole: false })
  log.transports.file.resolvePathFn = () => path.join(dir, 'main.log')
  log.transports.file.maxSize = 2 * 1024 * 1024
  log.transports.console.level = process.env.NODE_ENV === 'test' ? false : 'info'
  pruneOldLogs(dir)
  log.info('app.start', { version: app.getVersion(), platform: process.platform, arch: process.arch })
}

export function logInfo(scope: string, detail?: Record<string, unknown>): void {
  log.info(scope, detail ?? {})
}

export function logError(scope: string, error: unknown): void {
  log.error(scope, sanitizeDiagnosticText(error))
}

export function clearDiagnosticLogs(): void {
  const dir = logsDirectory()
  for (const file of listLogFiles(dir)) fs.rmSync(file, { force: true })
}

export function buildDiagnosticArchive(): Uint8Array {
  const dir = logsDirectory()
  const files: Record<string, Uint8Array> = {}
  for (const file of listLogFiles(dir)) {
    const name = path.basename(file)
    files[`logs/${name}`] = strToU8(sanitizeDiagnosticText(fs.readFileSync(file, 'utf8'), 1024 * 1024))
  }
  files['diagnostic-info.json'] = strToU8(JSON.stringify({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    generatedAt: new Date().toISOString()
  }, null, 2))
  return zipSync(files, { level: 6 })
}

function listLogFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .map(name => path.join(dir, name))
    .filter(file => fs.statSync(file).isFile() && /\.log(?:\.old)?$/i.test(file))
}

function pruneOldLogs(dir: string): void {
  const cutoff = Date.now() - MAX_LOG_AGE_MS
  for (const file of listLogFiles(dir)) {
    if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true })
  }
}
