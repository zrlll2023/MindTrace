<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">时间线</h1>
      <p class="page-sub">按日回溯你的心迹轨迹</p>
    </div>

    <div class="toolbar">
      <div class="chips">
        <button
          v-for="(label, k) in KIND_PLAIN"
          :key="k"
          class="chip kind"
          :class="[kindClass(k), { on: kind === k }]"
          @click="toggleKind(k)"
        >
          <span class="kind-dot" />{{ label }}
        </button>
      </div>
      <div class="filters">
        <DatePicker v-model="dateFrom" placeholder="开始日期" clearable @update:model-value="reload" />
        <span class="sep">至</span>
        <DatePicker v-model="dateTo" placeholder="结束日期" clearable @update:model-value="reload" />
        <label class="search-box">
          <Icon name="search" :size="15" />
          <input
            v-model="keyword"
            :placeholder="semanticOn ? '混合搜索（关键词+语义，AI 扩展查询）…' : '全文搜索…'"
            @input="onSearch"
          />
        </label>
        <label class="checkbox" title="关键词 + 语义双路融合（RRF），并让 AI 扩展查询变体；需在设置页启用 Embedding">
          <input v-model="semanticOn" type="checkbox" @change="onSearch" />混合
        </label>
      </div>
    </div>

    <div v-if="searching" class="search-note">
      <span class="tag accent">{{ semanticOn ? '混合搜索' : '搜索' }}</span>
      「{{ keyword }}」命中 {{ entries.length }} 条
      <span v-if="expandedQueries.length > 1" class="exp">AI 扩展：{{ expandedQueries.slice(1).join(' / ') }}</span>
      <span v-if="semanticNotice" class="warn">{{ semanticNotice }}</span>
    </div>

    <!-- 真轴线时间线 -->
    <div v-if="entries.length" class="tl">
      <section v-for="group in groups" :key="group.date" class="day">
        <div class="day-aside">
          <span class="day-node" />
          <div class="day-date">{{ formatDay(group.date) }}</div>
          <div class="day-meta">{{ weekday(group.date) }} · {{ group.items.length }} 条</div>
        </div>
        <div class="day-main">
          <article
            v-for="e in group.items"
            :key="e.id"
            class="entry"
            @click="openDetail(e)"
          >
            <span class="t">{{ e.entry_time || '未标时间' }}</span>
            <span class="kind-badge" :class="kindClass(e.kind)">
              <span class="kind-dot" />{{ kindLabel(e.kind) }}
            </span>
            <span class="summary">{{ summarize(e) }}</span>
            <span v-if="semanticOn && e._score != null" class="score">
              {{ e._rerank != null ? `精排 ${Math.round(e._rerank * 100)}%` : `${Math.round(e._score * 100)}%` }}
            </span>
            <div v-if="semanticOn && e._chunk" class="chunk-hit">匹配片段：{{ e._chunk }}</div>
          </article>
        </div>
      </section>

      <div class="tl-foot">
        <button v-if="hasMore && !searching" class="secondary" @click="loadMore">加载更多</button>
        <span v-else class="end-note">— 已到最早的记录 —</span>
      </div>
    </div>

    <div v-else class="empty">
      <h3>还没有留下痕迹</h3>
      <p>去「记录」页写下第一条吧，之后它会按日期出现在这里。</p>
    </div>

    <!-- 详情侧栏 -->
    <div v-if="detail" class="drawer-mask" @click.self="detail = null">
      <div class="drawer side">
        <div class="drawer-head">
          <span class="kind-badge" :class="kindClass(detail.kind)">
            <span class="kind-dot" />{{ kindLabel(detail.kind) }}
          </span>
          <span class="meta">
            发生于 {{ detail.entry_date }}{{ detail.entry_time ? ` ${detail.entry_time}` : '（未标时间）' }}
            · 保存于 {{ detail.created_at }}
            · 置信度 {{ Math.round(detail.confidence * 100) }}%
          </span>
          <button class="close" title="关闭" @click="detail = null">
            <Icon name="close" :size="16" />
          </button>
        </div>

        <div class="field">
          <div class="section-label">原始记录（不可修改）</div>
          <p class="raw">{{ detail.raw_text }}</p>
        </div>

        <div class="field">
          <div class="section-label">结构化内容（可修正）</div>
          <textarea v-model="detailContentText" rows="8" class="mono" />
        </div>

        <div class="row">
          <button v-if="detailKnowledgeId" class="secondary" @click="openKnowledge">查看知识资料</button>
          <button class="primary" @click="saveContent">保存修改</button>
          <button class="danger" @click="removeEntry">删除这条记录</button>
          <span v-if="saved" class="msg ok inline">已保存 ✓</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { EntryKind, TimelineFilter } from '../../electron/types'
import Icon from '../components/Icon.vue'
import DatePicker from '../components/DatePicker.vue'
import { KIND_PLAIN, kindClass, kindLabel } from '../utils/kinds'
import { localDateString } from '../utils/datetime'

