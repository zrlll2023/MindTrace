import { describe, it, expect } from 'vitest'
import { parseChatGPTExport } from '../../electron/import/chatgpt'

const SAMPLE = JSON.stringify([
  {
    id: 'chatgpt-rag-1',
    title: 'RAG 评估方法讨论',
    create_time: 1757894400, // 2026-09-15 00:00:00 UTC（示例）
    mapping: {
      aaa: {
        message: {
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['RAG 的评估指标有哪些？'] },
          create_time: 1757894400
        },
        parent: undefined,
        children: ['bbb']
      },
      bbb: {
        message: {
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: ['常见的有 faithfulness、answer relevance……'] },
          create_time: 1757894460
        }
      }
    }
  }
])

describe('parseChatGPTExport', () => {
  it('解析 conversations.json：标题/角色/内容/时间', () => {
    const out = parseChatGPTExport(SAMPLE)
    expect(out).toHaveLength(1)
    const conv = out[0]
    expect(conv.title).toBe('RAG 评估方法讨论')
    expect(conv.externalId).toBe('chatgpt-rag-1')
    expect(conv.messages).toHaveLength(2)
    expect(conv.messages[0].role).toBe('user')
    expect(conv.messages[0].content).toContain('评估指标')
    expect(conv.messages[1].role).toBe('assistant')
    expect(conv.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('跳过非文本 content 与空 parts', () => {
    const data = [
      {
        title: 't',
        create_time: 1757894400,
        mapping: {
          a: {
            message: {
              author: { role: 'user' },
              content: { content_type: 'code', parts: [] },
              create_time: 1757894400
            }
          }
        }
      }
    ]
    const out = parseChatGPTExport(JSON.stringify(data))
    expect(out[0].messages).toHaveLength(0)
  })

  it('非法 JSON 抛出可读错误', () => {
    expect(() => parseChatGPTExport('not json')).toThrow(/解析失败/)
  })
})
