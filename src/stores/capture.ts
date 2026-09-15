import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ParsedEntry } from '../../electron/types'

export interface ChatMessageItem {
  role: 'user' | 'assistant'
  text: string
  parsed?: ParsedEntry[]
  committed?: boolean
  error?: string
}

export const useCaptureStore = defineStore('capture', () => {
  const messages = ref<ChatMessageItem[]>([])
  const busy = ref(false)
  const input = ref('')

  async function send(text: string): Promise<void> {
    const raw = text.trim()
    if (!raw || busy.value) return
    input.value = ''
    messages.value.push({ role: 'user', text: raw })
    busy.value = true
    try {
      const r = await window.api.capture.parse(raw)
      if (r.ok) {
        messages.value.push({ role: 'assistant', text: '我解析出了以下内容，请确认：', parsed: r.parsed })
      } else {
        messages.value.push({ role: 'assistant', text: '', error: r.error })
      }
    } catch (e) {
      messages.value.push({ role: 'assistant', text: '', error: (e as Error).message })
    } finally {
      busy.value = false
    }
  }

  async function commit(msg: ChatMessageItem, entries: ParsedEntry[]): Promise<void> {
    const userRaw = [...messages.value].reverse().find(m => m.role === 'user')?.text ?? ''
    const r = await window.api.capture.commit(userRaw, entries)
    if (r.ok) {
      msg.committed = true
      msg.text = `✅ 已归档 ${entries.length} 条记录`
      msg.parsed = undefined
    } else {
      msg.error = r.error
    }
  }

  return { messages, busy, input, send, commit }
})
