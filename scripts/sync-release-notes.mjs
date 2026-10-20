#!/usr/bin/env node
/**
 * 用 docs/releases/<tag>.md 覆盖已发布 GitHub Release 的正文。
 *
 * 用法：
 *   GH_TOKEN=<有 repo 权限的 PAT> node scripts/sync-release-notes.mjs v1.0.0
 *
 * 说明：
 *   - CI 在推 tag 时已用 body_path 写入正文，本脚本只用于修正历史 Release，
 *     或在工作流之外手动补正文。
 *   - 仓库由 package.json 的 build.publish 配置推导，不额外维护常量。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const tag = process.argv[2]
if (!tag) {
  console.error('用法: GH_TOKEN=<token> node scripts/sync-release-notes.mjs <tag>')
  process.exit(1)
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
if (!token) {
  console.error('缺少 GH_TOKEN 或 GITHUB_TOKEN 环境变量')
  process.exit(1)
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const publish = pkg.build?.publish?.[0]
if (!publish?.owner || !publish?.repo) {
  console.error('package.json 的 build.publish 缺少 owner/repo')
  process.exit(1)
}

const notesPath = join(root, 'docs', 'releases', `${tag}.md`)
let body
try {
  body = await readFile(notesPath, 'utf8')
} catch {
  console.error(`找不到发布说明：docs/releases/${tag}.md`)
  process.exit(1)
}

const api = `https://api.github.com/repos/${publish.owner}/${publish.repo}/releases`
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
  'User-Agent': 'mindtrace-release-sync'
}

const found = await fetch(`${api}/tags/${tag}`, { headers })
if (!found.ok) {
  console.error(`查询 Release 失败：${found.status} ${await found.text()}`)
  process.exit(1)
}
const release = await found.json()

const patched = await fetch(`${api}/${release.id}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ body })
})
if (!patched.ok) {
  console.error(`更新正文失败：${patched.status} ${await patched.text()}`)
  process.exit(1)
}

const result = await patched.json()
console.log(`已更新 ${result.tag_name} 正文，${body.length} 字符`)
console.log(result.html_url)
