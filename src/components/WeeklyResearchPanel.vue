<template>
  <section class="card research-panel">
    <div class="section-head">
      <div>
        <h3>引导式周度研究</h3>
        <p class="hint">先写下你的研究需求，AI 只按需求出搜索词；搜什么、收录什么仍由你决定。</p>
      </div>
      <span v-if="hasContent" class="save-state" :class="{ error: saveState === '保存失败' }">{{ saveState }}</span>
    </div>

    <!-- 技能区域边界：只有「周度研究」区域的技能会随出题请求一起发出 -->
    <SkillScopeBar scope="research.plan" />

    <div class="field requirement-field">
      <label>本周研究需求</label>
      <textarea
        v-model="requirement"
        rows="3"
        placeholder="例：想弄清「睡眠不足是否真的拖慢我的写作产出」，只要可验证的证据，不要泛泛的睡眠建议"
      />
      <p class="hint requirement-hint">写得越具体，AI 越不会理解错你的意图。留空时 AI 只能按兴趣线猜测方向。</p>
    </div>

    <div class="row plan-actions">
      <button class="primary" :disabled="planning || loading" @click="requestPlan">
        <Icon name="sparkles" :size="15" />{{ planning ? 'AI 思考中…' : queries.length ? '重新生成计划' : '生成本周研究计划' }}
      </button>
      <button v-if="queries.length && !confirmClear" class="ghost" :disabled="planning" @click="confirmClear = true">清空本周计划</button>
      <span v-if="queries.length" class="tag" :class="planRequirement ? 'ok' : ''">
        {{ planRequirement ? '已按研究需求生成' : '按兴趣线推断生成' }}
      </span>
    </div>

    <div v-if="requirementDirty" class="confirm-box notice-box">
      <span>研究需求已改动，重新生成计划才会按新需求出题。</span>
    </div>
    <div v-if="confirmBlind" class="confirm-box">
      <span>还没有填写研究需求，AI 只能按兴趣线推断，可能理解错你的意图。</span>
      <button class="ghost" @click="confirmBlind = false">先去写需求</button>
      <button class="primary" @click="generatePlan">仍然按兴趣线生成</button>
    </div>
    <div v-if="confirmRegenerate" class="confirm-box">
      <span>重新生成会替换当前搜索词和计划说明，但保留下方未保存的收获草稿。</span>
      <button class="primary" @click="generatePlan">确认重新生成</button><button class="ghost" @click="confirmRegenerate = false">取消</button>
    </div>
    <div v-if="confirmClear" class="confirm-box danger-box">
      <span>清空后将删除本周计划和未存入时间线的草稿。</span>
      <button class="danger" @click="clearPlan">确认清空</button><button class="ghost" @click="confirmClear = false">取消</button>
    </div>

    <p v-if="loading" class="empty-state">正在恢复本周计划…</p>
    <template v-else>
      <div v-if="researchNote" class="note">{{ researchNote }}</div>
      <div v-for="q in queries" :key="q" class="query-row">
        <span>{{ q }}</span>
        <button class="ghost small" @click="openSearch(q)"><Icon name="external" :size="14" />去搜索</button>
      </div>
      <p v-if="!queries.length && !researchNote" class="empty-state">本周还没有研究计划。</p>
      <template v-if="queries.length">
        <div class="field"><label>有价值的内容</label><textarea v-model="finding" rows="4" placeholder="粘贴句子或摘要，输入内容会自动暂存" /></div>
        <div class="field"><label>出处链接（可选）</label><input v-model="findingFrom" placeholder="https://" /></div>
        <div class="row">
          <button class="primary" :disabled="!finding.trim() || saving" @click="saveFinding">{{ saving ? '保存中…' : '存入时间线' }}</button>
          <span v-if="savedMsg" :class="savedOk ? 'msg ok inline' : 'msg err inline'">{{ savedMsg }}</span>
        </div>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../components/Icon.vue'
import SkillScopeBar from './SkillScopeBar.vue'

const requirement = ref('')
/** AI 实际据以出题的需求文本；与输入框不一致时说明计划已经过时 */
const planRequirement = ref('')
const queries = ref<string[]>([])
const researchNote = ref('')
const planning = ref(false)
const loading = ref(true)
const finding = ref('')
const findingFrom = ref('')
const saving = ref(false)
const savedMsg = ref('')
const savedOk = ref(true)
const saveState = ref('')
const generatedAt = ref('')
const confirmBlind = ref(false)
const confirmRegenerate = ref(false)
const confirmClear = ref(false)
let hydrated = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
/** 最近一次成功落盘的内容快照：用来区分「真的改了」与「只是把远端状态读回来」 */
let savedSnapshot = ''

const hasContent = computed(() => queries.value.length > 0 || !!requirement.value.trim())
const requirementDirty = computed(() => queries.value.length > 0 && requirement.value.trim() !== planRequirement.value)

function snapshot(): string {
  return JSON.stringify([requirement.value, queries.value, researchNote.value, finding.value, findingFrom.value, generatedAt.value])
}

onMounted(async () => {
  try {
    const result = await window.api.labs.getResearchDraft()
    if (result.ok && result.draft) {
      applyDraft(result.draft)
      setSavedState(result.draft.updatedAt)
    }
  } catch (error) {
    savedOk.value = false
    savedMsg.value = `恢复计划失败：${(error as Error).message}`
  } finally {
    // 先记下已落盘快照再放开自动保存，恢复草稿本身不会被当成一次修改
    savedSnapshot = snapshot()
    hydrated = true
    loading.value = false
  }
})

