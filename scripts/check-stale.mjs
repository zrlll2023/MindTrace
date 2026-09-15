/**
 * 判断构建产物 dist/ 是否已经落后于源码。
 *
 * 退出码：
 *   0 = 已是最新，无需重新构建
 *   1 = 源码比 dist 新（或 dist 不存在），需要重新构建
 *
 * 启动器 启动MindTrace.bat 依赖这个退出码决定是否先构建。
 */
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_HTML = join(ROOT, 'dist', 'index.html')

/** 参与比对的源码入口：任一比 dist 新就判定为过期 */
const WATCH = ['src', 'electron', 'index.html', 'vite.config.mts', 'package.json']

/**
 * 只统计「文件」的 mtime。
 * 目录自身的 mtime 会因新增/删除任意文件（含临时文件）而变动，与源码内容无关，
 * 计入会导致误判为过期。
 */
function newestMtime(target) {
  if (!existsSync(target)) return 0
  const st = statSync(target)
  if (st.isFile()) return st.mtimeMs

  let newest = 0
  let entries = []
  try {
    entries = readdirSync(target, { withFileTypes: true })
  } catch {
    return newest
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    newest = Math.max(newest, newestMtime(join(target, e.name)))
  }
  return newest
}

if (!existsSync(DIST_HTML)) {
  process.stdout.write('dist 不存在，需要构建\n')
  process.exit(1)
}

const distMtime = statSync(DIST_HTML).mtimeMs
let srcMtime = 0
let srcPath = ''
for (const w of WATCH) {
  const m = newestMtime(join(ROOT, w))
  if (m > srcMtime) {
    srcMtime = m
    srcPath = w
  }
}

if (srcMtime > distMtime) {
  process.stdout.write(`源码已更新（最新：${srcPath}），需要重新构建\n`)
  process.exit(1)
}

process.stdout.write('已是最新构建\n')
process.exit(0)
