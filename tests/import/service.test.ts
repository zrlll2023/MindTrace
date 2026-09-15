import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { parseExportZip } from '../../electron/import/service'
import { initDb } from '../../electron/db/connection'
import { Repo } from '../../electron/db/repository'
import { importConversations } from '../../electron/import/service'

describe('parseExportZip', () => {
  it('识别 ChatGPT 导出（mapping 结构）', () => {
    const json = JSON.stringify([
      {
        title: 't',
        create_time: 1757894400,
        mapping: {
          a: {
            message: {
              author: { role: 'user' },
              content: { content_type: 'text', parts: ['hi'] },
              create_time: 1757894400
            }
          }
        }
      }
    ])
    const zip = zipSync({ 'conversations.json': strToU8(json) })
    const out = parseExportZip(zip)
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('chatgpt')
  })

  it('识别 Claude 导出（chat_messages 结构）', () => {
    const json = JSON.stringify([
      {
        name: 't',
        created_at: '2026-09-14T10:00:00Z',
        chat_messages: [{ sender: 'human', text: 'hi', created_at: '2026-09-14T10:00:00Z' }]
      }
    ])
    const zip = zipSync({ 'conversations.json': strToU8(json) })
    const out = parseExportZip(zip)
    expect(out[0].source).toBe('claude')
  })

  it('无法识别时抛可读错误', () => {
    const zip = zipSync({ 'conversations.json': strToU8('[{"foo":1}]') })
    expect(() => parseExportZip(zip)).toThrow(/无法识别/)
  })

  it('不是 ZIP 时抛可读错误', () => {
    expect(() => parseExportZip(new Uint8Array([1, 2, 3]))).toThrow(/ZIP/)
  })
})

describe('importConversations', () => {
  it('写入 conversation 条目并可去重（二次导入 skipped）', async () => {
    const repo = new Repo(await initDb(':memory:'))
    const convs = [
      {
        source: 'chatgpt' as const,
        title: 'RAG 讨论',
        date: '2026-09-14',
        messages: [
          { role: 'user' as const, content: 'RAG 评估怎么做？', timestamp: 1757894400 },
          { role: 'assistant' as const, content: '常用 RAGAS……', timestamp: 1757894460 }
        ]
      }
    ]
    const first = await importConversations(repo, convs)
    expect(first.imported).toBe(2)
    expect(first.skipped).toBe(0)

    const second = await importConversations(repo, convs)
    expect(second.imported).toBe(0)
    expect(second.skipped).toBe(2)

    const all = await repo.listEntries({ kind: 'conversation' })
    expect(all).toHaveLength(2)
    expect(all[0].source).toBe('import:chatgpt')
  })
})