watch([requirement, finding, findingFrom], () => {
  if (!hydrated) return
  if (snapshot() === savedSnapshot) {
    // 内容与已落盘一致（含刚恢复或刚生成）：只撤掉待保存状态，保留「已保存于 …」提示
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = undefined
    if (saveState.value === '等待保存…') saveState.value = ''
    return
  }
  saveState.value = '等待保存…'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void saveDraft() }, 500)
})

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  if (hydrated && saveState.value === '等待保存…') void saveDraft()
})

function requestPlan(): void {
  // 缺需求时先拦一次：这是「AI 理解错意图」最常见的原因
  if (!requirement.value.trim()) {
    confirmBlind.value = true
    return
  }
  if (queries.value.length) confirmRegenerate.value = true
  else void generatePlan()
}

async function generatePlan(): Promise<void> {
  confirmBlind.value = false
  confirmRegenerate.value = false
  planning.value = true
  savedMsg.value = ''
  try {
    const result = await window.api.labs.planResearch(requirement.value.trim())
    if (result.ok) {
      applyDraft(result)
      planRequirement.value = requirement.value.trim()
      savedSnapshot = snapshot()
      setSavedState(result.updatedAt)
    } else {
      savedOk.value = false
      savedMsg.value = result.error ?? '生成失败'
    }
  } finally {
    planning.value = false
  }
}

async function saveDraft(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = undefined
  saveState.value = '保存中…'
  const sent = snapshot()
  const result = await window.api.labs.saveResearchDraft({
    requirement: requirement.value,
    queries: queries.value,
    note: researchNote.value,
    finding: finding.value,
    findingFrom: findingFrom.value,
    generatedAt: generatedAt.value
  })
  if (result.ok) {
    savedSnapshot = sent
    setSavedState(result.draft.updatedAt)
  } else {
    saveState.value = '保存失败'
  }
}

async function clearPlan(): Promise<void> {
  await window.api.labs.clearResearchDraft()
  requirement.value = ''
  planRequirement.value = ''
  queries.value = []
  researchNote.value = ''
  finding.value = ''
  findingFrom.value = ''
  generatedAt.value = ''
  saveState.value = ''
  confirmClear.value = false
  savedMsg.value = ''
  savedSnapshot = snapshot()
}

function openSearch(query: string): void {
  // 应用自身不跳转：正文里的链接一律交给系统浏览器
  void window.api.external.openUrl(`https://www.bing.com/search?q=${encodeURIComponent(query)}`)
}

async function saveFinding(): Promise<void> {
  saving.value = true
  savedMsg.value = ''
  try {
    const result = await window.api.labs.saveFinding(finding.value.trim(), findingFrom.value.trim())
    if (result.ok) {
      finding.value = ''
      findingFrom.value = ''
      await saveDraft()
      savedOk.value = true
      savedMsg.value = '已存入时间线'
    } else {
      savedOk.value = false
      savedMsg.value = result.error ?? '保存失败'
    }
  } finally {
    saving.value = false
    setTimeout(() => (savedMsg.value = ''), 4000)
  }
}

function applyDraft(draft: {
  requirement?: string
  queries: string[]
  note: string
  finding: string
  findingFrom: string
  generatedAt: string
}): void {
  requirement.value = draft.requirement ?? ''
  planRequirement.value = draft.requirement ?? ''
  queries.value = [...draft.queries]
  researchNote.value = draft.note
  finding.value = draft.finding
  findingFrom.value = draft.findingFrom
  generatedAt.value = draft.generatedAt
}

function setSavedState(updatedAt: string): void {
  const time = new Date(updatedAt)
  saveState.value = Number.isNaN(time.getTime()) ? '已保存' : `已保存于 ${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}
</script>

<style scoped>
.research-panel { margin-bottom: 0; }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.save-state { flex: 0 0 auto; color: var(--ok); font-size: 12px; }
.save-state.error { color: var(--danger); }
.requirement-field { margin-top: 14px; }
.requirement-hint { margin: 6px 0 0; }
.plan-actions { margin-top: 6px; }
.plan-actions .tag { margin-left: 2px; }
.note { margin: 14px 0 8px; padding: 11px 12px; background: var(--surface-2); border-radius: var(--r); white-space: pre-wrap; }
.query-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.query-row span { min-width: 0; overflow-wrap: anywhere; }
.query-row button { flex: 0 0 auto; }
.field { margin-top: 14px; }
.empty-state { margin: 16px 0 4px; color: var(--text-3); }
.confirm-box { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 10px; border: 1px solid var(--border); border-radius: var(--r); background: var(--surface-2); }
.confirm-box span { flex: 1; color: var(--text-2); }
.notice-box { border-style: dashed; }
.danger-box { border-color: var(--danger); background: var(--danger-weak); }

@media (max-width: 720px) {
  .section-head, .confirm-box { align-items: stretch; flex-direction: column; }
  .save-state { align-self: flex-start; }
  .query-row { flex-direction: column; align-items: flex-start; gap: 6px; }
  .query-row button { align-self: flex-end; }
  .confirm-box { flex-wrap: wrap; }
  .confirm-box button { flex: 1 1 auto; }
}
</style>
