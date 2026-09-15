/**
 * 本地 Mock LLM 服务器——替代真实 API Key 的开发/测试工具。
 *
 * 提供 OpenAI 兼容端点：
 *   POST /v1/chat/completions —— 返回脚本化响应（工具循环：先 query_entries → 再交报告）
 *   GET  /v1/models           —— 返回假模型列表
 *
 * 用途：pnpm mock 后，在 MindTrace 设置页把 Base URL 填 http://localhost:8787/v1，
 *      API Key 随便填（如 mock），即可完整跑通 解析/日报/周报/工具循环 全链路。
 */
import http from 'node:http'

const PORT = process.env.MOCK_PORT || 8787

// ---------- 脚本化的"智能"行为 ----------

/** 从用户消息中提取当日记录 digest（JSON 数组） */
function extractDigest(messages) {
  for (const m of messages) {
    if (m.role === 'user' && typeof m.content === 'string' && m.content.includes('当日记录')) {
      try {
        const jsonStart = m.content.indexOf('[\n')
        const idx = m.content.indexOf('：')
        const arrStart = m.content.indexOf('[', m.content.indexOf('当日记录'))
        return JSON.parse(m.content.slice(arrStart, m.content.lastIndexOf(']') + 1))
      } catch {
        /* fallthrough */
      }
    }
  }
  return null
}

/** 捕获解析请求：返回拆解好的条目 */
function parseResponse(userText) {
  const entries = []
  const sleep = userText.match(/睡了\s*([0-9.]+)\s*(?:小时|个?小时|h)/)
  if (sleep) entries.push({ kind: 'sleep', content: { hours: parseFloat(sleep[1]) }, confidence: 0.95 })

  const quote = userText.match(/[：:]["“]?([^""”。，,]{4,30})["”]?/g) || []
  for (const q of quote.slice(0, 2)) {
    const text = q.replace(/^[：:]["“]|["”]$/g, '')
    if (text && text.length >= 4) entries.push({ kind: 'quote', content: { text }, confidence: 0.85 })
  }

  const ideaWords = ['想到', '突然想到', '灵感', '觉得可以', '如果']
  for (const w of ideaWords) {
    const i = userText.indexOf(w)
    if (i >= 0) {
      const seg = userText.slice(i, i + 40).split(/[。；;\n]/)[0]
      entries.push({ kind: 'idea', content: { text: seg }, confidence: 0.8 })
      break
    }
  }

  const negativeWords = ['被骂', '吵架', '被批', '挨骂', '不开心', '难过', '失败']
  for (const w of negativeWords) {
    const i = userText.indexOf(w)
    if (i >= 0) {
      const seg = userText.slice(Math.max(0, i - 10), i + 20).split(/[。；;\n]/)[0]
      entries.push({ kind: 'event', content: { text: seg, negative: true }, confidence: 0.85 })
      break
    }
  }

  if (!entries.length) {
    entries.push({ kind: 'other', content: { text: userText.slice(0, 60) }, confidence: 0.6 })
  }
  return entries
}

/** 报告生成：检索工具的返回已被 assistant 侧吸收，这里直接产出报告 */
function buildReport(digest, searchResults, quotedIds) {
  const date = new Date().toISOString().slice(0, 10)
  const sleepEntry = (digest || []).find(e => e.kind === 'sleep')
  const ideaEntry = (digest || []).find(e => e.kind === 'idea')
  const threadTitle = ideaEntry ? '想法孵化线' : null

  const lines = []
  lines.push(`## 今天概况`)
  lines.push(
    sleepEntry
      ? `- 睡眠 ${sleepEntry.content.hours} 小时${sleepEntry.content.hours < 7 ? '，偏少' : ''}，共 ${digest.length} 条记录。`
      : `- 共 ${digest.length} 条记录。`
  )
  lines.push('')
  lines.push(`## 规律与洞察`)
  lines.push(`- （Mock 演示）你的记录里想法类内容占比不低，说明白天头脑活跃；若睡前记录多，可能影响入睡。`)
  lines.push('')
  if (threadTitle) {
    lines.push(`## 兴趣线推进`)
    lines.push(`- **${threadTitle}**：今天又有了新的想法记录，这条线在持续生长。`)
    lines.push('')
  }
  if (searchResults && searchResults.length) {
    lines.push(`## 推荐内容`)
    for (const r of searchResults.slice(0, 3)) {
      lines.push(`- [${r.title}](${r.url}) —— ${r.snippet.slice(0, 50)}`)
    }
    lines.push('')
  }
  lines.push(`## 明日建议`)
  lines.push(`- 保持记录习惯；明天试试在记录里补一句"今天最有价值的事"。`)
  lines.push('')
  lines.push(`> 本报告由本地 Mock LLM 生成（演示用）`)

  return {
    report_md: lines.join('\n'),
    threads: threadTitle
      ? [{ title: threadTitle, description: '持续记录的想法与灵感', status: 'active', linked_entry_ids: quotedIds }]
      : []
  }
}

