import { KnowledgeBase, KbItem } from '../db/knowledge'
import { LLMAdapter } from '../adapters/llm'
import { sanitizeText } from '../analysis/validators'

/**
 * 知识库 AI 辅助（v3）。设计原则：
 * - AI 只是按钮背后的工具：summarizeItem / extendFolder 都由用户显式点击触发
 * - 输出一律经过契约净化（sanitizeText），绝不进入 entries，只写 ai_summary 辅助字段
 * - 失败返回错误字符串，绝不抛断 UI
 */
export async function summarizeItem(
  kb: KnowledgeBase,
  item: KbItem,
  llm: LLMAdapter
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const body = item.body.slice(0, 4000)
  if (!body.trim()) return { ok: false, error: '这份资料没有可总结的正文' }
  try {
    const out = await llm.chat([
      { role: 'system', content: '你是资料总结助手。用中文 3~5 句话总结给定资料的核心内容，不要添加资料之外的观点。' },
      { role: 'user', content: `标题：${item.title}\n\n${body}` }
    ])
    const summary = sanitizeText(out).trim()
    if (!summary) return { ok: false, error: 'AI 返回了空内容' }
    kb.updateSummary(item.id, summary)
    return { ok: true, summary }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function extendFolder(
  kb: KnowledgeBase,
  folderName: string,
  items: KbItem[],
  llm: LLMAdapter
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const corpus = items
    .map(i => `- ${i.title}${i.body ? `：${i.body.slice(0, 300)}` : ''}`)
    .join('\n')
    .slice(0, 6000)
  if (!corpus.trim()) return { ok: false, error: '该文件夹还没有内容可供延伸' }
  try {
    const out = await llm.chat([
      {
        role: 'system',
        content:
          '你是创作延伸助手。根据用户收集的资料风格与主题，沿同一方向创作新的延伸内容（如新句子、新想法、新读书方向）。用中文输出，用换行分隔多条建议，不要重复已有内容。'
      },
      { role: 'user', content: `文件夹「${folderName}」中我收集的内容：\n${corpus}\n\n请据此延伸出新的内容。` }
    ])
    const text = sanitizeText(out).trim()
    if (!text) return { ok: false, error: 'AI 返回了空内容' }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
