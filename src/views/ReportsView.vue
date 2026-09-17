<template>
  <div class="page reports-page">
    <div class="page-head">
      <h1 class="page-title">报告</h1>
      <p class="page-sub">AI 基于你的记录生成的日报与周报</p>
    </div>

    <div class="topbar">
      <div class="seg-group">
        <button :class="tab === 'daily' ? 'seg on' : 'seg'" @click="switchTab('daily')">日报</button>
        <button :class="tab === 'weekly' ? 'seg on' : 'seg'" @click="switchTab('weekly')">周报</button>
      </div>
      <div class="actions">
        <DatePicker v-model="genDate" />
        <button class="primary" :disabled="generating" @click="generate">
          <Icon name="sparkles" :size="15" />
          {{ generating ? '生成中…' : tab === 'daily' ? '生成该日日报' : '生成该周周报' }}
        </button>
      </div>
    </div>

    <div class="body">
      <aside class="archive">
        <div class="section-label">{{ tab === 'daily' ? '日报存档' : '周报存档' }}</div>
        <button
          v-for="r in archive"
          :key="r.id"
          class="arch-item"
          :class="{ on: current?.id === r.id }"
          @click="select(r)"
        >
          {{ r.period }}
        </button>
        <div v-if="!archive.length" class="arch-empty">还没有{{ tab === 'daily' ? '日报' : '周报' }}</div>
      </aside>

      <article class="viewer card">
        <div v-if="current" class="viewer-head">
          <h2>{{ tab === 'daily' ? '日报' : '周报' }} · {{ current.period }}</h2>
          <button class="secondary small" @click="exportCurrent">
            <Icon name="download" :size="14" />导出 Markdown
          </button>
        </div>
        <div v-if="current" class="prose md" v-html="rendered" />
        <div v-else class="empty">
          <h3>还没有选中的报告</h3>
          <p>选择左侧存档查看，或在上方选择一个日期生成。</p>
        </div>
      </article>
    </div>

    <transition name="toast">
      <p v-if="toast" class="toast">{{ toast }}</p>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import Icon from '../components/Icon.vue'
import DatePicker from '../components/DatePicker.vue'

interface ReportRow {
  id: number
  type: 'daily' | 'weekly'
  period: string
  content_md: string
  meta: string
  created_at: string
}

const tab = ref<'daily' | 'weekly'>('daily')
const archive = ref<ReportRow[]>([])
const current = ref<ReportRow | null>(null)
const generating = ref(false)
const toast = ref('')
const genDate = ref(new Date().toISOString().slice(0, 10))

const rendered = computed(() =>
  current.value ? DOMPurify.sanitize(marked.parse(current.value.content_md) as string) : ''
)

async function loadArchive(): Promise<void> {
  archive.value = await window.api.reports.list(tab.value)
  if (archive.value.length && !current.value) current.value = archive.value[0]
  if (!archive.value.some(r => r.id === current.value?.id)) {
    current.value = archive.value[0] ?? null
  }
}

function switchTab(t: 'daily' | 'weekly'): void {
  tab.value = t
  current.value = null
  void loadArchive()
}

function select(r: ReportRow): void {
  current.value = r
}

async function generate(): Promise<void> {
  generating.value = true
  try {
    const r =
      tab.value === 'daily'
        ? await window.api.reports.generate(genDate.value)
        : await window.api.reports.generateWeekly(genDate.value)
    if (r.ok) {
      await loadArchive()
      showToast('✅ 生成完成')
    } else {
      showToast(`❌ ${r.error}`)
    }
  } finally {
    generating.value = false
  }
}

async function exportCurrent(): Promise<void> {
  if (!current.value) return
  try {
    const r = await window.api.export.md({
      type: current.value.type,
      period: current.value.period,
      content_md: current.value.content_md,
      meta: current.value.meta
    })
    if (r.canceled) showToast('已取消导出')
    else if (r.error) showToast(`❌ ${r.error}`)
    else if (r.path) showToast(`✅ 已导出：${r.path}`)
  } catch (e) {
    showToast(`❌ 导出失败：${(e as Error).message}`)
  }
}

function showToast(msg: string): void {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 6000)
}

onMounted(() => void loadArchive())
</script>

<style scoped>
.reports-page {
  height: 100%; display: flex; flex-direction: column; overflow: hidden;
}
.page-head { flex: 0 0 auto; }
.topbar {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; flex: 0 0 auto; flex-wrap: wrap; margin-bottom: 16px;
}
.actions { display: flex; gap: 10px; align-items: center; }
.actions :deep(.dp--main) { width: 150px; }

.body { display: flex; gap: 18px; flex: 1; min-height: 0; align-items: stretch; overflow: hidden; }
.archive { width: 168px; flex: 0 0 168px; min-height: 0; overflow-y: auto; }
.arch-item {
  display: block; width: 100%; text-align: left;
  padding: 8px 12px; border-radius: var(--r); margin-bottom: 3px;
  font-size: 13px; color: var(--text-2);
  background: transparent; border: 1px solid transparent;
  font-variant-numeric: tabular-nums;
}
.arch-item:hover { background: var(--surface-2); color: var(--text); }
.arch-item.on {
  background: var(--accent-weak); color: var(--accent-text); font-weight: 600;
}
.arch-empty { font-size: 12.5px; color: var(--text-3); padding: 8px 12px; }

.viewer {
  flex: 1; min-width: 0; min-height: 0; margin-bottom: 0;
  display: flex; flex-direction: column; overflow: hidden;
}
.viewer-head {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; flex: 0 0 auto; margin-bottom: 14px;
  padding-bottom: 12px; border-bottom: 1px solid var(--border);
}
.viewer-head h2 {
  font-family: var(--font-sans); font-size: 16px; margin: 0;
}
.md { flex: 1; min-height: 0; overflow-y: auto; padding-right: 6px; }
.md :deep(h2:first-child) { margin-top: 0; }
.viewer > .empty { flex: 1; display: grid; place-content: center; }

.toast {
  position: fixed; bottom: 22px; right: 26px; margin: 0;
  background: var(--text); color: var(--bg);
  padding: 10px 16px; border-radius: var(--r); font-size: 13px;
  box-shadow: var(--shadow-lg); z-index: 80;
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s var(--ease), transform 0.2s var(--ease); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(6px); }

@media (max-width: 760px) {
  .body { flex-direction: column; }
  .archive { width: 100%; flex: none; display: flex; gap: 6px; overflow-x: auto; overflow-y: hidden; }
  .arch-item { width: auto; white-space: nowrap; margin-bottom: 0; }
}
</style>
