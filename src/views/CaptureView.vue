<template>
  <div class="capture-page">
    <div class="page-head">
      <h1 class="page-title">记录</h1>
      <p class="page-sub">写下此刻，归档为可回溯的条目</p>
    </div>

    <!-- 模式切换：手动优先，AI 辅助 -->
    <div class="mode-switch">
      <div class="seg-group">
        <button :class="mode === 'manual' ? 'seg on' : 'seg'" @click="mode = 'manual'">
          <Icon name="pen" :size="15" />手动直录
        </button>
        <button :class="mode === 'ai' ? 'seg on' : 'seg'" @click="mode = 'ai'">
          <Icon name="chat" :size="15" />AI 快速记录
        </button>
      </div>
      <span class="mode-hint">
        {{ mode === 'manual' ? '直接填写，立即入库，不消耗 AI 额度' : '像聊天一样随手倒进来，AI 帮你拆解归档（消耗 API 额度）' }}
      </span>
    </div>

    <!-- ========== 手动录入 ========== -->
    <div v-if="mode === 'manual'" class="manual card">
      <div class="field">
        <label>类型</label>
        <div class="kinds">
          <button
            v-for="(label, k) in KIND_PLAIN"
            :key="k"
            class="chip kind"
            :class="[kindClass(k), { on: manualKind === k }]"
            @click="setKind(k)"
          >
            <span class="kind-dot" />{{ label }}
          </button>
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
            <label class="checkbox"><input v-model="manualNegative" type="checkbox" />标记为负面事件</label>
          </div>
          <div class="field grow">
            <label>日期</label>
            <input v-model="manualDate" type="date" />
          </div>
        </div>
        <div class="knowledge-choice">
          <label class="checkbox"><input v-model="manualToKnowledge" type="checkbox" />同时加入知识库</label>
          <div v-if="manualToKnowledge" class="row knowledge-fields">
            <select v-if="!manualNewFolder" v-model.number="manualFolderId" class="grow">
              <option :value="0" disabled>选择文件夹</option>
              <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
            <input v-else v-model="manualNewFolderName" class="grow" placeholder="新文件夹名称" />
            <button class="secondary small" type="button" @click="manualNewFolder = !manualNewFolder">
              {{ manualNewFolder ? '选择已有' : '新建文件夹' }}
            </button>
            <input v-model="manualKnowledgeReason" class="grow" placeholder="收录原因（可选）" />
          </div>
        </div>
      </template>

      <div class="row">
        <button class="primary" :disabled="!manualReady || manualSaving" @click="saveManual">
          {{ manualSaving ? '保存中…' : '保存（不经过 AI）' }}
        </button>
        <span v-if="manualMsg" :class="manualOk ? 'msg ok inline' : 'msg err inline'">{{ manualMsg }}</span>
      </div>
    </div>

    <!-- ========== AI 快速记录 ========== -->
    <div v-else class="capture">
      <div class="chat-tools">
        <span class="hint">本次对话会保存在本机，AI 会结合最近上下文理解你的记录。</span>
        <button class="ghost small" type="button" @click="clearConversation">清空并新建</button>
      </div>
      <div class="messages" ref="listEl">
        <div v-if="!store.messages.length" class="empty">
          <h3>今天怎么样？</h3>
          <p>
            随手倒进来：睡眠、琐事、对话、喜欢的句子、突然的想法……<br />
            AI 会帮你拆解归档，你确认后才会入库。
          </p>
          <p class="eg">
            例如：「睡了6.5小时，被导师骂了一顿，看到一句话：纸上得来终觉浅，突然想到RAG评估好像有新方法」
          </p>
        </div>

        <div v-for="(m, i) in store.messages" :key="i" class="chat-msg" :class="m.role">
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
                <div v-for="(p, j) in m.parsed" :key="`kb-${j}`" class="ai-kb-choice">
                  <label v-if="p.kind !== 'sleep'" class="checkbox">
                    <input v-model="p.addToKnowledge" type="checkbox" />加入知识库
                  </label>
                  <select v-if="p.kind !== 'sleep' && p.addToKnowledge" v-model.number="p.folderId">
                    <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
                  </select>
                </div>
                <button class="primary" :disabled="!m.parsed?.length" @click="archiveMessage(m)">
                  <Icon name="check" :size="15" />确认归档（{{ m.parsed?.length }} 条）
                </button>
              </template>
              <div v-if="m.profileDraft && Object.keys(m.profileDraft).length" class="profile-draft">
                <strong>AI 识别到一些个人资料</strong>
                <p class="hint">确认后只补充“我的”页面中的空字段，不会覆盖手动填写内容。</p>
                <label v-for="(value, key) in m.profileDraft" :key="key" class="draft-field">
                  <input type="checkbox" :checked="draftSelected(m.id, key)" @change="toggleDraft(m.id, key)" />
                  <span><b>{{ profileLabel(key) }}：</b>{{ value }}</span>
                </label>
                <button class="secondary small" @click="confirmProfile(m)">{{ hasSelectedDraft(m) ? '确认所选资料' : '不采用资料草稿' }}</button>
              </div>
            </template>
          </div>
        </div>

        <div v-if="store.busy" class="chat-msg assistant">
          <div class="bubble typing">
            <span class="dots"><i /><i /><i /></span>AI 正在解析…
          </div>
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
        <button class="primary" :disabled="store.busy" @click="submit">
          <Icon name="send" :size="15" />{{ store.busy ? '解析中…' : '发送' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, reactive } from 'vue'
import { useCaptureStore, ChatMessageItem } from '../stores/capture'
import EntryCard from '../components/EntryCard.vue'
import Icon from '../components/Icon.vue'
import { EntryKind } from '../../electron/types'
import { KIND_PLAIN, kindClass } from '../utils/kinds'

const store = useCaptureStore()
const listEl = ref<HTMLElement>()

const mode = ref<'manual' | 'ai'>('manual')
interface Folder { id: number; name: string; system_key?: string | null }
const folders = ref<Folder[]>([])

// ---------- 手动录入 ----------
const manualKind = ref<EntryKind>('event')
function setKind(k: string): void {
  manualKind.value = k as EntryKind
}
const manualText = ref('')
const manualHours = ref<number | null>(null)
const manualFrom = ref('')
const manualNegative = ref(false)
const manualDate = ref(new Date().toISOString().slice(0, 10))
const manualSaving = ref(false)
const manualMsg = ref('')
const manualOk = ref(false)
const manualToKnowledge = ref(false)
const manualFolderId = ref(0)
const manualNewFolder = ref(false)
const manualNewFolderName = ref('')
const manualKnowledgeReason = ref('')

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
    const knowledge = manualToKnowledge.value ? {
      addToKnowledge: true,
      folderId: manualNewFolder.value ? undefined : manualFolderId.value,
      newFolderName: manualNewFolder.value ? manualNewFolderName.value : undefined,
      reason: manualKnowledgeReason.value
    } : undefined
    const r = await window.api.entries.manual(manualKind.value, content, rawText, manualDate.value || undefined, knowledge)
    if (r.ok) {
      manualOk.value = true
      manualMsg.value = manualToKnowledge.value ? '已保存到时间线和知识库' : '已保存到时间线'
      manualText.value = ''
      manualHours.value = null
      manualFrom.value = ''
      manualNegative.value = false
      manualToKnowledge.value = false
      manualNewFolderName.value = ''
      manualKnowledgeReason.value = ''
      await loadFolders()
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
async function submit(): Promise<void> {
  await store.send(store.input)
  await loadFolders()
}

async function archiveMessage(m: ChatMessageItem): Promise<void> {
  if (m.parsed) await store.commit(m, m.parsed)
}

async function loadFolders(): Promise<void> {
  folders.value = await window.api.kb.listFolders()
  const aiFolder = folders.value.find(f => f.system_key === 'ai_quick_capture')
  if (aiFolder) {
    store.defaultFolderId = aiFolder.id
    if (!manualFolderId.value) manualFolderId.value = aiFolder.id
    for (const m of store.messages) for (const p of m.parsed ?? []) if (p.kind !== 'sleep' && !p.folderId) p.folderId = aiFolder.id
  }
}

async function clearConversation(): Promise<void> {
  if (!window.confirm('确定清空当前 AI 快速记录对话并新建吗？已经归档的记录和知识资料不会删除。')) return
  await store.clear()
}

const PROFILE_LABELS: Record<string, string> = { name: '名称', preferredName: '称呼', identity: '职业/身份', location: '所在地', bio: '个人简介', goals: '关注目标', interests: '兴趣' }
function profileLabel(key: string): string { return PROFILE_LABELS[key] ?? key }
const draftSelections = reactive<Record<number, Record<string, boolean>>>({})
function draftSelected(messageId: number, key: string): boolean { return draftSelections[messageId]?.[key] !== false }
function toggleDraft(messageId: number, key: string): void {
  const selections = draftSelections[messageId] ?? (draftSelections[messageId] = {})
  selections[key] = !draftSelected(messageId, key)
}
function hasSelectedDraft(m: ChatMessageItem): boolean {
  return Object.keys(m.profileDraft ?? {}).some(key => draftSelected(m.id, key))
}
async function confirmProfile(m: ChatMessageItem): Promise<void> {
  if (!m.profileDraft) return
  const selected = Object.fromEntries(Object.entries(m.profileDraft).filter(([key]) => draftSelected(m.id, key)))
  const result = await window.api.profile.confirmDraft(m.id, selected)
  if (result.ok) m.profileDraft = undefined
  else m.error = result.error
}

watch(
  () => store.messages.length,
  async () => {
    await nextTick()
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' })
  }
)

onMounted(async () => {
  const s = localStorage.getItem('mt-capture-mode')
  if (s === 'ai' || s === 'manual') mode.value = s
  await store.load()
  await loadFolders()
})
watch(mode, v => localStorage.setItem('mt-capture-mode', v))
</script>

<style scoped>
.capture-page {
  display: flex; flex-direction: column;
  height: calc(100vh - 74px);
}

.mode-switch { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.mode-hint { font-size: 12px; color: var(--text-3); }

/* 手动录入 */
.manual { max-width: 720px; margin-bottom: 0; }
.kinds { display: flex; gap: 8px; flex-wrap: wrap; }
.chip.kind.on {
  background: var(--kc-weak); border-color: var(--kc); color: var(--kc);
}
.grow { flex: 1; min-width: 140px; }
.manual .msg { margin: 0; }
.knowledge-choice { margin: 12px 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r); background: var(--surface-2); }
.knowledge-fields { margin-top: 9px; }

/* AI 聊天 */
.capture { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.chat-tools { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 6px; }
.messages { flex: 1; overflow-y: auto; padding: 4px 4px 8px; }
.empty { margin-top: 8vh; }
.empty h3 { font-family: var(--font-serif); font-size: 19px; color: var(--text); }
.empty .eg {
  font-size: 12px; color: var(--text-3); max-width: 560px;
  margin: 14px auto 0; padding: 10px 14px;
  background: var(--surface); border: 1px dashed var(--border-strong); border-radius: var(--r-md);
}
.chat-msg { display: flex; margin: 10px 0; }
.chat-msg.user { justify-content: flex-end; }
.bubble {
  max-width: 640px; padding: 11px 15px; border-radius: var(--r-lg);
  font-size: 14px; background: var(--surface);
  border: 1px solid var(--border); box-shadow: var(--shadow);
}
.chat-msg.user .bubble {
  background: var(--accent); color: var(--on-accent); border-color: transparent;
}
.chat-msg.assistant .bubble { min-width: 320px; }
.bubble .primary { margin-top: 8px; }
.err { color: var(--danger); font-size: 13px; }
.ai-kb-choice { display: flex; align-items: center; gap: 8px; margin: 4px 0 8px; font-size: 12px; }
.ai-kb-choice select { width: auto; min-width: 160px; padding: 5px 8px; }
.profile-draft { margin: 10px 0; padding: 10px 12px; background: var(--accent-weak); border-radius: var(--r); font-size: 12.5px; }
.draft-field { display: flex; align-items: flex-start; gap: 7px; margin: 7px 0; }
.draft-field input { width: auto; margin-top: 2px; }
.profile-draft .small { margin-top: 8px; }

.typing { color: var(--text-3); display: flex; align-items: center; gap: 8px; }
.dots { display: inline-flex; gap: 3px; }
.dots i {
  width: 5px; height: 5px; border-radius: 50%; background: var(--text-3);
  animation: blink 1.2s infinite ease-in-out;
}
.dots i:nth-child(2) { animation-delay: 0.15s; }
.dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes blink { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }

.composer { display: flex; gap: 10px; padding: 12px 4px 0; align-items: flex-end; }
.composer textarea { flex: 1; resize: none; border-radius: var(--r-md); }
.composer button { padding: 10px 22px; border-radius: var(--r-md); }
</style>
