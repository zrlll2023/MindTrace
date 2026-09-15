<template>
  <div class="timeline">
    <div class="toolbar">
      <div class="chips">
        <button
          v-for="(label, k) in KIND_LABELS"
          :key="k"
          class="chip"
          :class="{ on: kind === k }"
          @click="toggleKind(k as EntryKind)"
        >
          {{ label }}
        </button>
      </div>
      <div class="filters">
        <input v-model="dateFrom" type="date" @change="reload" />
        <span>至</span>
        <input v-model="dateTo" type="date" @change="reload" />
        <input
          v-model="keyword"
          class="search"
          :placeholder="semanticOn ? '混合搜索（关键词+语义，AI 扩展查询）…' : '全文搜索…'"
          @input="onSearch"
        />
        <label class="checkbox" title="关键词 + 语义双路融合（RRF），并让 AI 扩展查询变体；需在设置页启用 Embedding">
          <input v-model="semanticOn" type="checkbox" @change="onSearch" />混合
        </label>
      </div>
    </div>

    <div v-if="searching" class="search-note">
      {{ semanticOn ? '混合搜索' : '搜索' }}「{{ keyword }}」的结果（{{ entries.length }} 条）
      <span v-if="expandedQueries.length > 1" class="exp">AI 扩展：{{ expandedQueries.slice(1).join(' / ') }}</span>
      <span v-if="semanticNotice" class="warn">{{ semanticNotice }}</span>
    </div>

    <div class="list">
      <div v-for="group in groups" :key="group.date" class="day-group">
        <div class="day-head">{{ group.date }}</div>
        <div
          v-for="e in group.items"
          :key="e.id"
          class="entry"
          @click="openDetail(e)"
        >
          <span class="badge">{{ KIND_LABELS[e.kind as EntryKind] }}</span>
          <span class="summary">{{ summarize(e) }}</span>
          <span v-if="semanticOn && e._score != null" class="score">{{ e._rerank != null ? `已精排 ${Math.round(e._rerank * 100)}%` : `${Math.round(e._score * 100)}%` }}</span>
          <span class="time">{{ e.created_at.slice(11, 16) }}</span>
          <div v-if="semanticOn && e._chunk" class="chunk-hit">匹配片段：{{ e._chunk }}</div>
        </div>
      </div>
      <div v-if="!entries.length" class="empty">暂无记录——去「记录」页写下第一条吧。</div>
      <button v-if="hasMore && !searching" class="more" @click="loadMore">加载更多</button>
    </div>

    <div v-if="detail" class="drawer-mask" @click.self="detail = null">
      <div class="drawer">
        <div class="drawer-head">
          <span class="badge">{{ KIND_LABELS[detail.kind as EntryKind] }}</span>
          <span class="meta">{{ detail.created_at }} · 置信度 {{ Math.round(detail.confidence * 100) }}%</span>
          <button class="close" @click="detail = null">✕</button>
        </div>
        <div class="raw">
          <div class="label">原始记录（不可修改）</div>
          <p>{{ detail.raw_text }}</p>
        </div>
        <div class="content-edit">
          <div class="label">结构化内容（可修正）</div>
          <textarea v-model="detailContentText" rows="6" />
          <div class="row" style="margin-top: 8px">
            <button class="primary" @click="saveContent">保存修改</button>
            <button class="danger" @click="removeEntry">删除这条记录</button>
            <span v-if="saved" class="saved">已保存 ✓</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { KIND_LABELS, EntryKind, TimelineFilter } from '../../electron/types'

interface EntryRow {
  id: number
  raw_text: string
  kind: string
  content: string
  confidence: number
  created_at: string
  entry_date: string
  _score?: number
  _rerank?: number
  _chunk?: string
}

const entries = ref<EntryRow[]>([])
const kind = ref<EntryKind | null>(null)
const dateFrom = ref('')
const dateTo = ref('')
const keyword = ref('')
const searching = ref(false)
const semanticOn = ref(true) // 默认开：有 Embedding 用混合，无则自动回退关键词
const semanticNotice = ref('')
const expandedQueries = ref<string[]>([])
const PAGE = 50
const offset = ref(0)
const hasMore = ref(false)
const detail = ref<EntryRow | null>(null)
const detailContentText = ref('')
const saved = ref(false)

const groups = computed(() => {
  const map = new Map<string, EntryRow[]>()
  for (const e of entries.value) {
    const arr = map.get(e.entry_date) ?? []
    arr.push(e)
    map.set(e.entry_date, arr)
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => ({ date, items }))
})

function summarize(e: EntryRow): string {
  try {
    const c = JSON.parse(e.content) as Record<string, unknown>
    const text = (c.text as string) ?? (c.hours != null ? `睡眠 ${c.hours} 小时` : '')
    return text.length > 80 ? text.slice(0, 80) + '…' : text || e.raw_text.slice(0, 80)
  } catch {
    return e.raw_text.slice(0, 80)
  }
}

async function load(reset = true): Promise<void> {
  if (reset) {
    offset.value = 0
    hasMore.value = false
  }
  const filter: TimelineFilter = {
    limit: PAGE,
    offset: reset ? 0 : offset.value
  }
  if (kind.value) filter.kind = kind.value
  if (dateFrom.value) filter.dateFrom = dateFrom.value
  if (dateTo.value) filter.dateTo = dateTo.value
  const page = await window.api.timeline.list(filter)
  entries.value = reset ? page : [...entries.value, ...page]
  offset.value = entries.value.length
  hasMore.value = page.length === PAGE
}

