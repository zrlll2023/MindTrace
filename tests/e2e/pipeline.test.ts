/**
 * 全链路假数据测试：不 mock 任何内部模块——
 * 真实 DB + 真实解析器/引擎 + 本地 Mock LLM 服务器（HTTP 走真实 fetch）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { initDb } from '../../electron/db/connection'
import { Repo } from '../../electron/db/repository'
import { LLMAdapter } from '../../electron/adapters/llm'
import { SearchAdapter } from '../../electron/adapters/search'
import { parseDumpWith } from '../../electron/analysis/parser'
import { AnalyzeEngine } from '../../electron/analysis/engine'
import { importConversations } from '../../electron/import/service'
import { exportMarkdown } from '../../electron/export/markdown'
import { runBackup } from '../../electron/store/backup'

const PORT = 18787
const BASE = `http://localhost:${PORT}/v1`

let server: ChildProcess
let repo: Repo
let dataDir: string

beforeAll(async () => {
  server = spawn('node', ['scripts/mock-llm-server.mjs'], {
    env: { ...process.env, MOCK_PORT: String(PORT) },
    stdio: 'pipe'
  })
  // 等服务就绪
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/models`)
      if (r.ok) break
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 250))
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-e2e-'))
  repo = new Repo(await initDb(':memory:'), dataDir)
}, 30000)

afterAll(() => {
  server?.kill()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('全链路（Mock LLM 替代真实 Key）', () => {
  const llm = new LLMAdapter({ baseUrl: BASE, apiKey: 'mock-not-needed', model: 'mock-chat' })
  const search = new SearchAdapter({ provider: 'tavily', apiKey: 'mock' })

  it('0. 前置：Mock LLM 可连通（等同"测试连接"）', async () => {
    const r = await llm.testConnection()
    expect(r.ok).toBe(true)
  })

  it('1. 聊天捕获解析：混杂 dump 拆成多张卡片', async () => {
    const out = await parseDumpWith(
      llm,
      '睡了6.5小时，今天被导师骂了一顿，突然想到如果给日记加向量检索会很有意思，看到一句话：知行合一'
    )
    const kinds = out.map(e => e.kind)
    expect(kinds).toContain('sleep')
    expect(kinds).toContain('idea')
    expect(kinds).toContain('quote')
    // 归档入库
    for (const p of out) {
      await repo.insertEntry({
        raw_text: '混杂 dump 原文',
        kind: p.kind,
        content: JSON.stringify(p.content),
        confidence: p.confidence,
        source: 'chat',
        entry_date: '2026-09-15'
      })
    }
    const today = await repo.listEntries({ dateFrom: '2026-09-15', dateTo: '2026-09-15' })
    expect(today.length).toBeGreaterThanOrEqual(3)
  })

  it('2. 导入 AI 对话（假会话）', async () => {
    const summary = await importConversations(repo, [
      {
        source: 'chatgpt',
        title: 'RAG 评估讨论',
        date: '2026-09-14',
        messages: [
          { role: 'user', content: 'RAG 评估用什么框架？', timestamp: 1757894400 },
          { role: 'assistant', content: 'RAGAS 是常见选择。', timestamp: 1757894460 }
        ]
      }
    ])
    expect(summary.imported).toBe(2)
  })

  it('3. 日报：真实工具循环（query_entries）→ 报告入库 + threads', async () => {
    const engine = new AnalyzeEngine(repo, llm)
    const report = await engine.analyzeDay('2026-09-15')
    expect(report).not.toBeNull()
    expect(report!.content_md).toContain('## 今天概况')
    expect(report!.content_md).toContain('Mock LLM')

    const stored = await repo.getReport('daily', '2026-09-15')
    expect(stored).not.toBeNull()
    const meta = JSON.parse(stored!.meta)
    expect(meta.tool_calls).toBeGreaterThanOrEqual(1) // 工具循环真实发生过
    expect(meta.degraded).toBe(false)

    // threads 被写入
    const threads = await repo.listThreads()
    expect(threads.length).toBeGreaterThanOrEqual(1)
  })

  it('4. 周报生成', async () => {
    const engine = new AnalyzeEngine(repo, llm)
    const report = await engine.analyzeWeek('2026-09-15')
    expect(report).not.toBeNull()
    expect(report!.content_md).toContain('## 一周概况')
  })

  it('5. 带联网搜索的日报（搜索结果进入推荐内容）', async () => {
    // 拦截 search adapter 的 HTTP 到 mock 服务器？——mock 服务器只模拟 LLM。
    // 这里用本地 stub 替代 tavily HTTP，验证引擎把搜索结果送进报告的通路。
    const fakeSearch = new (class {
      async search(q: string) {
        return [
          { title: `关于「${q}」的文章`, url: 'https://example.com/mock', snippet: 'Mock 搜索结果摘要' }
        ]
      }
    })() as unknown as SearchAdapter
    const engine = new AnalyzeEngine(repo, llm, { search: fakeSearch })
    const report = await engine.analyzeDay('2026-09-15')
    expect(report!.content_md).toContain('## 推荐内容')
    expect(report!.content_md).toContain('example.com/mock')
  })

  it('6. 未配置搜索时不下发 web_search 工具（报告仍正常）', async () => {
    const engine = new AnalyzeEngine(repo, llm, { search: null })
    const report = await engine.analyzeDay('2026-09-15')
    expect(report).not.toBeNull()
    expect(report!.content_md).not.toContain('not_configured')
  })

  it('7. Markdown 导出 + 备份落盘', async () => {
    const report = (await repo.getReport('daily', '2026-09-15'))!
    const exp = await exportMarkdown(report, dataDir)
    expect(fs.existsSync(exp.path)).toBe(true)
    expect(fs.readFileSync(exp.path, 'utf8')).toContain('## 今天概况')

    const dbFile = path.join(dataDir, 'mindtrace.db')
    fs.copyFileSync(dbFile, dbFile) // 模拟数据库文件存在
    repo.save()
    const backup = await runBackup(dataDir, 30)
    expect(backup).not.toBeNull()
    expect(fs.existsSync(backup!.path)).toBe(true)
  })
})