interface EntryRow {
  id: number
  raw_text: string
  kind: string
  content: string
  confidence: number
  created_at: string
  entry_date: string
  entry_time: string | null
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
const semanticOn = ref(true)
const semanticNotice = ref('')
const expandedQueries = ref<string[]>([])
const PAGE = 50
const offset = ref(0)
const hasMore = ref(false)
const detail = ref<EntryRow | null>(null)
const detailContentText = ref('')
const saved = ref(false)
const router = useRouter()
const detailKnowledgeId = computed(() => {
  try { return Number(JSON.parse(detail.value?.content ?? '{}').kbItemId) || 0 } catch { return 0 }
})
function openKnowledge(): void { if (detailKnowledgeId.value) void router.push({ path: '/knowledge', query: { itemId: String(detailKnowledgeId.value) } }) }

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function todayStr(): string {
  return localDateString()
}

/** 2026-09-15 → 09月15日 / 今天 / 昨天 */
function formatDay(d: string): string {
  const t = todayStr()
  if (d === t) return '今天'
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (d === localDateString(y)) return '昨天'
  const [, m, day] = d.split('-')
  return `${m}月${Number(day)}日`
}

function weekday(d: string): string {
  const dt = new Date(`${d}T00:00:00`)
  return Number.isNaN(dt.getTime()) ? '' : WEEKDAYS[dt.getDay()]
}

const groups = computed(() => {
  const map = new Map<string, EntryRow[]>()
  for (const e of entries.value) {
    const arr = map.get(e.entry_date) ?? []
    arr.push(e)
    map.set(e.entry_date, arr)
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => {
        if (a.entry_time && b.entry_time) return b.entry_time.localeCompare(a.entry_time)
        if (a.entry_time) return -1
        if (b.entry_time) return 1
        return b.created_at.localeCompare(a.created_at) || b.id - a.id
      })
    }))
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

function toggleKind(k: string): void {
  kind.value = kind.value === k ? null : (k as EntryKind)
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
.toolbar {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
}
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip.kind.on { background: var(--kc-weak); border-color: var(--kc); color: var(--kc); }

.filters { display: flex; gap: 10px; align-items: center; font-size: 13px; flex-wrap: wrap; }
.filters .sep { color: var(--text-3); font-size: 12px; }
.filters :deep(.dp--main) { width: 150px; }

.search-note {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 12.5px; color: var(--text-2); margin-bottom: 14px;
}
.search-note .exp { color: var(--accent-text); font-size: 11.5px; }
.search-note .warn { color: var(--warn); }

/* ---- 轴线时间线 ---- */
.tl { position: relative; }
.tl::before {
  content: '';
  position: absolute; left: 76px; top: 10px; bottom: 0;
  width: 1px; background: var(--border);
}
.day { display: flex; gap: 20px; }
.day-aside {
  position: relative;
  width: 76px; flex: 0 0 76px;
  text-align: right; padding: 10px 16px 0 0;
}
.day-node {
  position: absolute; right: -5px; top: 16px;
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--accent);
}
.day-date { font-size: 13.5px; font-weight: 600; color: var(--text); line-height: 1.4; }
.day-meta { font-size: 11px; color: var(--text-3); }

.day-main { flex: 1; min-width: 0; padding: 8px 0 14px; }

.entry {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center; gap: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 9px 14px; margin-bottom: 6px;
  cursor: pointer; box-shadow: var(--shadow);
  transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease), transform 0.15s var(--ease);
}
.entry:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
  transform: translateX(2px);
}
.entry .t { font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.entry .summary {
  font-size: 13.5px; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.entry .score {
  font-size: 11px; color: var(--accent-text);
  background: var(--accent-weak); border-radius: var(--r-sm); padding: 1px 7px;
  font-variant-numeric: tabular-nums;
}
.entry .chunk-hit {
  grid-column: 1 / -1;
  font-size: 11px; color: var(--text-3);
  background: var(--surface-2); border-radius: var(--r-sm);
  padding: 4px 9px; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.tl-foot { display: flex; justify-content: center; padding: 12px 0 4px; }
.end-note { font-size: 11.5px; color: var(--text-3); letter-spacing: 0.08em; }

/* ---- 详情侧栏 ---- */
.meta { font-size: 11.5px; color: var(--text-3); flex: 1; }
.raw {
  background: var(--surface-2); border-radius: var(--r);
  padding: 10px 12px; font-size: 13px; color: var(--text-2); margin: 0;
}
textarea.mono { font-family: var(--font-mono); font-size: 12px; line-height: 1.6; }

@media (max-width: 760px) {
  .tl::before { display: none; }
  .day { flex-direction: column; gap: 4px; }
  .day-aside { width: auto; flex: none; text-align: left; padding: 12px 0 4px; }
  .day-node { display: none; }
  .day-date { display: inline-block; }
  .day-meta { display: inline-block; margin-left: 8px; }
}
</style>
