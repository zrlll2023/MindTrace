<template>
  <div class="labs">
    <div class="badge-row">
      <span class="lab-badge">🧪 实验功能</span>
      <span class="hint">这些功能仍在打磨，输出仅供参考。</span>
    </div>

    <div class="card">
      <h3>相关性仪表盘</h3>
      <p class="hint">你的睡眠时长（蓝线）与负面事件数（红线）逐日对照——线越同步，说明两者越相关。</p>
      <div class="range">
        <input v-model="dateFrom" type="date" @change="loadMetrics" />
        <span>至</span>
        <input v-model="dateTo" type="date" @change="loadMetrics" />
        <button class="secondary" @click="last30">最近 30 天</button>
      </div>
      <div v-if="metrics.length" class="chart">
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
          <polyline :points="sleepPoints" fill="none" stroke="#4f7cff" stroke-width="2" />
          <polyline :points="negPoints" fill="none" stroke="#e05252" stroke-width="2" />
        </svg>
        <div class="legend">
          <span class="dot blue"></span>睡眠时长
          <span class="dot red"></span>负面事件数
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
      <button :disabled="planning" @click="plan">
        {{ planning ? 'AI 思考中…' : '生成本周研究计划' }}
      </button>
      <div v-if="researchNote" class="note">{{ researchNote }}</div>
      <div v-for="q in queries" :key="q" class="query-row">
        <span class="q">{{ q }}</span>
        <a :href="searchUrl(q)" target="_blank" rel="noopener">
          <button class="secondary">去搜索 ↗</button>
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
        <button :disabled="!finding.trim() || saving" @click="saveFinding">
          {{ saving ? '保存中…' : '存入时间线' }}
        </button>
        <span v-if="savedMsg" class="msg ok">{{ savedMsg }}</span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'

interface DayMetrics {
  date: string
  sleep_hours: number | null
  negative_count: number
  entry_count: number
  idea_count: number
}

const W = 600
const H = 160

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
    .map((m, i) => {
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
.badge-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.lab-badge { background: #fef3cd; color: #8a6d00; font-size: 12px; padding: 3px 10px; border-radius: 999px; }
.card { background: #fff; border-radius: 12px; padding: 20px 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
h3 { margin: 0 0 6px; font-size: 15px; }
.hint { font-size: 12px; color: #888; }
.range { display: flex; gap: 8px; align-items: center; font-size: 13px; margin: 10px 0; }
.range input { border: 1px solid #d0d3d8; border-radius: 6px; padding: 5px 8px; font-size: 13px; }
.chart svg { width: 100%; height: 180px; background: #fafbfc; border-radius: 8px; }
.legend { font-size: 12px; color: #666; margin-top: 6px; display: flex; align-items: center; gap: 6px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.dot.blue { background: #4f7cff; }
.dot.red { background: #e05252; margin-left: 10px; }
.x-labels { display: flex; justify-content: space-between; font-size: 11px; color: #999; }
.empty { color: #999; font-size: 13px; padding: 24px 0; text-align: center; }
button { padding: 8px 18px; border: none; border-radius: 8px; background: #4f7cff; color: #fff; font-size: 13px; cursor: pointer; }
button.secondary { background: #eef1f5; color: #333; }
button:disabled { opacity: .5; cursor: not-allowed; }
.note { font-size: 13px; color: #555; background: #f6f7f9; border-radius: 8px; padding: 10px 12px; margin: 10px 0; }
.query-row { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
.query-row .q { flex: 1; font-size: 14px; }
.query-row a { text-decoration: none; }
.field { margin-top: 12px; }
.field label { display: block; font-size: 12px; color: #666; margin-bottom: 4px; }
.field input, .field textarea { width: 100%; box-sizing: border-box; border: 1px solid #d0d3d8; border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; }
.msg.ok { font-size: 13px; color: #0a8f4d; margin-left: 10px; }
</style>
