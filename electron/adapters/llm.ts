/**
 * LLM 提供商适配器——所有 AI 功能的唯一 HTTP 入口。
 * 兼容 OpenAI 协议（/chat/completions、/models），支持 DeepSeek/智谱/Moonshot/SiliconFlow/Ollama 等。
 */
export interface LLMConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatOptions {
  json?: boolean
  tools?: ToolSpec[]
}

export interface ModelInfo {
  id: string
}

/** 规范化 baseUrl：去尾部斜杠与空白（路径由预设/用户填写完整，如 /v1 或 /api/paas/v4） */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

export class LLMAdapter {
  constructor(private cfg: LLMConfig) {}

  private base(): string {
    // 用户常漏掉 /v1 后缀；DeepSeek 两种都通，其余 OpenAI 兼容商大多需要 /v1
    const b = normalizeBaseUrl(this.cfg.baseUrl)
    return /\/v\d+$/.test(b) || /\/api/.test(b) ? b : `${b}/v1`
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.cfg.apiKey) h.Authorization = `Bearer ${this.cfg.apiKey}`
    return h
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages
    }
    if (opts.json) body.response_format = { type: 'json_object' }
    if (opts.tools?.length) {
      body.tools = opts.tools
      body.tool_choice = 'auto'
    }
    const res = await fetch(`${this.base()}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`LLM 请求失败 HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[]
    }
    const content = data.choices?.[0]?.message?.content
    if (content == null) throw new Error('LLM 返回缺少 choices[0].message.content')
    return content
  }

  /** 返回完整消息（含 tool_calls），供需要工具循环的调用方使用 */
  async chatFull(
    messages: ChatMessage[],
    opts: { tools?: ToolSpec[]; json?: boolean } = {}
  ): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
    const body: Record<string, unknown> = { model: this.cfg.model, messages }
    if (opts.json) body.response_format = { type: 'json_object' }
    if (opts.tools?.length) {
      body.tools = opts.tools
      body.tool_choice = 'auto'
    }
    const res = await fetch(`${this.base()}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`LLM 请求失败 HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[]
    }
    const msg = data.choices?.[0]?.message
    if (!msg) throw new Error('LLM 返回缺少 message')
    return { content: msg.content ?? null, tool_calls: msg.tool_calls }
  }

  /** 带工具循环的对话：由调用方提供工具执行器，最多 maxRounds 轮 */
  async chatWithTools(
    messages: ChatMessage[],
    executor: (name: string, argsJson: string) => Promise<string>,
    tools: ToolSpec[],
    maxRounds = 6
  ): Promise<{ messages: ChatMessage[]; toolCallsUsed: number }> {
    const convo = [...messages]
    let used = 0
    for (let round = 0; round < maxRounds; round++) {
      const res = await this.rawChat(convo, tools)
      const msg = res.choices?.[0]?.message
      if (!msg) throw new Error('LLM 返回缺少 message')
      convo.push({
        role: 'assistant',
        content: msg.content ?? null,
        ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {})
      })
      if (!msg.tool_calls?.length) {
        return { messages: convo, toolCallsUsed: used }
      }
      for (const tc of msg.tool_calls) {
        used++
        let result: string
        try {
          result = await executor(tc.function.name, tc.function.arguments)
        } catch (e) {
          result = JSON.stringify({ error: String((e as Error).message ?? e) })
        }
        convo.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
    }
    return { messages: convo, toolCallsUsed: used }
  }

  private async rawChat(
    messages: ChatMessage[],
    tools: ToolSpec[]
  ): Promise<{
    choices: { message: { content?: string | null; tool_calls?: ToolCall[] } }[]
  }> {
    const res = await fetch(`${this.base()}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        ...(tools.length ? { tools, tool_choice: 'auto' } : {})
      })
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`LLM 请求失败 HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    return (await res.json()) as {
      choices: { message: { content?: string | null; tool_calls?: ToolCall[] } }[]
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.base()}/models`, { headers: this.headers() })
    if (!res.ok) {
      throw new Error(`拉取模型列表失败 HTTP ${res.status}`)
    }
    const data = (await res.json()) as { data?: { id: string }[] }
    return (data.data ?? []).map(m => ({ id: m.id }))
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const out = await this.chat([{ role: 'user', content: 'ping，请只回复 pong' }])
      return { ok: true, error: undefined, ...(out ? {} : {}) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
}
