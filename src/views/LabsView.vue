<template>
  <div class="page labs">
    <div class="page-head"><h1 class="page-title">实验室</h1><p class="page-sub">探索仍在打磨中的 AI 能力</p></div>
    <div class="badge-row"><span class="tag warn">实验功能</span><span class="hint">输出仅供参考。</span></div>
    <section class="card">
      <div class="section-head">
        <div><h3>引导式周度研究</h3><p class="hint">AI 根据你的兴趣线生成搜索词，你决定搜索与收录什么。</p></div>
        <span v-if="queries.length" class="save-state" :class="{ error: saveState === '保存失败' }">{{ saveState }}</span>
      </div>

      <div class="row plan-actions">
        <button class="primary" :disabled="planning || loading" @click="requestPlan">
          <Icon name="sparkles" :size="15" />{{ planning ? 'AI 思考中…' : queries.length ? '重新生成计划' : '生成本周研究计划' }}
        </button>
        <button v-if="queries.length && !confirmClear" class="ghost" :disabled="planning" @click="confirmClear = true">清空本周计划</button>
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
        <div v-for="q in queries" :key="q" class="query-row"><span>{{ q }}</span><a :href="searchUrl(q)" target="_blank" rel="noopener"><Icon name="external" :size="14" />去搜索</a></div>
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
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../components/Icon.vue'

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
const confirmRegenerate = ref(false)
const confirmClear = ref(false)
let hydrated = false
let saveTimer: ReturnType<typeof setTimeout> | undefined

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
    hydrated = true
    loading.value = false
  }
})

watch([finding, findingFrom], () => {
  if (!hydrated || !queries.value.length) return
  saveState.value = '等待保存…'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void saveDraft() }, 500)
})

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  if (hydrated && queries.value.length && saveState.value === '等待保存…') void saveDraft()
})

function requestPlan(): void {
  if (queries.value.length) confirmRegenerate.value = true
  else void generatePlan()
}

async function generatePlan(): Promise<void> {
  confirmRegenerate.value = false
  planning.value = true
  savedMsg.value = ''
  try {
    const result = await window.api.labs.planResearch()
    if (result.ok) {
      applyDraft(result)
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
  const result = await window.api.labs.saveResearchDraft({
    queries: queries.value,
    note: researchNote.value,
    finding: finding.value,
    findingFrom: findingFrom.value,
    generatedAt: generatedAt.value
  })
  if (result.ok) setSavedState(result.draft.updatedAt)
  else saveState.value = '保存失败'
}

async function clearPlan(): Promise<void> {
  await window.api.labs.clearResearchDraft()
  queries.value = []
  researchNote.value = ''
  finding.value = ''
  findingFrom.value = ''
  generatedAt.value = ''
  saveState.value = ''
  confirmClear.value = false
  savedMsg.value = ''
}

const searchUrl = (query: string) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`

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

function applyDraft(draft: { queries: string[]; note: string; finding: string; findingFrom: string; generatedAt: string }): void {
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
.labs { max-width: 860px; }
.badge-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.save-state { flex: 0 0 auto; color: var(--ok); font-size: 12px; }
.save-state.error { color: var(--danger); }
.plan-actions { margin-top: 12px; }
.note { margin: 14px 0 8px; padding: 11px 12px; background: var(--surface-2); border-radius: var(--r); white-space: pre-wrap; }
.query-row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.query-row span { min-width: 0; overflow-wrap: anywhere; }
.query-row a { display: inline-flex; flex: 0 0 auto; gap: 5px; align-items: center; }
.field { margin-top: 14px; }
.empty-state { margin: 16px 0 4px; color: var(--text-3); }
.confirm-box { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 10px; border: 1px solid var(--border); border-radius: var(--r); background: var(--surface-2); }
.confirm-box span { flex: 1; color: var(--text-2); }
.danger-box { border-color: var(--danger); background: var(--danger-weak); }
@media (max-width: 720px) {
  .section-head, .confirm-box { align-items: stretch; flex-direction: column; }
  .save-state { align-self: flex-start; }
}
</style>
