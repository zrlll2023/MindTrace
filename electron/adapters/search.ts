/**
 * 联网搜索适配器（spec §7 v2）：Tavily / Bocha 二选一，同一套结果形状。
 * 仅在用户配置了搜索 Key 时启用；报告引擎以工具形式调用。
 */

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface SearchConfig {
  provider: 'tavily' | 'bocha'
  apiKey: string
}

export class SearchAdapter {
  constructor(private cfg: SearchConfig) {}

  async search(query: string, opts: { maxResults?: number } = {}): Promise<SearchResult[]> {
    const max = opts.maxResults ?? 5
    if (this.cfg.provider === 'bocha') return this.bocha(query, max)
    return this.tavily(query, max)
  }

  private async tavily(query: string, max: number): Promise<SearchResult[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`
      },
      body: JSON.stringify({
        query,
        max_results: max,
        search_depth: 'basic',
        include_answer: false
      })
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Tavily 搜索失败 HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      results?: { title?: string; url?: string; content?: string }[]
    }
    return (data.results ?? []).map(r => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: (r.content ?? '').slice(0, 500)
    }))
  }

  private async bocha(query: string, max: number): Promise<SearchResult[]> {
    const res = await fetch('https://api.bochaai.com/v1/web-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`
      },
      body: JSON.stringify({
        query,
        freshness: 'oneMonth',
        summary: true,
        count: max
      })
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`博查搜索失败 HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      webPages?: { value?: { name?: string; url?: string; snippet?: string; summary?: string }[] }
    }
    return (data.webPages?.value ?? []).map(r => ({
      title: r.name ?? '',
      url: r.url ?? '',
      snippet: (r.summary ?? r.snippet ?? '').slice(0, 500)
    }))
  }
}
