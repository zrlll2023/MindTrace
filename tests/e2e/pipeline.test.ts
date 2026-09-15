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
    expect(summary.knowledgeItems).toBe(1)
    expect(summary.timelineSummaries).toBe(1)
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

  it('8. 契约闸门：非法 AI 条目兜底为 other、报告载荷损坏标记 degraded', async () => {
    const { validateParsedEntry, validateReportPayload } = await import(
      '../../electron/analysis/validators'
    )
    // 非法 kind
    expect(validateParsedEntry({ kind: 'alien', content: {}, confidence: 1 }).ok).toBe(false)
    // 越界 sleep
    expect(
      validateParsedEntry({ kind: 'sleep', content: { hours: 99 }, confidence: 1 }).ok
    ).toBe(false)
    // 注入标签被剥离
    const v = validateParsedEntry({ kind: 'idea', content: { text: '<script>x</script>正常想法' }, confidence: 1 })
    expect(v.ok).toBe(true)
    expect((v.entry!.content as { text: string }).text).not.toContain('<script>')
    // 报告载荷缺 report_md
    expect(validateReportPayload({ threads: [] }).ok).toBe(false)
  })

  it('9. 语义搜索：假 embedding 下主题相关条目得分更高且可检索', async () => {
    const { VectorStore } = await import('../../electron/db/vectors')
    const vs = new VectorStore(repo.getDb())
    // 手工向量：RAG 主题 [1,0]，睡眠主题 [0,1]
    const entries = await repo.listEntries({})
    for (const e of entries) {
      const c = JSON.parse(e.content) as { text?: string; hours?: number }
      const isRag = (c.text ?? '').includes('RAG') || (c.text ?? '').includes('向量')
      await vs.upsert(e.id, isRag ? [1, 0.1, 0] : [0.1, 0, 1], 'h')
    }
    const { SemanticSearch } = await import('../../electron/analysis/semantic')
    // 假 embedding 适配器：查询向量固定 [1, 0.2, 0]（贴近 RAG 主题）
    const fakeEmb = new (class {
      async embedOne() {
        return [1, 0.2, 0]
      }
    })() as unknown as import('../../electron/adapters/embedding').EmbeddingAdapter
    const sem = new SemanticSearch(repo, vs, fakeEmb)
    const hits = await sem.search('RAG 评估相关', 5, 0.5)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    // 首条命中必须是 RAG 主题而非睡眠
    const top = JSON.parse(hits[0].entry.content) as { text?: string }
    expect(top.text ?? '').toMatch(/RAG|向量/)
  })

  it('10. 引导式周度研究：AI 返回搜索词计划（走 Mock LLM）', async () => {
    const { planResearch } = await import('../../electron/analysis/labs')
    const plan = await planResearch(llm, ['想法孵化线'], ['向量检索日记'])
    expect(plan.queries.length).toBeGreaterThanOrEqual(3)
    expect(plan.queries.length).toBeLessThanOrEqual(5)
    expect(plan.note).toBeTruthy()
  })

  it('11. 相关性仪表盘聚合：假数据可算出逐日指标', async () => {
    const { dailyMetrics } = await import('../../electron/analysis/labs')
    const m = await dailyMetrics(repo, '2026-09-14', '2026-09-15')
    expect(m).toHaveLength(2)
    const d14 = m.find(x => x.date === '2026-09-14')!
    expect(d14.entry_count).toBeGreaterThanOrEqual(1) // 每个导入会话仅保留一条时间线摘要
    expect(d14.idea_count).toBeGreaterThanOrEqual(0)
  })

  it('12. Chunking：长对话拆成多块分别向量化，查询命中具体片段', async () => {
    const { chunkText } = await import('../../electron/analysis/chunker')
    const { VectorStore } = await import('../../electron/db/vectors')
    const { SemanticSearch } = await import('../../electron/analysis/semantic')

    // 长条目：两个主题相距很远的句子
    const longEntry = await repo.insertEntry({
      raw_text: 'r',
      kind: 'conversation',
      content: JSON.stringify({
        text: '今天深入讨论了RAG评估的各种指标和方法，包括faithfulness和relevance。'.repeat(15) + '然后我们聊了完全无关的话题比如今晚吃什么。'.repeat(15)
      }),
      confidence: 1,
      source: 'import:chatgpt',
      entry_date: '2026-09-15'
    })

    // 分块器本身
    const text = JSON.parse((await repo.getEntry(longEntry.id))!.content).text as string
    const parts = chunkText(text, 200, 40)
    expect(parts.length).toBeGreaterThanOrEqual(3)

    // 嵌入：块向量按内容映射（含 RAG → RAG 方向）
    const vs = new VectorStore(repo.getDb())
    const fakeEmb = new (class {
      async embed(texts: string[]) {
        return texts.map(t => (t.includes('RAG') || t.includes('评估') ? [1, 0, 0] : [0, 0, 1]))
      }
      async embedOne(t: string) {
        return (await this.embed([t]))[0]
      }
    })() as unknown as import('../../electron/adapters/embedding').EmbeddingAdapter

    const n = await vs.embedEntryChunks(repo, fakeEmb)
    expect(n).toBeGreaterThanOrEqual(3) // 长条目多块

    // 语义搜索 RAG：命中长条目且 chunk_text 是 RAG 片段而非吃的片段
    const sem = new SemanticSearch(repo, vs, fakeEmb)
    const hits = await sem.search('RAG 评估方法', 5, 0.5)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    const hit = hits.find(h => h.entry.id === longEntry.id)
    expect(hit).toBeTruthy()
    expect(hit!.chunk_text).toContain('RAG')
    expect(hit!.chunk_text).not.toContain('今晚吃什么')
  })
})
