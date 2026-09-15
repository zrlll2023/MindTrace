import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SearchAdapter } from '../../electron/adapters/search'

describe('SearchAdapter (Tavily)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('发送 Tavily 格式请求并解析结果', async () => {
    let captured: { url: string; body: any; headers: any } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(init.body as string), headers: init.headers }
      return new Response(
        JSON.stringify({
          results: [
            { title: 'RAG 评估新框架', url: 'https://example.com/a', content: '一种新的 RAG 评估方法……' },
            { title: 'RAGAS 2.0', url: 'https://example.com/b', content: 'RAGAS 更新……' }
          ]
        }),
        { status: 200 }
      )
    })
    const s = new SearchAdapter({ provider: 'tavily', apiKey: 'tvly-x' })
    const out = await s.search('RAG 评估', { maxResults: 5 })
    expect(captured!.url).toBe('https://api.tavily.com/search')
    expect(captured!.body.query).toBe('RAG 评估')
    expect(captured!.body.max_results).toBe(5)
    expect(captured!.headers.Authorization).toBe('Bearer tvly-x')
    expect(out).toHaveLength(2)
    expect(out[0].title).toBe('RAG 评估新框架')
    expect(out[0].url).toBe('https://example.com/a')
  })

  it('HTTP 错误时抛出带状态码错误', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad key', { status: 401 }))
    const s = new SearchAdapter({ provider: 'tavily', apiKey: 'k' })
    await expect(s.search('q')).rejects.toThrow(/401/)
  })
})

describe('SearchAdapter (Bocha)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('发送 Bocha 格式请求并归一化结果', async () => {
    let captured: { url: string; body: any; headers: any } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(init.body as string), headers: init.headers }
      return new Response(
        JSON.stringify({
          webPages: {
            value: [
              { name: '博查结果', url: 'https://bocha.example/x', snippet: '摘要内容' }
            ]
          }
        }),
        { status: 200 }
      )
    })
    const s = new SearchAdapter({ provider: 'bocha', apiKey: 'bk-x' })
    const out = await s.search('测试查询')
    expect(captured!.url).toBe('https://api.bochaai.com/v1/web-search')
    expect(captured!.headers['Authorization']).toBe('Bearer bk-x')
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('博查结果')
    expect(out[0].snippet).toBe('摘要内容')
  })
})