function loadMore(): void {
  void load(false)
}

function reload(): void {
  searching.value = false
  void load()
}

function toggleKind(k: EntryKind): void {
  kind.value = kind.value === k ? null : k
  void load()
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    if (!keyword.value.trim()) {
      searching.value = false
      semanticNotice.value = ''
      expandedQueries.value = []
      await load()
      return
    }
    searching.value = true
    expandedQueries.value = []
    if (semanticOn.value) {
      // 混合搜索：关键词 ⊕ 语义（RRF 融合）+ AI 查询扩展；Embedding 未配置时后端自动退化为纯关键词
      const r = await window.api.hybrid.search(keyword.value.trim(), 30, true)
      if (r.ok) {
        semanticNotice.value = ''
        expandedQueries.value = r.queries
        entries.value = r.hits.map((h: { score: number; chunk_text?: string; rerank_score?: number } & Record<string, unknown>) => ({
          ...h,
          _score: h.score,
          _chunk: h.chunk_text,
          _rerank: h.rerank_score
        })) as never
      } else {
        semanticNotice.value = `搜索失败：${r.error}`
        entries.value = await window.api.timeline.search(keyword.value.trim())
      }
    } else {
      semanticNotice.value = ''
      entries.value = await window.api.timeline.search(keyword.value.trim())
    }
  }, 250)
}

function openDetail(e: EntryRow): void {
  detail.value = e
  detailContentText.value = JSON.stringify(JSON.parse(e.content), null, 2)
  saved.value = false
}

async function saveContent(): Promise<void> {
  if (!detail.value) return
  try {
    const obj = JSON.parse(detailContentText.value)
    await window.api.timeline.updateContent(detail.value.id, obj)
    detail.value.content = JSON.stringify(obj)
    saved.value = true
    setTimeout(() => (saved.value = false), 2000)
  } catch {
    alert('JSON 格式有误，请检查后再保存')
  }
}

async function removeEntry(): Promise<void> {
  if (!detail.value) return
  if (!confirm('确定删除这条记录吗？此操作不可恢复。')) return
  await window.api.entries.remove(detail.value.id)
  detail.value = null
  await load()
}

onMounted(() => void load())
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { padding: 5px 12px; border: 1px solid #d0d3d8; background: #fff; border-radius: 999px; font-size: 13px; cursor: pointer; }
.chip.on { background: #4f7cff; color: #fff; border-color: #4f7cff; }
.filters { display: flex; gap: 8px; align-items: center; font-size: 13px; }
.filters input[type=date] { border: 1px solid #d0d3d8; border-radius: 6px; padding: 5px 8px; font-size: 13px; }
.search { width: 200px; border: 1px solid #d0d3d8; border-radius: 999px; padding: 6px 14px; font-size: 13px; }
.search-note { font-size: 12px; color: #888; margin-bottom: 8px; }
.day-head { font-size: 13px; font-weight: 600; color: #555; margin: 16px 0 6px; }
.entry {
  display: flex; align-items: center; gap: 10px; background: #fff; border-radius: 10px;
  padding: 10px 14px; margin-bottom: 6px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.05);
}
.entry:hover { box-shadow: 0 2px 6px rgba(0,0,0,.1); }
.badge { font-size: 12px; background: #eef1f5; border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
.summary { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.time { font-size: 12px; color: #999; }
.score { font-size: 11px; color: #4f7cff; background: #eef2ff; border-radius: 6px; padding: 1px 6px; }
.checkbox { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #555; cursor: pointer; }
.warn { color: #b45309; margin-left: 8px; }
.exp { color: #4f7cff; margin-left: 8px; font-size: 11px; }
.chunk-hit {
  width: 100%; font-size: 11px; color: #888; background: #f6f7f9;
  border-radius: 6px; padding: 4px 8px; margin-top: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.empty { text-align: center; color: #999; margin-top: 80px; }
.more { display: block; margin: 12px auto; padding: 7px 20px; border: 1px solid #d0d3d8; background: #fff; border-radius: 8px; cursor: pointer; }
.drawer-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; justify-content: flex-end; z-index: 10; }
.drawer { width: 460px; background: #fff; padding: 20px; overflow-y: auto; }
.drawer-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.meta { font-size: 12px; color: #888; flex: 1; }
.close { border: none; background: transparent; font-size: 16px; cursor: pointer; }
.label { font-size: 12px; color: #888; margin: 10px 0 4px; }
.raw p { background: #f6f7f9; border-radius: 8px; padding: 10px; font-size: 13px; color: #555; }
.content-edit textarea { width: 100%; box-sizing: border-box; border: 1px solid #d0d3d8; border-radius: 8px; padding: 10px; font-size: 12px; font-family: monospace; }
.primary { margin-top: 10px; padding: 7px 18px; border: none; border-radius: 8px; background: #4f7cff; color: #fff; cursor: pointer; }
.saved { margin-left: 10px; font-size: 13px; color: #0a8f4d; }
</style>