// ---------- HTTP 服务器 ----------

const server = http.createServer(async (req, res) => {
  const body = await readBody(req)

  if (req.method === 'GET' && req.url?.includes('/models')) {
    return json(res, { data: [{ id: 'mock-chat' }, { id: 'mock-reasoner' }] })
  }

  if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      return json(res, { error: 'bad json' }, 400)
    }
    const messages = payload.messages || []
    const last = messages[messages.length - 1] || {}
    const sys = messages.find(m => m.role === 'system')?.content || ''

    // 1) 工具结果回传后的下一轮 → 若刚才是本地查询且允许搜索，则再发一次 web_search
    const toolMsgs = messages.filter(m => m.role === 'tool')
    if (toolMsgs.length) {
      const lastTool = toolMsgs[toolMsgs.length - 1]
      let toolData = {}
      try {
        toolData = JSON.parse(lastTool.content)
      } catch {}

      // 刚拿到 query_entries 结果且系统提示允许搜索 → 发起 web_search
      if (toolData.entries && sys.includes('联网搜索')) {
        const idea = (extractDigest(messages) || []).find(e => e.kind === 'idea')
        const q = idea ? String(idea.content.text).slice(0, 20) : '个人成长 方法'
        return json(res, {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_ws_' + Date.now(),
                    type: 'function',
                    function: { name: 'web_search', arguments: JSON.stringify({ query: q }) }
                  }
                ]
              }
            }
          ]
        })
      }

      // 拿到搜索结果（或未开启搜索）→ 产出最终报告
      const searchResults = toolData.results || []
      const digest = extractDigest(messages) || []
      const entryMsgs = toolMsgs.filter(m => {
        try { return Array.isArray(JSON.parse(m.content).entries) } catch { return false }
      })
      const quotedIds = entryMsgs.flatMap(m => {
        try { return JSON.parse(m.content).entries.map(e => e.id).filter(Boolean) } catch { return [] }
      })
      const report = buildReport(digest, searchResults, quotedIds)
      return json(res, openAIFormat(JSON.stringify(report)))
    }

    // 2) 解析请求（系统提示含"生活记录解析器"）
    if (sys.includes('生活记录解析器')) {
      const userText = last.content || ''
      return json(res, openAIFormat(JSON.stringify(parseResponse(userText))))
    }

    // 3) 周报请求（system 含"周报"）
    if (sys.includes('研究向导')) {
      return json(res, openAIFormat(JSON.stringify({
        queries: ['RAG 评估 最新方法', '个人知识管理 工具对比', '睡眠与情绪 管理'],
        note: '（Mock）基于你近期的想法与兴趣线生成的研究方向。'
      })))
    }
    if (sys.includes('周报')) {
      const md = [
        '## 一周概况',
        '本周共记录多条生活数据，Mock 演示摘要。',
        '',
        '## 规律与变化',
        '- 睡眠整体稳定，想法类记录集中在工作日。',
        '',
        '## 兴趣线进展',
        '- 想法孵化线持续推进。',
        '',
        '## 下周建议',
        '- 保持节奏，尝试每周一次复盘。',
        '',
        '> 本报告由本地 Mock LLM 生成（演示用）'
      ].join('\n')
      return json(res, openAIFormat(md))
    }

    // 4) 日报请求：先调用 query_entries 工具（演示工具循环）
    if (sys.includes('分析师')) {
      return json(res, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_' + Date.now(),
                  type: 'function',
                  function: { name: 'query_entries', arguments: JSON.stringify({ limit: 20 }) }
                }
              ]
            }
          }
        ]
      })
    }

    // 5) 兜底（测试连接等）
    return json(res, openAIFormat('pong（mock）'))
  }

  res.writeHead(404)
  res.end('not found')
})

function readBody(req) {
  return new Promise(resolve => {
    let data = ''
    req.on('data', c => (data += c))
    req.on('end', () => resolve(data))
  })
}

function openAIFormat(content) {
  return {
    choices: [{ message: { role: 'assistant', content } }]
  }
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

server.listen(PORT, () => {
  console.log(`Mock LLM 已启动: http://localhost:${PORT}/v1`)
  console.log(`在 MindTrace 设置页填: Base URL = http://localhost:${PORT}/v1, Key = mock, 模型 = mock-chat`)
})
