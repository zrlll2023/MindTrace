import { describe, it, expect } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { Repo } from '../../electron/db/repository'
import { LLMAdapter } from '../../electron/adapters/llm'
import { AnalyzeEngine } from '../../electron/analysis/engine'

const cfg = { baseUrl: 'https://x', apiKey: 'k', model: 'm' }

const REPORT_MD = '# 日报 2026-09-14\n\n## 今天概况\n- 睡眠 6.5 小时\n\n## 规律与洞察\n睡觉少的那天情绪更差。'

const THREADS_PAYLOAD = JSON.stringify({
  report_md: REPORT_MD,
  threads: [
    {
      title: 'RAG 学习线',
      description: '持续关注 RAG 评估方法',
      status: 'active',
      linked_entry_ids: [1]
    }
  ]
})

function seedRepo(entries: { raw: string; kind: string; content: object; date: string }[]): Promise<Repo> {
  return (async () => {
    const repo = new Repo(await initDb(':memory:'))
    for (const e of entries) {
      await repo.insertEntry({
        raw_text: e.raw,
        kind: e.kind as never,
        content: JSON.stringify(e.content),
        confidence: 0.9,
        source: 'chat',
        entry_date: e.date
      })
    }
    return repo
  })()
}

function mockLlm(script: Array<(calls: number) => object>): { adapter: LLMAdapter; calls: () => number } {
  let n = 0
  const adapter = new LLMAdapter(cfg)
  // 引擎走 chatFull；mock 按脚本逐步返回 content / tool_calls
  adapter.chatFull = async () => {
    const step = script[Math.min(n, script.length - 1)]
    n++
    const out = step(n) as { tool_calls?: unknown } & Record<string, unknown>
    if ('tool_calls' in out) return { content: null, tool_calls: out.tool_calls as never }
    return { content: JSON.stringify(out), tool_calls: undefined }
  }
  return { adapter, calls: () => n }
}

describe('AnalyzeEngine', () => {
  it('主流程：工具循环 → 报告入库 → meta 记录引用与调用次数', async () => {
    const repo = await seedRepo([
      { raw: '睡了6.5小时', kind: 'sleep', content: { hours: 6.5 }, date: '2026-09-14' },
      { raw: '看到一句话：知行合一', kind: 'quote', content: { text: '知行合一' }, date: '2026-09-14' }
    ])
    const { adapter } = mockLlm([
      () => ({ tool_calls: [{ id: 't1', type: 'function', function: { name: 'query_entries', arguments: '{"keyword":"知行"}' } }] }),
      () => JSON.parse(THREADS_PAYLOAD)
    ])
    const engine = new AnalyzeEngine(repo, adapter)
    const report = await engine.analyzeDay('2026-09-14')
    expect(report).not.toBeNull()

    expect(report!.content_md).toContain('日报 2026-09-14')
    const stored = await repo.getReport('daily', '2026-09-14')
    expect(stored).not.toBeNull()
    const meta = JSON.parse(stored!.meta)
    expect(meta.tool_calls).toBe(1)
    expect(Array.isArray(meta.quoted_entry_ids)).toBe(true)
    expect(meta.degraded).toBe(false)
  })

  it('threads 载荷写入 threads/entry_threads，且同 title 幂等', async () => {
    const repo = await seedRepo([
      { raw: '想到RAG评估', kind: 'idea', content: { text: 'RAG评估' }, date: '2026-09-14' }
    ])
    const { adapter } = mockLlm([() => JSON.parse(THREADS_PAYLOAD)])
    const engine = new AnalyzeEngine(repo, adapter)
    await engine.analyzeDay('2026-09-14')
    await engine.analyzeDay('2026-09-14')

    const threads = await repo.listThreads()
    expect(threads).toHaveLength(1)
    expect(threads[0].title).toBe('RAG 学习线')
  })

  it('无当日条目时返回 null 不生成报告', async () => {
    const repo = await seedRepo([
      { raw: 'x', kind: 'idea', content: { text: 'x' }, date: '2026-09-13' }
    ])
    const { adapter } = mockLlm([() => JSON.parse(THREADS_PAYLOAD)])
    const engine = new AnalyzeEngine(repo, adapter)
    const r = await engine.analyzeDay('2026-09-14')
    expect(r).toBeNull()
  })

  it('工具调用超过上限时强制收尾', async () => {
    const repo = await seedRepo([
      { raw: '睡了7小时', kind: 'sleep', content: { hours: 7 }, date: '2026-09-14' }
    ])
    // 无限请求工具调用的 LLM
    let n = 0
    const adapter = new LLMAdapter(cfg)
    adapter.chatFull = async () => {
      n++
      return {
        content: null,
        tool_calls: [
          { id: `t${n}`, type: 'function', function: { name: 'query_entries', arguments: '{"keyword":"x"}' } }
        ]
      }
    }
    const engine = new AnalyzeEngine(repo, adapter)
    const report = await engine.analyzeDay('2026-09-14')
    expect(n).toBeLessThanOrEqual(7) // ≤6 次工具调用 + 1 次收尾
    expect(report).not.toBeNull()
    const meta = JSON.parse((report as { meta: string }).meta)
    expect(meta.tool_calls).toBeLessThanOrEqual(6)
  })
})
