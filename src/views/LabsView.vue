<template>
  <div class="page labs">
    <div class="page-head">
      <h1 class="page-title">实验室</h1>
      <p class="page-sub">相关性分析与引导式研究</p>
    </div>

    <div class="badge-row">
      <span class="tag warn">实验功能</span>
      <span class="hint" style="margin: 0">这些功能仍在打磨，输出仅供参考。</span>
    </div>

    <div class="card">
      <h3>相关性仪表盘</h3>
      <p class="hint">你的睡眠时长与负面事件数逐日对照——线越同步，说明两者越相关。</p>
      <div class="range">
        <input v-model="dateFrom" type="date" @change="loadMetrics" />
        <span class="sep">至</span>
        <input v-model="dateTo" type="date" @change="loadMetrics" />
        <button class="secondary small" @click="last30">最近 30 天</button>
      </div>

      <div v-if="metrics.length" class="chart">
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
          <line
            v-for="i in 4"
            :key="i"
            class="grid"
            :x1="10"
            :x2="W - 10"
            :y1="20 + ((i - 1) * (H - 40)) / 3"
            :y2="20 + ((i - 1) * (H - 40)) / 3"
          />
          <polyline class="line sleep" :points="sleepPoints" />
          <polyline class="line neg" :points="negPoints" />
        </svg>
        <div class="legend">
          <span class="key"><span class="dot sleep" />睡眠时长</span>
          <span class="key"><span class="dot neg" />负面事件数</span>
        </div>
        <div class="x-labels">
          <span>{{ metrics[0]?.date }}</span>
          <span>{{ metrics[Math.floor(metrics.length / 2)]?.date }}</span>
          <span>{{ metrics[metrics.length - 1]?.date }}</span>
        </div>
      </div>
      <div v-else class="empty">该区间暂无数据——去「记录」页写几条，或选个更早的范围。</div>
    </div>

    <div class="card">
      <h3>引导式周度研究</h3>
      <p class="hint">AI 根据你的兴趣线出搜索词 → 你点链接去搜索 → 把有价值的内容粘贴回来存入时间线。</p>
      <button class="primary" :disabled="planning" @click="plan">
        <Icon name="sparkles" :size="15" />
        {{ planning ? 'AI 思考中…' : '生成本周研究计划' }}
      </button>
      <div v-if="researchNote" class="note">{{ researchNote }}</div>

      <div v-for="q in queries" :key="q" class="query-row">
        <span class="q">{{ q }}</span>
        <a :href="searchUrl(q)" target="_blank" rel="noopener" class="go">
          <Icon name="external" :size="14" />去搜索
        </a>
      </div>

      <template v-if="queries.length">
        <div class="field">
          <label>粘贴你发现的有价值内容（句子/摘要）</label>
          <textarea v-model="finding" rows="3" placeholder="粘贴到这里…" />
        </div>
        <div class="field">
          <label>出处链接（可选）</label>
          <input v-model="findingFrom" placeholder="https://…" />
        </div>
        <button class="primary" :disabled="!finding.trim() || saving" @click="saveFinding">
          {{ saving ? '保存中…' : '存入时间线' }}
        </button>
        <span v-if="savedMsg" class="msg ok inline" style="margin-left: 8px">{{ savedMsg }}</span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import Icon from '../components/Icon.vue'

interface DayMetrics {
  date: string
  sleep_hours: number | null
  negative_count: number
  entry_count: number
  idea_count: number
}

const W = 600
const H = 180

const dateFrom = ref(thirtyDaysAgo())
const dateTo = ref(today())
const metrics = ref<DayMetrics[]>([])
const queries = ref<string[]>([])
const researchNote = ref('')
const planning = ref(false)
const finding = ref('')
const findingFrom = ref('')
const saving = ref(false)
const savedMsg = ref('')

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
function thirtyDaysAgo(): string {
  const d = new Date()
  d.setDate(d.getDate() - 29)
  return d.toISOString().slice(0, 10)
}
function last30(): void {
  dateFrom.value = thirtyDaysAgo()
  dateTo.value = today()
  void loadMetrics()
}

async function loadMetrics(): Promise<void> {
  metrics.value = await window.api.labs.metrics(dateFrom.value, dateTo.value)
}

const sleepPoints = computed(() => {
  const withSleep = metrics.value.filter(m => m.sleep_hours != null)
  if (withSleep.length < 2) return ''
  const max = Math.max(...withSleep.map(m => m.sleep_hours!), 10)
  return withSleep
    .map(m => {
      const x = (metrics.value.indexOf(m) / (metrics.value.length - 1)) * (W - 20) + 10
      const y = H - 20 - ((m.sleep_hours ?? 0) / max) * (H - 40)
      return `${x},${y}`
    })
    .join(' ')
})

const negPoints = computed(() => {
  const maxNeg = Math.max(...metrics.value.map(m => m.negative_count), 1)
  return metrics.value
    .map((m, i) => {
      const x = (i / Math.max(metrics.value.length - 1, 1)) * (W - 20) + 10
      const y = H - 20 - (m.negative_count / maxNeg) * (H - 40)
      return `${x},${y}`
    })
    .join(' ')
})

async function plan(): Promise<void> {
  planning.value = true
  try {
    const r = await window.api.labs.planResearch()
    if (r.ok) {
      queries.value = r.queries
      researchNote.value = r.note
    } else {
      researchNote.value = r.error ?? '生成失败'
    }
  } finally {
    planning.value = false
  }
}

function searchUrl(q: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(q)}`
}

async function saveFinding(): Promise<void> {
  saving.value = true
  try {
    const r = await window.api.labs.saveFinding(finding.value.trim(), findingFrom.value.trim())
    if (r.ok) {
      savedMsg.value = '✅ 已存入时间线（类型：句子）'
      finding.value = ''
      findingFrom.value = ''
      setTimeout(() => (savedMsg.value = ''), 4000)
    }
  } finally {
    saving.value = false
  }
}

onMounted(() => void loadMetrics())
</script>

<style scoped>
.labs { max-width: 860px; }
.badge-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.card > h3 { margin-bottom: 4px; }

.range { display: flex; gap: 10px; align-items: center; font-size: 13px; margin: 10px 0 14px; flex-wrap: wrap; }
.range .sep { color: var(--text-3); font-size: 12px; }

.chart svg {
  width: 100%; height: 190px;
  background: var(--surface-2);
  border: 1px solid var(--border); border-radius: var(--r-md);
}
.chart .grid { stroke: var(--grid-line); stroke-width: 1; }
.chart .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.chart .line.sleep { stroke: var(--k-sleep); }
.chart .line.neg { stroke: var(--k-event); }

.legend { display: flex; align-items: center; gap: 16px; font-size: 12px; color: var(--text-2); margin-top: 8px; }
.key { display: inline-flex; align-items: center; gap: 6px; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.dot.sleep { background: var(--k-sleep); }
.dot.neg { background: var(--k-event); }
.x-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-3); margin-top: 4px; }

.note {
  font-size: 13px; color: var(--text-2);
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--r); padding: 10px 12px; margin: 12px 0;
}
.query-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 0; border-bottom: 1px solid var(--border);
}
.query-row .q { flex: 1; font-size: 14px; }
.go {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12.5px; color: var(--accent);
  padding: 4px 10px; border-radius: var(--r-full);
  border: 1px solid var(--border-strong);
}
.go:hover { background: var(--accent-weak); text-decoration: none; }

.field { margin-top: 12px; }
.field label { display: block; font-size: 12.5px; color: var(--text-2); margin-bottom: 5px; }
</style>
