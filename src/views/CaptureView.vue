<template>
  <div class="capture-page">
    <!-- 模式切换：手动优先，AI 辅助 -->
    <div class="mode-bar">
      <button :class="mode === 'manual' ? 'seg active' : 'seg'" @click="mode = 'manual'">✍️ 手动录入</button>
      <button :class="mode === 'ai' ? 'seg active' : 'seg'" @click="mode = 'ai'">🤖 AI 快速记录</button>
      <span class="mode-hint">{{ mode === 'manual' ? '直接填写，立即入库，不消耗 AI 额度' : '像聊天一样随手倒进来，AI 帮你拆解归档（消耗 API 额度）' }}</span>
    </div>

    <!-- ========== 手动录入 ========== -->
    <div v-if="mode === 'manual'" class="manual card">
      <div class="field">
        <label>类型</label>
        <div class="kinds">
          <button
            v-for="(label, k) in KIND_LABELS"
            :key="k"
            class="chip"
            :class="{ on: manualKind === k }"
            @click="manualKind = k"
          >{{ label }}</button>
        </div>
      </div>

      <div v-if="manualKind === 'sleep'" class="row">
        <div class="field grow">
          <label>睡眠时长（小时）</label>
          <input v-model.number="manualHours" type="number" step="0.5" min="0" max="24" />
        </div>
        <div class="field grow">
          <label>日期</label>
          <input v-model="manualDate" type="date" />
        </div>
      </div>
      <template v-else>
        <div class="field">
          <label>内容</label>
          <textarea v-model="manualText" rows="4" :placeholder="manualPlaceholder" />
        </div>
        <div class="row">
          <div v-if="manualKind === 'quote'" class="field grow">
            <label>出处（可选）</label>
            <input v-model="manualFrom" placeholder="如：《活着》余华" />
          </div>
          <div v-if="manualKind === 'event'" class="field grow">
            <label class="checkbox"><input v-model="manualNegative" type="checkbox" />负面事件</label>
          </div>
          <div class="field grow">
            <label>日期</label>
            <input v-model="manualDate" type="date" />
          </div>
        </div>
      </template>

      <div class="row">
        <button class="primary" :disabled="!manualReady || manualSaving" @click="saveManual">
          {{ manualSaving ? '保存中…' : '保存（不经过 AI）' }}
        </button>
        <span v-if="manualMsg" :class="manualOk ? 'msg ok' : 'msg err'">{{ manualMsg }}</span>
      </div>
    </div>

    <!-- ========== AI 快速记录 ========== -->
    <div v-else class="capture">
      <div class="messages" ref="listEl">
        <div v-if="!store.messages.length" class="empty">
          <h2>今天怎么样？</h2>
          <p>随手倒进来：睡眠、琐事、对话、喜欢的句子、突然的想法……<br />AI 会帮你拆解归档，你确认后才会入库。</p>
          <p class="eg">例如：「睡了6.5小时，被导师骂了一顿，看到一句话：纸上得来终觉浅，突然想到RAG评估好像有新方法」</p>
        </div>

        <div v-for="(m, i) in store.messages" :key="i" class="msg" :class="m.role">
          <div class="bubble">
            <template v-if="m.role === 'user'">{{ m.text }}</template>
            <template v-else>
              <p v-if="m.error" class="err">⚠️ {{ m.error }}</p>
              <p v-if="m.text">{{ m.text }}</p>
              <template v-if="m.parsed && !m.committed">
                <EntryCard
                  v-for="(p, j) in m.parsed"
                  :key="j"
                  :entry="p"
                  @remove="m.parsed!.splice(j, 1)"
                />
                <button class="primary" :disabled="!m.parsed?.length" @click="confirm(m)">
                  确认归档（{{ m.parsed?.length }} 条）
                </button>
              </template>
            </template>
          </div>
        </div>

        <div v-if="store.busy" class="msg assistant">
          <div class="bubble typing">AI 正在解析…</div>
        </div>
      </div>

      <div class="composer">
        <textarea
          v-model="store.input"
          rows="3"
          placeholder="随手记录…（Enter 发送，Ctrl+Enter 换行）"
          @keydown.enter.exact.prevent="submit"
          @keydown.ctrl.enter.stop
        />
        <button :disabled="store.busy" @click="submit">{{ store.busy ? '解析中…' : '发送' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted } from 'vue'
import { useCaptureStore, ChatMessageItem } from '../stores/capture'
import EntryCard from '../components/EntryCard.vue'
import { KIND_LABELS, EntryKind } from '../../electron/types'

const store = useCaptureStore()
const listEl = ref<HTMLElement>()

const mode = ref<'manual' | 'ai'>('manual')

// ---------- 手动录入 ----------
const manualKind = ref<EntryKind>('event')
const manualText = ref('')
const manualHours = ref<number | null>(null)
const manualFrom = ref('')
const manualNegative = ref(false)
const manualDate = ref(new Date().toISOString().slice(0, 10))
const manualSaving = ref(false)
const manualMsg = ref('')
const manualOk = ref(false)

const manualPlaceholder = computed(() => {
  const m: Partial<Record<EntryKind, string>> = {
    event: '如：下午和导师讨论了论文框架',
    conversation: '如：和朋友聊了职业选择，他说……',
    quote: '粘贴你喜欢的句子',
    idea: '如：把 RAG 评估做成一个开源工具',
    other: '任何想记下来的东西'
  }
  return m[manualKind.value] ?? '内容'
})

const manualReady = computed(() => {
  if (manualKind.value === 'sleep') return manualHours.value != null && manualHours.value > 0 && manualHours.value <= 24
  return manualText.value.trim().length > 0
})

async function saveManual(): Promise<void> {
  manualSaving.value = true
  manualMsg.value = ''
  try {
    const content =
      manualKind.value === 'sleep'
        ? { hours: manualHours.value }
        : manualKind.value === 'quote'
          ? { text: manualText.value.trim(), ...(manualFrom.value.trim() ? { from: manualFrom.value.trim() } : {}) }
          : manualKind.value === 'event'
            ? { text: manualText.value.trim(), negative: manualNegative.value }
            : { text: manualText.value.trim() }
    const rawText = manualKind.value === 'sleep' ? `睡了${manualHours.value}小时` : manualText.value.trim()
    const r = await window.api.entries.manual(manualKind.value, content, rawText, manualDate.value || undefined)
    if (r.ok) {
      manualOk.value = true
      manualMsg.value = '✅ 已保存到时间线'
      manualText.value = ''
      manualHours.value = null
      manualFrom.value = ''
      manualNegative.value = false
    } else {
      manualOk.value = false
      manualMsg.value = `❌ ${r.error}`
    }
  } finally {
    manualSaving.value = false
    setTimeout(() => (manualMsg.value = ''), 4000)
  }
}

// ---------- AI 快速记录 ----------
function submit(): void {
  void store.send(store.input)
}

async function confirm(m: ChatMessageItem): Promise<void> {
  if (m.parsed) await store.commit(m, m.parsed)
}

watch(
  () => store.messages.length,
  async () => {
    await nextTick()
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' })
  }
)

onMounted(() => {
  const s = localStorage.getItem('mt-capture-mode')
  if (s === 'ai' || s === 'manual') mode.value = s
})
watch(mode, v => localStorage.setItem('mt-capture-mode', v))
</script>

<style scoped>
.capture-page { display: flex; flex-direction: column; height: calc(100vh - 72px); }
.mode-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.seg {
  padding: 7px 16px; border: 1px solid var(--border-strong); border-radius: 999px;
  background: var(--surface); color: var(--text-2); font-size: 13.5px;
}
.seg.active { background: var(--accent-weak); border-color: var(--accent); color: var(--accent); font-weight: 600; }
.mode-hint { font-size: 12px; color: var(--text-3); margin-left: 4px; }

/* 手动录入 */
.manual { max-width: 720px; }
.kinds { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  padding: 6px 14px; border-radius: 999px; border: 1px solid var(--border-strong);
  background: var(--surface); color: var(--text-2); font-size: 13px;
}
.chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.grow { flex: 1; min-width: 140px; }
.manual .msg { margin: 0; }

/* AI 聊天 */
.capture { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.messages { flex: 1; overflow-y: auto; padding: 4px 8px; }
.empty { text-align: center; margin-top: 10vh; color: var(--text-2); }
.empty h2 { font-size: 22px; margin-bottom: 8px; }
.eg { font-size: 12px; color: var(--text-3); max-width: 560px; margin: 12px auto 0; }
.msg { display: flex; margin: 10px 0; }
.msg.user { justify-content: flex-end; }
.msg.assistant { justify-content: flex-start; }
.bubble {
  max-width: 640px; padding: 10px 14px; border-radius: 14px; font-size: 14px;
  background: var(--surface); box-shadow: var(--shadow);
}
.msg.user .bubble { background: var(--accent); color: #fff; }
.msg.assistant .bubble { min-width: 320px; }
.typing { color: var(--text-3); }
.err { color: var(--danger); font-size: 13px; }
.bubble .primary { margin-top: 8px; }
.composer { display: flex; gap: 10px; padding: 12px 8px 4px; align-items: flex-end; }
.composer textarea { flex: 1; resize: none; border-radius: 12px; }
.composer button { padding: 10px 22px; border-radius: 12px; }
</style>
