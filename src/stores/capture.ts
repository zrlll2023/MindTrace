import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ParsedEntry, ProfileValues } from '../../electron/types'

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
}

export const useCaptureStore = defineStore('capture', () => {
  const messages = ref<ChatMessageItem[]>([])
  const busy = ref(false)
  const input = ref('')
  const defaultFolderId = ref<number>()

  function normalize(messagesIn: ChatMessageItem[]): ChatMessageItem[] {
    return messagesIn.map(m => ({
      ...m,
      parsed: m.parsed?.map(p => ({ ...p, addToKnowledge: p.kind !== 'sleep', folderId: p.kind !== 'sleep' ? defaultFolderId.value : undefined }))
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
      if (r.defaultFolderId) defaultFolderId.value = r.defaultFolderId
      await load()
    } catch (e) {
      messages.value.push({ id: Date.now(), role: 'assistant', text: '', error: (e as Error).message })
    } finally {
      busy.value = false
    }
  }

  async function commit(msg: ChatMessageItem, entries: CaptureEntry[]): Promise<void> {
    const r = await window.api.capture.commit(msg.id, entries)
    if (r.ok) {
      msg.committed = true
      msg.text = `✅ 已归档 ${entries.length} 条记录`
      msg.parsed = undefined
    } else {
      msg.error = r.error
    }
  }

  async function clear(): Promise<void> {
    await window.api.capture.clear()
    messages.value = []
  }

  return { messages, busy, input, defaultFolderId, load, send, commit, clear }
})
