<template>
  <div class="page labs">
    <div class="page-head"><h1 class="page-title">实验室</h1><p class="page-sub">探索仍在打磨中的 AI 能力</p></div>
    <div class="badge-row"><span class="tag warn">实验功能</span><span class="hint">输出仅供参考。</span></div>
    <section class="card">
      <h3>引导式周度研究</h3><p class="hint">AI 根据你的兴趣线生成搜索词，你决定搜索与收录什么。</p>
      <button class="primary" :disabled="planning" @click="plan"><Icon name="sparkles" :size="15" />{{ planning ? 'AI 思考中…' : '生成本周研究计划' }}</button>
      <div v-if="researchNote" class="note">{{ researchNote }}</div>
      <div v-for="q in queries" :key="q" class="query-row"><span>{{ q }}</span><a :href="searchUrl(q)" target="_blank" rel="noopener"><Icon name="external" :size="14" />去搜索</a></div>
      <template v-if="queries.length">
        <div class="field"><label>有价值的内容</label><textarea v-model="finding" rows="3" placeholder="粘贴句子或摘要" /></div>
        <div class="field"><label>出处链接（可选）</label><input v-model="findingFrom" placeholder="https://" /></div>
        <button class="primary" :disabled="!finding.trim() || saving" @click="saveFinding">{{ saving ? '保存中…' : '存入时间线' }}</button><span v-if="savedMsg" class="msg ok inline">{{ savedMsg }}</span>
      </template>
    </section>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import Icon from '../components/Icon.vue'
const queries=ref<string[]>([]),researchNote=ref(''),planning=ref(false),finding=ref(''),findingFrom=ref(''),saving=ref(false),savedMsg=ref('')
async function plan(){planning.value=true;try{const r=await window.api.labs.planResearch();if(r.ok){queries.value=r.queries;researchNote.value=r.note}else researchNote.value=r.error??'生成失败'}finally{planning.value=false}}
const searchUrl=(q:string)=>`https://www.bing.com/search?q=${encodeURIComponent(q)}`
async function saveFinding(){saving.value=true;try{const r=await window.api.labs.saveFinding(finding.value.trim(),findingFrom.value.trim());if(r.ok){savedMsg.value='已存入时间线';finding.value='';findingFrom.value='';setTimeout(()=>savedMsg.value='',3000)}}finally{saving.value=false}}
</script>
<style scoped>.labs{max-width:860px}.badge-row{display:flex;align-items:center;gap:10px;margin-bottom:16px}.note{margin:12px 0;padding:10px;background:var(--surface-2);border-radius:var(--r)}.query-row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)}.query-row a{display:inline-flex;gap:5px;align-items:center}.field{margin-top:12px}.msg{margin-left:8px}</style>
