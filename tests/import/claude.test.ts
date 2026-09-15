import { describe, it, expect } from 'vitest'
import { parseClaudeExport } from '../../electron/import/claude'

const SAMPLE = JSON.stringify([
  {
    name: '向量数据库选型',
    created_at: '2026-09-14T10:30:00.000Z',
    chat_messages: [
      { sender: 'human', text: 'RAG 用什么向量库好？', created_at: '2026-09-14T10:30:00.000Z' },
      { sender: 'assistant', text: '看规模：小项目 sqlite-vec，大项目 Qdrant……', created_at: '2026-09-14T10:31:00.000Z' }
    ]
  }
])

describe('parseClaudeExport', () => {
  it('解析会话：标题/角色/内容/日期', () => {
    const out = parseClaudeExport(SAMPLE)
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('claude')
    expect(out[0].title).toBe('向量数据库选型')
    expect(out[0].date).toBe('2026-09-14')
    expect(out[0].messages).toHaveLength(2)
    expect(out[0].messages[0].role).toBe('user')
    expect(out[0].messages[1].role).toBe('assistant')
  })

  it('跳过空 text 消息', () => {
    const data = [
      {
        name: 't',
        created_at: '2026-09-14T10:30:00.000Z',
        chat_messages: [{ sender: 'human', text: '', created_at: '2026-09-14T10:30:00.000Z' }]
      }
    ]
    expect(parseClaudeExport(JSON.stringify(data))[0].messages).toHaveLength(0)
  })

  it('非法结构抛可读错误', () => {
    expect(() => parseClaudeExport('{"x":1}')).toThrow(/解析失败/)
  })
})
