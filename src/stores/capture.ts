import { defineStore } from 'pinia'
import { ref } from 'vue'
import { EntryKind, ParsedEntry, ProfileValues } from '../../electron/types'
import { localDateString } from '../utils/datetime'

export interface CaptureEntry extends ParsedEntry {
  addToKnowledge?: boolean
  folderId?: number
  reason?: string
}

export interface ChatMessageItem {
  id: number
  role: 'user' | 'assistant'
  text: string
  parsed?: CaptureEntry[]
  profileDraft?: ProfileValues
  committed?: boolean
  error?: string
  createdAt?: string
  archivedEntryIds?: number[]
}

export function changeCaptureEntryKind(entry: CaptureEntry, nextKind: EntryKind): void {
  if (entry.kind === nextKind) return
  // 睡眠只能由 AI 初始识别为睡眠的条目产生，不能由事件/想法等文本条目改出。
  if (nextKind === 'sleep' && entry.originalKind !== 'sleep') return
  const previousText = typeof entry.content.text === 'string' ? entry.content.text : ''
  entry.kind = nextKind
  entry.content = nextKind === 'sleep'
    ? { hours: 0 }
    : { text: previousText, ...(nextKind === 'event' ? { negative: false } : {}) }
  if (nextKind === 'sleep') {
    entry.addToKnowledge = false
    entry.folderId = undefined
  }
}

export function isCaptureEntryValid(entry: CaptureEntry): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.entryDate)) return false
  const [year, month, day] = entry.entryDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return false
  if (entry.entryTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.entryTime)) return false
  if (entry.kind === 'sleep') {
    const hours = Number(entry.content.hours)
    return Number.isFinite(hours) && hours > 0 && hours <= 24
  }
  return typeof entry.content.text === 'string' && entry.content.text.trim().length > 0
}

export function toCaptureCommitPayload(entries: CaptureEntry[]): CaptureEntry[] {
  return JSON.parse(JSON.stringify(entries)) as CaptureEntry[]
}

export const useCaptureStore = defineStore('capture', () => {
  const messages = ref<ChatMessageItem[]>([])
  const busy = ref(false)
  const input = ref('')
  const committingIds = ref<number[]>([])
  const undoingIds = ref<number[]>([])

  function normalize(messagesIn: ChatMessageItem[]): ChatMessageItem[] {
    return messagesIn.map(m => ({
      ...m,
      text: m.committed && m.text === '我解析出了以下内容，请确认：' ? '已保存到时间线' : m.text,
      parsed: m.parsed?.map(p => ({
        ...p,
        entryDate: p.entryDate || localDateString(),
        originalKind: p.originalKind || p.kind,
        addToKnowledge: m.committed ? !!p.addToKnowledge : false,
        folderId: p.kind !== 'sleep' ? p.folderId : undefined
      }))
    }))
  }

  async function load(): Promise<void> {
    messages.value = normalize(await window.api.capture.list())
  }

  async function send(text: string): Promise<void> {
    const raw = text.trim()
    if (!raw || busy.value) return
    input.value = ''
    busy.value = true
    try {
      const r = await window.api.capture.parse(raw)
      if (r.canceled) return
      if (!r.ok && !r.message) {
        input.value = raw
        messages.value.push({ id: Date.now(), role: 'assistant', text: '', error: r.error || 'AI 解析失败，请重试', createdAt: new Date().toLocaleString('sv-SE') })
        return
      }
      await load()
    } catch (e) {
      messages.value.push({ id: Date.now(), role: 'assistant', text: '', error: (e as Error).message, createdAt: new Date().toLocaleString('sv-SE') })
    } finally {
      busy.value = false
    }
  }

  async function commit(msg: ChatMessageItem, entries: CaptureEntry[]): Promise<boolean> {
    if (committingIds.value.includes(msg.id)) return false
    if (!entries.length || entries.some(entry => !isCaptureEntryValid(entry))) {
      msg.error = '请先补全有效的内容、日期和时间'
      return false
    }
    committingIds.value = [...committingIds.value, msg.id]
    msg.error = undefined
    try {
      const r = await window.api.capture.commit(msg.id, toCaptureCommitPayload(entries))
      if (!r.ok) {
        msg.error = r.error || '保存失败，请重试'
        return false
      }
      msg.committed = true
      msg.archivedEntryIds = r.entries.map((entry: { id: number }) => entry.id)
      return true
    } catch (e) {
      msg.error = (e as Error).message || '保存失败，请重试'
      return false
    } finally {
      committingIds.value = committingIds.value.filter(id => id !== msg.id)
    }
  }

  async function undo(msg: ChatMessageItem): Promise<boolean> {
    if (undoingIds.value.includes(msg.id) || !msg.committed) return false
    undoingIds.value = [...undoingIds.value, msg.id]
    msg.error = undefined
    try {
      const result = await window.api.capture.undoCommit(msg.id)
      if (!result.ok) {
        msg.error = result.error || '撤回失败，请重试'
        return false
      }
      msg.committed = false
      msg.archivedEntryIds = undefined
      return true
    } catch (error) {
      msg.error = error instanceof Error ? error.message : '撤回失败，请重试'
      return false
    } finally {
      undoingIds.value = undoingIds.value.filter(id => id !== msg.id)
    }
  }

  async function clear(): Promise<boolean> {
    if (busy.value || committingIds.value.length || undoingIds.value.length) return false
    const result = await window.api.capture.clear()
    if (!result.ok) return false
    messages.value = []
    input.value = ''
    committingIds.value = []
    undoingIds.value = []
    return true
  }

  function isCommitting(messageId: number): boolean {
    return committingIds.value.includes(messageId)
  }

  function isUndoing(messageId: number): boolean {
    return undoingIds.value.includes(messageId)
  }

  return { messages, busy, input, committingIds, undoingIds, load, send, commit, undo, clear, isCommitting, isUndoing }
})
