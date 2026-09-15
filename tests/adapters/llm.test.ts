import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LLMAdapter } from '../../electron/adapters/llm'

function jsonResp(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const cfg = { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-x', model: 'deepseek-chat' }

describe('LLMAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('chat 发送 OpenAI 兼容请求', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return jsonResp({ choices: [{ message: { content: '你好' } }] })
    })
    const a = new LLMAdapter(cfg)
    const out = await a.chat([{ role: 'user', content: 'hi' }])
    expect(out).toBe('你好')
    expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.model).toBe('deepseek-chat')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer sk-x' })
  })

  it('chat 支持 json 模式（response_format）', async () => {
    let body: any
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string)
      return jsonResp({ choices: [{ message: { content: '[]' } }] })
    })
    const a = new LLMAdapter(cfg)
    await a.chat([{ role: 'user', content: 'hi' }], { json: true })
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('listModels 解析 /models 返回', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResp({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })
    )
    const a = new LLMAdapter(cfg)
    const models = await a.listModels()
    expect(models.map(m => m.id)).toContain('deepseek-chat')
  })

  it('listModels 支持 base 路径含 /v1 的写法', async () => {
    let url = ''
    vi.stubGlobal('fetch', async (u: string) => {
      url = u
      return jsonResp({ data: [{ id: 'm1' }] })
    })
    const a = new LLMAdapter({ ...cfg, baseUrl: 'https://api.example.com/v1' })
    await a.listModels()
    expect(url).toBe('https://api.example.com/v1/models')
  })

  it('HTTP 错误时抛出带状态码的错误', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":"bad key"}', { status: 401 }))
    const a = new LLMAdapter(cfg)
    await expect(a.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/401/)
  })

  it('testConnection 成功返回 ok', async () => {
    vi.stubGlobal('fetch', async () => jsonResp({ choices: [{ message: { content: 'pong' } }] }))
    const a = new LLMAdapter(cfg)
    const r = await a.testConnection()
    expect(r.ok).toBe(true)
  })

  it('testConnection 失败返回 error 信息', async () => {
    vi.stubGlobal('fetch', async () => new Response('denied', { status: 403 }))
    const a = new LLMAdapter(cfg)
    const r = await a.testConnection()
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
})
