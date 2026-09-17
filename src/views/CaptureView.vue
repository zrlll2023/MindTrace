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

      <div v-if="manualKind === 'sleep'" class="sleep-editor">
        <div class="seg-group sleep-mode">
          <button :class="sleepInputMode === 'session' ? 'seg on' : 'seg'" type="button" @click="sleepInputMode = 'session'">记录睡眠时段</button>
          <button :class="sleepInputMode === 'daily_total' ? 'seg on' : 'seg'" type="button" @click="sleepInputMode = 'daily_total'">填写当天总睡眠</button>
        </div>
        <div v-if="sleepInputMode === 'session'" class="row">
          <div class="field grow">
            <label>睡眠时间段</label>
            <TimeRangePicker v-model="manualSleepRange" />
          </div>
          <div v-if="sleepHours != null" class="field grow sleep-hours-hint">
            <label>换算时长</label>
            <div class="sleep-hours">{{ sleepHours }} 小时</div>
          </div>
        </div>
        <div v-else class="row">
          <div class="field grow">
            <label>日期</label>
            <DatePicker v-model="manualTotalDate" open-above />
          </div>
          <div class="field grow">
            <label>当天累计睡眠（小时）</label>
            <input v-model.number="manualTotalHours" type="number" min="0.1" max="24" step="0.1" />
          </div>
          <p class="hint sleep-total-note">仅记录当天总时长，AI 无法判断睡眠是否连续。</p>
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
            <DatePicker v-model="manualDate" open-above />
          </div>
        </div>
        <div class="knowledge-choice">
          <label class="checkbox"><input v-model="manualToKnowledge" type="checkbox" />同时加入知识库</label>
          <div v-if="manualToKnowledge" class="row knowledge-fields">
            <select v-if="!manualNewFolder" v-model.number="manualFolderId" class="grow">
              <option :value="0" disabled>选择文件夹</option>
              <option v-for="f in manualFolders" :key="f.id" :value="f.id">{{ f.name }}</option>
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
        <div class="chat-tool-actions">
          <span v-if="clearMessage" class="msg err inline">{{ clearMessage }}</span>
          <button class="ghost small" type="button" :disabled="clearing || store.busy || !!store.committingIds.length || !!store.undoingIds.length" @click="openClearDialog">
            {{ clearing ? '正在清空…' : '清空并新建' }}
          </button>
        </div>
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

        <div v-for="m in store.messages" :key="m.id" class="chat-msg" :class="m.role">
          <div class="bubble">
            <template v-if="m.role === 'user'">{{ m.text }}</template>
            <template v-else>
              <p v-if="m.error" class="err">⚠️ {{ m.error }}</p>
              <p v-if="m.text">{{ m.text }}</p>
              <template v-if="m.parsed">
                <div v-for="(p, j) in m.parsed" :key="j" class="capture-entry-wrap">
                  <EntryCard :entry="p" :locked="!!m.committed" @remove="m.parsed!.splice(j, 1)" />
                  <div v-if="p.kind !== 'sleep'" class="ai-kb-choice">
                    <label class="checkbox">
                      <input v-model="p.addToKnowledge" type="checkbox" :disabled="m.committed" />同时加入知识库
                    </label>
                    <select v-if="p.addToKnowledge" v-model.number="p.folderId" :disabled="m.committed">
                      <option :value="undefined">AI 快速记录（默认）</option>
                      <option v-for="f in manualFolders" :key="f.id" :value="f.id">{{ f.name }}</option>
                    </select>
                  </div>
                </div>
                <div class="archive-actions">
                  <button v-if="!m.committed" class="primary" :disabled="!canArchive(m) || store.isCommitting(m.id)" @click="archiveMessage(m)">
                    <Icon name="check" :size="15" />{{ store.isCommitting(m.id) ? '保存中…' : `保存到时间线（${m.parsed?.length} 条）` }}
                  </button>
                  <button v-else class="primary archived" type="button" disabled><Icon name="check" :size="15" />已保存</button>
                  <button v-if="m.committed" class="ghost" type="button" :disabled="store.isUndoing(m.id)" @click="undoArchive(m)">
                    {{ store.isUndoing(m.id) ? '撤回中…' : '撤回' }}
                  </button>
                </div>
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
            <time v-if="formatMessageTime(m.createdAt)" class="message-time">{{ formatMessageTime(m.createdAt) }}</time>
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
          ref="composerEl"
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

    <div v-if="clearDialogOpen" class="drawer-mask" @click.self="closeClearDialog">
      <section class="clear-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-dialog-title" aria-describedby="clear-dialog-description" @keydown.esc="closeClearDialog">
        <div class="clear-dialog-icon"><Icon name="trash" :size="20" /></div>
        <div class="clear-dialog-copy">
          <h3 id="clear-dialog-title">清空当前对话？</h3>
          <p id="clear-dialog-description">当前 AI 快速记录对话会被清空，已经保存到时间线和知识库的内容不会删除。</p>
        </div>
        <div class="clear-dialog-actions">
          <button ref="cancelClearButton" class="ghost" type="button" :disabled="clearing" @click="closeClearDialog">取消</button>
          <button class="danger" type="button" :disabled="clearing" @click="confirmClearConversation">
            {{ clearing ? '正在清空…' : '清空并新建' }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="archiveToast" class="capture-toast" role="status">
      <Icon name="check" :size="16" />{{ archiveToast }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount, reactive } from 'vue'
import { useRoute } from 'vue-router'
import { useCaptureStore, ChatMessageItem, isCaptureEntryValid } from '../stores/capture'
import EntryCard from '../components/EntryCard.vue'
import Icon from '../components/Icon.vue'
import DatePicker from '../components/DatePicker.vue'
import TimeRangePicker, { TimeRangeValue } from '../components/TimeRangePicker.vue'
import { EntryKind } from '../../electron/types'
import { KIND_PLAIN, kindClass } from '../utils/kinds'
import { localDateString } from '../utils/datetime'

const store = useCaptureStore()
const route = useRoute()
const listEl = ref<HTMLElement>()
const composerEl = ref<HTMLTextAreaElement>()
const cancelClearButton = ref<HTMLButtonElement>()
const clearing = ref(false)
const clearMessage = ref('')
const clearDialogOpen = ref(false)
const archiveToast = ref('')
let archiveToastTimer: ReturnType<typeof setTimeout> | undefined

const mode = ref<'manual' | 'ai'>('manual')
interface Folder { id: number; name: string; system_key?: string | null }
const folders = ref<Folder[]>([])
const manualFolders = computed(() => folders.value.filter(folder => folder.system_key !== 'ai_quick_capture'))

// ---------- 手动录入 ----------
const manualKind = ref<EntryKind>('event')
function setKind(k: string): void {
  manualKind.value = k as EntryKind
}
const manualText = ref('')
const sleepInputMode = ref<'session' | 'daily_total'>('session')
/** 睡眠时间段（起止精确到分钟）；null = 未选择 */
const manualSleepRange = ref<TimeRangeValue | null>(null)
const manualTotalDate = ref(localDateString())
const manualTotalHours = ref<number | null>(null)
const manualFrom = ref('')
const manualNegative = ref(false)
const manualDate = ref(localDateString())
const manualSaving = ref(false)
const manualMsg = ref('')
const manualOk = ref(false)
const manualToKnowledge = ref(false)
const manualFolderId = ref(0)
const manualNewFolder = ref(false)
const manualNewFolderName = ref('')
const manualKnowledgeReason = ref('')

/** 由时间段换算睡眠时长（小时，保留 1 位小数）；无效/未选返回 null */
const sleepHours = computed<number | null>(() => {
  const r = manualSleepRange.value
  if (!r?.start || !r.end) return null
  const start = new Date(r.start.replace(' ', 'T'))
  const end = new Date(r.end.replace(' ', 'T'))
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  let diff = (end.getTime() - start.getTime()) / 3_600_000
  if (diff <= 0 || diff > 24) return null
  return Math.round(diff * 10) / 10
})

/** 睡眠记录的原文描述，如「9月15日 23:00 至 9月16日 07:00，共 8.0 小时」 */
const sleepRawText = computed(() => {
  const r = manualSleepRange.value
  if (!r?.start || !r.end) return ''
  const hhmm = (s: string): string => s.slice(11, 16)
  const day = (s: string): string => {
    const [, m, d] = s.slice(0, 10).split('-')
    return `${Number(m)}月${Number(d)}日`
  }
  const sameDay = r.start.slice(0, 10) === r.end.slice(0, 10)
  const hours = sleepHours.value
  const span = sameDay
    ? `${day(r.start)} ${hhmm(r.start)} 至 ${hhmm(r.end)}`
    : `${day(r.start)} ${hhmm(r.start)} 至 ${day(r.end)} ${hhmm(r.end)}`
  return hours != null ? `${span}，共 ${hours.toFixed(1)} 小时` : span
})

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
  if (manualKind.value === 'sleep') {
    return sleepInputMode.value === 'session'
      ? sleepHours.value != null
      : !!manualTotalDate.value && manualTotalHours.value != null && manualTotalHours.value > 0 && manualTotalHours.value <= 24
  }
  return manualText.value.trim().length > 0
})

