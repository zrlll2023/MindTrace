import { LLMAdapter } from '../adapters/llm'
import { EntryKind, ParsedEntry } from '../types'

const VALID_KINDS: EntryKind[] = ['sleep', 'event', 'conversation', 'quote', 'idea', 'other']

const SYSTEM_PROMPT = `你是 MindTrace 的生活记录解析器。用户会输入一段随手记录的混杂文本（可能包含睡眠时长、当天发生的事件、与人的对话、喜欢的句子、突然的想法等）。你的任务是把它拆解为结构化条目。

只输出一个 JSON 数组，不要输出任何其他文字。每个元素形如：
{"kind": "<类型>", "content": {...}, "confidence": 0到1的小数}

kind 的六种取值与 content schema：
1. "sleep" —— 睡眠。content: {"hours": 数字}。例：「睡了6.5小时」→ {"hours": 6.5}
2. "event" —— 发生的事件/经历。content: {"text": "事件描述", "negative": 布尔(是否负面,可选)}
3. "conversation" —— 与他人的对话（值得记录的）。content: {"with": "对象(可选)", "text": "对话内容或摘要"}
4. "quote" —— 看到/听到的喜欢的句子。content: {"text": "句子原文", "from": "出处(可选)"}
5. "idea" —— 突然的想法/灵感/思考。content: {"text": "想法内容"}
6. "other" —— 无法归类但值得保留的内容。content: {"text": "原文"}

规则：
- 一段文本可能包含多条内容，全部拆出；不要遗漏。
- content.text 保留用户原意，可轻度精炼，但不要编造。
- 无法确定类型时用 "other"。完全无法解析时输出 []。
- confidence 表示你对这条解析的把握（0~1）。`

/** 从 LLM 输出中提取 JSON 数组（容忍 ```json 代码块等包装） */
export function extractJsonArray(text: string): unknown[] {
  const trimmed = text.trim()
  let candidate = trimmed
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) candidate = fence[1].trim()
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start >= 0 && end > start) candidate = candidate.slice(start, end + 1)
  const parsed = JSON.parse(candidate)
  if (!Array.isArray(parsed)) throw new Error('not an array')
  return parsed
}

/**
 * 解析一条 dump 为结构化条目列表。
 * - LLM 输出非法 JSON：重试 1 次
 * - 仍失败：整条存为 kind=other、confidence=0（绝不丢数据）
 */
export async function parseDumpWith(llm: LLMAdapter, rawText: string): Promise<ParsedEntry[]> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: rawText }
  ]

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await llm.chat(messages, { json: true })
      const arr = extractJsonArray(out)
      const valid = arr.filter(
        (x): x is { kind: EntryKind; content: Record<string, unknown>; confidence: number } =>
          typeof x === 'object' &&
          x !== null &&
          VALID_KINDS.includes((x as { kind?: string }).kind as EntryKind) &&
          typeof (x as { content?: unknown }).content === 'object'
      )
      if (valid.length || arr.length === 0) {
        return valid.map(v => ({
          kind: v.kind,
          content: v.content ?? {},
          confidence: typeof v.confidence === 'number' ? v.confidence : 0.5
        }))
      }
    } catch {
      // 重试或降级
    }
  }

  return [{ kind: 'other', content: { text: rawText }, confidence: 0 }]
}
