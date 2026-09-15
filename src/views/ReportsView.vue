<template>
  <div class="reports">
    <div class="topbar">
      <div class="tabs">
        <button :class="{ on: tab === 'daily' }" @click="switchTab('daily')">日报</button>
        <button :class="{ on: tab === 'weekly' }" @click="switchTab('weekly')">周报</button>
      </div>
      <div class="actions">
        <input v-model="genDate" type="date" />
        <button :disabled="generating" @click="generate">
          {{ generating ? '生成中…' : tab === 'daily' ? '生成该日日报' : '生成该周周报' }}
        </button>
      </div>
    </div>

    <div class="body">
      <aside class="archive">
        <div
          v-for="r in archive"
          :key="r.id"
          class="arch-item"
          :class="{ on: current?.id === r.id }"
          @click="select(r)"
        >
          {{ r.period }}
        </div>
        <div v-if="!archive.length" class="empty">还没有{{ tab === 'daily' ? '日报' : '周报' }}</div>
      </aside>

      <article class="viewer">
        <div v-if="current" class="viewer-head">
          <h2>{{ tab === 'daily' ? '日报' : '周报' }} · {{ current.period }}</h2>
          <button class="export" @click="exportCurrent">导出 Markdown</button>
        </div>
        <div v-if="current" class="md" v-html="rendered"></div>
        <div v-else class="empty big">选择左侧报告查看</div>
        <p v-if="toast" class="toast">{{ toast }}</p>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

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
  const r = await window.api.export.md({
    type: current.value.type,
    period: current.value.period,
    content_md: current.value.content_md,
    meta: current.value.meta
  })
  if (r.path) showToast(`✅ 已导出：${r.path}`)
}

function showToast(msg: string): void {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 6000)
}

onMounted(() => void loadArchive())
</script>

<style scoped>
.reports { display: flex; flex-direction: column; height: calc(100vh - 48px); }
.topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.tabs button {
  padding: 7px 20px; border: none; background: transparent; font-size: 14px; cursor: pointer;
  border-bottom: 2px solid transparent; color: #666;
}
.tabs button.on { color: #4f7cff; border-bottom-color: #4f7cff; font-weight: 600; }
.actions { display: flex; gap: 8px; align-items: center; }
.actions input { border: 1px solid #d0d3d8; border-radius: 6px; padding: 6px 8px; font-size: 13px; }
.actions button {
  padding: 7px 16px; border: none; border-radius: 8px; background: #4f7cff; color: #fff;
  font-size: 13px; cursor: pointer;
}
.actions button:disabled { opacity: .5; }
.body { display: flex; gap: 16px; flex: 1; min-height: 0; }
.archive { width: 160px; overflow-y: auto; flex-shrink: 0; }
.arch-item {
  padding: 9px 12px; border-radius: 8px; font-size: 13px; cursor: pointer; color: #444;
  margin-bottom: 4px; background: #fff;
}
.arch-item.on { background: #4f7cff; color: #fff; }
.viewer { flex: 1; background: #fff; border-radius: 12px; padding: 20px 26px; overflow-y: auto; }
.viewer-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.viewer-head h2 { font-size: 17px; margin: 0; }
.export { padding: 6px 14px; border: 1px solid #d0d3d8; background: #fff; border-radius: 8px; font-size: 13px; cursor: pointer; }
.md :deep(h2) { font-size: 16px; border-left: 3px solid #4f7cff; padding-left: 10px; margin: 18px 0 8px; }
.md :deep(p), .md :deep(li) { font-size: 14px; line-height: 1.8; }
.md :deep(blockquote) { border-left: 3px solid #e2e5ea; margin: 8px 0; padding: 2px 12px; color: #777; }
.empty { color: #999; font-size: 13px; padding: 20px 8px; }
.empty.big { margin-top: 40vh; text-align: center; }
.toast { position: fixed; bottom: 20px; right: 20px; background: #1f2328; color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 13px; }
</style>