async function saveManual(): Promise<void> {
  manualSaving.value = true
  manualMsg.value = ''
  try {
    const content =
      manualKind.value === 'sleep'
        ? sleepInputMode.value === 'session'
          ? { recordType: 'session', startAt: manualSleepRange.value?.start, endAt: manualSleepRange.value?.end, hours: sleepHours.value }
          : { recordType: 'daily_total', date: manualTotalDate.value, hours: manualTotalHours.value }
        : manualKind.value === 'quote'
          ? { text: manualText.value.trim(), ...(manualFrom.value.trim() ? { from: manualFrom.value.trim() } : {}) }
          : manualKind.value === 'event'
            ? { text: manualText.value.trim(), negative: manualNegative.value }
            : { text: manualText.value.trim() }
    const rawText = manualKind.value === 'sleep'
      ? sleepInputMode.value === 'session'
        ? sleepRawText.value
        : `${manualTotalDate.value} 当天累计睡眠 ${Number(manualTotalHours.value).toFixed(1)} 小时`
      : manualText.value.trim()
    const knowledge = manualToKnowledge.value ? {
      addToKnowledge: true,
      folderId: manualNewFolder.value ? undefined : manualFolderId.value,
      newFolderName: manualNewFolder.value ? manualNewFolderName.value : undefined,
      reason: manualKnowledgeReason.value
    } : undefined
    const r = await window.api.entries.manual(
      manualKind.value,
      content,
      rawText,
      (manualKind.value === 'sleep'
        ? sleepInputMode.value === 'session' ? manualSleepRange.value?.end.slice(0, 10) : manualTotalDate.value
        : manualDate.value) || undefined,
      knowledge
    )
    if (r.ok) {
      manualOk.value = true
      manualMsg.value = manualToKnowledge.value ? '已保存到时间线和知识库' : '已保存到时间线'
      manualText.value = ''
      manualSleepRange.value = null
      manualTotalHours.value = null
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
  if (!m.parsed) return
  const entries = [...m.parsed]
  if (await store.commit(m, entries)) {
    const knowledgeCount = entries.filter(entry => entry.kind !== 'sleep' && entry.addToKnowledge).length
    showArchiveToast(`已添加 ${entries.length} 条到时间线${knowledgeCount ? `，${knowledgeCount} 条加入知识库` : ''}`)
    await loadFolders()
  }
}

async function undoArchive(m: ChatMessageItem): Promise<void> {
  if (await store.undo(m)) {
    showArchiveToast('已撤回本次添加')
    await loadFolders()
  }
}

function showArchiveToast(message: string): void {
  archiveToast.value = message
  if (archiveToastTimer) clearTimeout(archiveToastTimer)
  archiveToastTimer = setTimeout(() => { archiveToast.value = '' }, 2600)
}

function canArchive(m: ChatMessageItem): boolean {
  return !!m.parsed?.length && m.parsed.every(isCaptureEntryValid)
}

async function loadFolders(): Promise<void> {
  folders.value = await window.api.kb.listFolders()
  if (!manualFolders.value.some(folder => folder.id === manualFolderId.value)) {
    manualFolderId.value = manualFolders.value[0]?.id ?? 0
  }
}

async function openClearDialog(): Promise<void> {
  clearMessage.value = ''
  clearDialogOpen.value = true
  await nextTick()
  cancelClearButton.value?.focus()
}

function closeClearDialog(): void {
  if (clearing.value) return
  clearDialogOpen.value = false
}

async function confirmClearConversation(): Promise<void> {
  clearing.value = true
  clearMessage.value = ''
  try {
    const cleared = await store.clear()
    if (!cleared) {
      clearMessage.value = store.busy || store.committingIds.length ? '请等待当前操作完成后再清空' : '清空失败，请重试'
      return
    }
    clearDialogOpen.value = false
    await nextTick()
    composerEl.value?.focus()
  } catch (error) {
    clearMessage.value = error instanceof Error ? error.message : '清空失败，请重试'
  } finally {
    clearing.value = false
  }
}

function formatMessageTime(value?: string): string {
  if (!value) return ''
  const normalized = value.trim().replace('T', ' ')
  return normalized.length >= 16 ? normalized.slice(0, 16) : normalized
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

async function scrollToLatest(behavior: ScrollBehavior = 'auto'): Promise<void> {
  await nextTick()
  const list = listEl.value
  if (!list) return
  list.scrollTo({ top: list.scrollHeight, behavior })
}

watch(
  () => store.messages.length,
  () => scrollToLatest('smooth')
)

onMounted(async () => {
  const s = localStorage.getItem('mt-capture-mode')
  if (s === 'ai' || s === 'manual') mode.value = s
  if (route.query.kind === 'sleep') {
    mode.value = 'manual'
    manualKind.value = 'sleep'
  }
  await store.load()
  await loadFolders()
  if (mode.value === 'ai') await scrollToLatest()
})
onBeforeUnmount(() => {
  if (archiveToastTimer) clearTimeout(archiveToastTimer)
})
watch(mode, v => {
  localStorage.setItem('mt-capture-mode', v)
  if (v === 'ai') void scrollToLatest()
})
</script>

<style scoped>
.capture-page {
  display: flex; flex-direction: column;
  height: 100%;
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
.sleep-hours-hint { flex: 0 0 auto; min-width: 120px; }
.sleep-editor { display: grid; gap: 12px; }
.sleep-mode { width: fit-content; }
.sleep-total-note { flex: 1 1 100%; margin: -2px 0 0; }
.sleep-hours {
  padding: 8px 11px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r);
  font-size: 13.5px;
  color: var(--text-2);
  background: var(--surface-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.manual .msg { margin: 0; }
.knowledge-choice { margin: 12px 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r); background: var(--surface-2); }
.knowledge-fields { margin-top: 9px; }

/* AI 聊天 */
.capture { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.chat-tools { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 6px; }
.chat-tool-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
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
.archive-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.archive-actions .primary { margin-top: 0; }
.archive-actions .archived { opacity: 0.58; cursor: not-allowed; }
.message-time {
  display: block; margin-top: 7px; color: var(--text-3); font-size: 11px;
  font-variant-numeric: tabular-nums; text-align: right;
}
.chat-msg.user .message-time { color: color-mix(in srgb, var(--on-accent) 72%, transparent); }
.err { color: var(--danger); font-size: 13px; }
.capture-entry-wrap { margin: 7px 0; }
.capture-entry-wrap :deep(.entry-card) { margin-bottom: 0; }
.ai-kb-choice { display: flex; align-items: center; gap: 8px; margin: 0; padding: 7px 12px; border: 1px solid var(--border); border-top: 0; border-radius: 0 0 var(--r-md) var(--r-md); background: var(--surface-2); font-size: 12px; }
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

.composer {
  display: flex; gap: 10px; padding: 10px; align-items: flex-end;
  border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface);
  box-shadow: var(--shadow);
}
.composer textarea { flex: 1; min-height: 72px; resize: none; border-radius: var(--r-md); background: var(--surface-2); }
.composer textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-weak); }
.composer button { padding: 10px 22px; border-radius: var(--r-md); }

.clear-dialog {
  display: grid; grid-template-columns: auto 1fr; gap: 12px 14px;
  width: min(420px, calc(100vw - 32px)); padding: 20px;
  border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--surface); box-shadow: var(--shadow-lg);
}
.clear-dialog-icon {
  display: grid; place-items: center; width: 38px; height: 38px;
  border-radius: var(--r); color: var(--danger); background: var(--danger-weak);
}
.clear-dialog-copy h3 { margin: 1px 0 7px; font-size: 16px; }
.clear-dialog-copy p { margin: 0; color: var(--text-2); font-size: 13px; line-height: 1.65; }
.clear-dialog-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.capture-toast {
  position: fixed; z-index: 70; top: 68px; right: 22px;
  display: flex; align-items: center; gap: 8px; max-width: min(420px, calc(100vw - 32px));
  padding: 10px 14px; border: 1px solid color-mix(in srgb, var(--ok) 35%, var(--border));
  border-radius: var(--r); color: var(--ok); background: var(--surface);
  box-shadow: var(--shadow-lg); font-size: 13px;
  animation: toast-in 0.18s var(--ease);
}
@keyframes toast-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }

@media (max-width: 640px) {
  .chat-tools { align-items: flex-start; flex-direction: column; }
  .chat-tool-actions { width: 100%; justify-content: space-between; }
  .composer { align-items: stretch; flex-direction: column; }
  .composer button { align-self: flex-end; }
}
</style>
