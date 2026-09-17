<template>
  <div class="page me-page">
    <div class="page-head"><h1 class="page-title">我的</h1><p class="page-sub">个人资料与生活趋势</p></div>
    <section class="card">
      <div class="section-title"><div><h3>基本资料</h3><p class="hint">手动填写的内容优先，AI 快速记录不会覆盖。</p></div><span v-if="saved" class="msg ok inline">已保存</span></div>
      <div class="profile-grid">
        <div v-for="field in fields" :key="field.key" class="field" :class="{ wide: field.wide }">
          <label>{{ field.label }} <span v-if="sources[field.key]" class="source">{{ sources[field.key] === 'manual' ? '手动' : 'AI 建议' }}</span></label>
          <textarea v-if="field.wide" v-model="form[field.key]" rows="3" :placeholder="field.placeholder" />
          <input v-else v-model="form[field.key]" :placeholder="field.placeholder" />
        </div>
      </div>
      <button class="primary" :disabled="saving" @click="saveProfile">{{ saving ? '保存中…' : '保存资料' }}</button>
    </section>
    <section class="card">
      <div class="section-title">
        <div><h3>生活趋势</h3><p class="hint">睡眠时长与负面事件按日回顾，仅供自我观察。</p></div>
        <div class="seg-group" aria-label="趋势日期显示范围">
          <button class="seg" :class="{ on: visibility === 'recorded' }" :aria-pressed="visibility === 'recorded'" @click="visibility = 'recorded'">有记录日期</button>
          <button class="seg" :class="{ on: visibility === 'all' }" :aria-pressed="visibility === 'all'" @click="visibility = 'all'">全部日期</button>
        </div>
      </div>
      <div class="range"><DatePicker v-model="dateFrom" placeholder="开始日期" @update:model-value="loadMetrics" /><span>至</span><DatePicker v-model="dateTo" placeholder="结束日期" @update:model-value="loadMetrics" /><button class="secondary small" @click="last30">最近 30 天</button></div>
      <div class="stat-row"><div><b>{{ avgSleep }}</b><span>平均睡眠小时</span></div><div><b>{{ totalNegative }}</b><span>负面事件</span></div><div><b>{{ totalEntries }}</b><span>记录总数</span></div></div>
      <div v-if="visibleMetrics.length" class="trend-list">
        <div v-for="m in visibleMetrics" :key="m.date" class="trend-row">
          <time>{{ m.date }}</time>
          <div class="trend-values">
            <span v-if="m.sleep_hours != null" class="trend-value"><b>睡眠 {{ m.sleep_hours }}h</b><small>{{ sleepDetail(m) }}</small></span>
            <span v-if="m.classified_event_count > 0" class="trend-value"><b>负面事件 {{ m.negative_count }}</b><small>已分类事件 {{ m.classified_event_count }}</small></span>
            <span v-if="m.entry_count > 0" class="trend-value"><b>记录 {{ m.entry_count }}</b></span>
            <span v-if="m.entry_count === 0" class="trend-missing">当天未填写</span>
          </div>
        </div>
      </div>
      <div v-else class="empty">该区间暂无已填写记录。</div>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { DayMetrics, ProfileKey, ProfileValues } from '../../electron/types'
import DatePicker from '../components/DatePicker.vue'
import { filterTrendMetrics, totalNegativeEvents, type TrendVisibility } from '../utils/trends'
const fields: { key: ProfileKey; label: string; placeholder: string; wide?: boolean }[] = [
  { key:'name',label:'名称',placeholder:'你的名字' },{ key:'preferredName',label:'希望如何称呼',placeholder:'例如：小林' },{ key:'identity',label:'职业 / 身份',placeholder:'例如：学生、产品经理' },{ key:'location',label:'所在地',placeholder:'城市或地区' },
  { key:'bio',label:'个人简介',placeholder:'简单介绍现在的自己',wide:true },{ key:'goals',label:'关注目标',placeholder:'近期想推进的事情',wide:true },{ key:'interests',label:'兴趣',placeholder:'长期关注和喜欢的方向',wide:true }
]
const form=reactive<ProfileValues>({}),sources=reactive<Partial<Record<ProfileKey,'manual'|'ai'>>>({}),saving=ref(false),saved=ref(false)
const metrics=ref<DayMetrics[]>([]),visibility=ref<TrendVisibility>('recorded'),today=()=>new Date().toISOString().slice(0,10),ago30=()=>{const d=new Date();d.setDate(d.getDate()-29);return d.toISOString().slice(0,10)},dateFrom=ref(ago30()),dateTo=ref(today())
const visibleMetrics=computed(()=>filterTrendMetrics(metrics.value,visibility.value))
const avgSleep=computed(()=>{const a=metrics.value.filter(m=>m.sleep_hours!=null).map(m=>m.sleep_hours!);return a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1):'—'}),totalNegative=computed(()=>totalNegativeEvents(metrics.value)??'—'),totalEntries=computed(()=>metrics.value.reduce((n,m)=>n+m.entry_count,0))
function sleepDetail(m:DayMetrics){if(m.sleep_data_mode==='sessions')return `${m.sleep_sessions} 段 · 最长 ${m.longest_sleep_hours}h`;if(m.sleep_data_mode==='daily_total')return '当天累计 · 分段未知';return '旧记录 · 分段未知'}
async function loadProfile(){const p=await window.api.profile.get();for(const f of fields){form[f.key]=p[f.key]?.value??'';if(p[f.key]?.source)sources[f.key]=p[f.key].source}}
async function saveProfile(){saving.value=true;try{await window.api.profile.save({...form});for(const f of fields)if(form[f.key])sources[f.key]='manual';saved.value=true;setTimeout(()=>saved.value=false,2500)}finally{saving.value=false}}
async function loadMetrics(){metrics.value=await window.api.labs.metrics(dateFrom.value,dateTo.value)} function last30(){dateFrom.value=ago30();dateTo.value=today();void loadMetrics()} onMounted(()=>{void loadProfile();void loadMetrics()})
</script>
<style scoped>
.me-page{max-width:900px}.section-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.section-title h3{margin:0}.profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field.wide{grid-column:1/-1}.source{font-size:10px;color:var(--accent-text);background:var(--accent-weak);padding:1px 5px;border-radius:var(--r-sm)}.range{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:12px 0}.range :deep(.dp--main){width:150px}.stat-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0}.stat-row div{padding:14px;background:var(--surface-2);border-radius:var(--r);display:flex;flex-direction:column}.stat-row b{font-size:24px}.stat-row span{font-size:12px;color:var(--text-3)}.trend-list{max-height:320px;overflow:auto}.trend-row{display:grid;grid-template-columns:minmax(96px,.7fr) 3fr;gap:14px;align-items:start;padding:10px 4px;border-bottom:1px solid var(--border);font-size:12.5px}.trend-row time{font-weight:600;padding-top:7px}.trend-values{display:flex;gap:8px;flex-wrap:wrap}.trend-value{display:flex;flex-direction:column;gap:2px;min-width:128px;padding:6px 10px;background:var(--surface-2);border-radius:var(--r-sm)}.trend-value b{font-size:12.5px;font-weight:600}.trend-value small,.trend-missing{font-size:11.5px;color:var(--text-3)}.trend-missing{padding:7px 0}@media(max-width:700px){.section-title{flex-direction:column}.profile-grid{grid-template-columns:1fr}.stat-row{grid-template-columns:1fr}.trend-row{grid-template-columns:1fr}.trend-row time{padding-top:0}.trend-value{flex:1 1 140px}}
</style>
