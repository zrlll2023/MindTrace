import { LLMAdapter } from '../adapters/llm'
import { ChatMessage } from '../adapters/llm'
import { EntryKind, ParsedEntry, PROFILE_KEYS, ProfileValues } from '../types'

const VALID_KINDS: EntryKind[] = ['sleep', 'event', 'conversation', 'quote', 'idea', 'other']

const SYSTEM_PROMPT = `你是 MindTrace 的生活记录解析器。用户会输入随手记录，你要结合最近对话理解指代，但不得编造用户没有明确表达的经历或资料。

只输出一个 JSON 对象，不要输出其他文字：
{"entries":[{"kind":"<类型>","content":{},"confidence":0.8}],"profileDraft":{}}

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
- confidence 表示你对这条解析的把握（0~1）。
- profileDraft 只能从用户明确自述中提取，可用字段：name、preferredName、identity、location、bio、goals、interests；没有明确内容就返回空对象。
- 已提供的用户资料是事实，只能用于理解上下文，绝不在 profileDraft 中覆盖它。`

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

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  let candidate = fence ? fence[1].trim() : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) candidate = candidate.slice(start, end + 1)
  const parsed = JSON.parse(candidate)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
  return parsed as Record<string, unknown>
}

export interface CaptureParseResult { entries: ParsedEntry[]; profileDraft: ProfileValues }

export async function parseCaptureWith(
  llm: LLMAdapter,
  rawText: string,
  history: ChatMessage[] = [],
  profile: ProfileValues = {}
): Promise<CaptureParseResult> {
  const profileText = Object.entries(profile).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
  const messages: ChatMessage[] = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n已确认用户资料（不得覆盖）：\n${profileText || '暂无'}` },
    ...history,
    { role: 'user', content: rawText }
  ]
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await llm.chat(messages, { json: true })
      let obj: Record<string, unknown>
      try {
        obj = extractJsonObject(response)
        if (!Array.isArray(obj.entries)) throw new Error('entries missing')
      }
      catch { obj = { entries: extractJsonArray(response), profileDraft: {} } }
      const arr = Array.isArray(obj.entries) ? obj.entries : []
      const entries = arr.filter(
        (x): x is { kind: EntryKind; content: Record<string, unknown>; confidence: number } =>
          typeof x === 'object' && x !== null && VALID_KINDS.includes((x as { kind?: string }).kind as EntryKind) &&
          typeof (x as { content?: unknown }).content === 'object'
      ).map(v => ({ kind: v.kind, content: v.content ?? {}, confidence: typeof v.confidence === 'number' ? v.confidence : 0.5 }))
      const rawDraft = obj.profileDraft && typeof obj.profileDraft === 'object' ? obj.profileDraft as Record<string, unknown> : {}
      const profileDraft: ProfileValues = {}
      for (const key of PROFILE_KEYS) if (typeof rawDraft[key] === 'string' && rawDraft[key].trim()) profileDraft[key] = rawDraft[key].trim().slice(0, 1000)
      return { entries, profileDraft }
    } catch { /* retry */ }
  }
  return { entries: [{ kind: 'other', content: { text: rawText }, confidence: 0 }], profileDraft: {} }
}

/**
 * 解析一条 dump 为结构化条目列表。
 * - LLM 输出非法 JSON：重试 1 次
 * - 仍失败：整条存为 kind=other、confidence=0（绝不丢数据）
 */
export async function parseDumpWith(llm: LLMAdapter, rawText: string): Promise<ParsedEntry[]> {
  return (await parseCaptureWith(llm, rawText)).entries
}
