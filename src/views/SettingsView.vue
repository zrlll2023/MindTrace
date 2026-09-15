<template>
  <div class="settings">
    <h2>设置</h2>
    <p class="hint">配置 AI 提供商。API Key 加密存储在本机（Windows DPAPI），永远不会明文落盘。</p>

    <div class="card">
      <div class="field">
        <label>提供商预设</label>
        <select v-model="presetId" @change="onPresetChange">
          <option v-for="p in store.presets" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>

      <div class="field">
        <label>Base URL</label>
        <input v-model="form.baseUrl" placeholder="例如 https://api.deepseek.com" />
      </div>

      <div class="field">
        <label>模型</label>
        <div class="row">
          <input v-model="form.model" placeholder="例如 deepseek-chat" list="model-list" />
          <button class="secondary" :disabled="fetchingModels" @click="onFetchModels">
            {{ fetchingModels ? '拉取中…' : '拉取模型列表' }}
          </button>
        </div>
        <datalist id="model-list">
          <option v-for="m in models" :key="m" :value="m" />
        </datalist>
        <p v-if="models.length" class="hint">共 {{ models.length }} 个模型，可直接下拉选择</p>
      </div>

      <div class="field">
        <label>API Key {{ store.payload.hasApiKey ? '（已保存，留空则不修改）' : '' }}</label>
        <input v-model="apiKey" type="password" placeholder="sk-..." autocomplete="off" />
      </div>

      <div class="field">
        <label class="checkbox">
          <input v-model="form.desensitize" type="checkbox" />
          出网脱敏：发送给 AI 前去除人名、账号等标识信息（推荐开启）
        </label>
      </div>

      <div class="field">
        <label>联网搜索（用于报告「推荐内容」）</label>
        <select v-model="form.searchProvider">
          <option value="none">关闭（仅本地分析）</option>
          <option value="tavily">Tavily（国际，tavily.com 免费申请）</option>
          <option value="bocha">博查 Bocha（国内，bochaai.com）</option>
        </select>
      </div>
      <div v-if="form.searchProvider !== 'none'" class="field">
        <label>搜索 API Key {{ store.payload.hasSearchKey ? '（已保存，留空则不修改）' : '' }}</label>
        <input v-model="searchKey" type="password" placeholder="搜索服务的 API Key" autocomplete="off" />
      </div>

      <div class="row">
        <button :disabled="saving" @click="onSave">{{ saving ? '保存中…' : '保存设置' }}</button>
        <button class="secondary" :disabled="testing" @click="onTest">
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
      </div>

      <p v-if="store.message" :class="store.messageOk ? 'msg ok' : 'msg err'">{{ store.message }}</p>
    </div>

    <div class="card">
      <h3>语义搜索（v2.5）</h3>
      <p class="hint">按含义检索你的记录（如「情绪波动相关的记录」）。使用当前提供商的 Embedding 模型（需该服务支持，如 SiliconFlow / 智谱 / OpenAI / Ollama）。</p>
      <div class="field">
        <label class="checkbox">
          <input v-model="form.embeddingEnabled" type="checkbox" />
          启用语义搜索
        </label>
      </div>
      <div v-if="form.embeddingEnabled" class="field">
        <label>Embedding 模型名（如 text-embedding-3-small / embedding-2 / bge-m3）</label>
        <input v-model="form.embeddingModel" placeholder="embedding 模型名" />
      </div>
      <div v-if="form.embeddingEnabled" class="row">
        <button class="secondary" :disabled="indexing" @click="onIndex">
          {{ indexing ? '索引中…' : `重建索引（已索引 ${indexedCount} 条）` }}
        </button>
        <span v-if="indexMsg" :class="indexOk ? 'msg ok' : 'msg err'">{{ indexMsg }}</span>
      </div>
      <div class="field">
        <label class="checkbox">
          <input v-model="form.rerankEnabled" type="checkbox" />
          启用 AI 精排（Reranking）：搜索后由 AI 精读 top-20 候选并重排，更准但更慢
        </label>
      </div>
    </div>

    <div class="card">
      <h3>导入 AI 对话（v2）</h3>
      <p class="hint">
        支持导入 ChatGPT / Claude 官方数据导出 ZIP（设置 → Data Controls → Export）。
        对话将按条目存入时间线（类型：对话），自动去重，可重复导入。
      </p>
      <button class="secondary" :disabled="importing" @click="onImport">
        {{ importing ? '导入中…' : '选择导出 ZIP 并导入' }}
      </button>
      <p v-if="importMsg" :class="importOk ? 'msg ok' : 'msg err'">{{ importMsg }}</p>
    </div>

    <div class="card">
      <h3>数据</h3>
      <p class="hint">所有数据存储在本地，只有 AI 分析文本会出网（可开启脱敏）。</p>
      <div class="field">
        <label>数据目录</label>
        <code>{{ store.payload.dataDir || '…' }}</code>
      </div>
      <button class="secondary" @click="store.openDataDir()">打开数据目录</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, reactive } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { AppSettings, DEFAULT_SETTINGS } from '../../electron/types'

const store = useSettingsStore()
const form = reactive<AppSettings>({ ...DEFAULT_SETTINGS })
const presetId = ref('deepseek')
const apiKey = ref('')
const searchKey = ref('')
const models = ref<string[]>([])
const fetchingModels = ref(false)
const saving = ref(false)
const testing = ref(false)

onMounted(async () => {
  await store.load()
  Object.assign(form, store.payload.settings)
  const p = store.presets.find(p => p.id === form.providerId)
  if (p) presetId.value = p.id
})

function onPresetChange(): void {
  const p = store.presets.find(p => p.id === presetId.value)
  if (p && p.baseUrl) form.baseUrl = p.baseUrl
  form.providerId = presetId.value
}

async function onFetchModels(): Promise<void> {
  // 直接用表单草稿（含未保存的 Key）拉取，不再落库
  if (!form.baseUrl.trim()) {
    store.show('请先填写 Base URL', false)
    return
  }
  if (!apiKey.value.trim() && !store.payload.hasApiKey) {
    store.show('请先填写 API Key 再拉取模型列表', false)
    return
  }
  fetchingModels.value = true
  try {
    models.value = await store.fetchModels(form.baseUrl, apiKey.value || undefined)
  } finally {
    fetchingModels.value = false
  }
}

async function onSave(): Promise<void> {
  saving.value = true
  try {
    await store.save({ ...form }, apiKey.value || undefined, searchKey.value)
    apiKey.value = ''
    searchKey.value = ''
  } finally {
    saving.value = false
  }
}

async function onTest(): Promise<void> {
  testing.value = true
  try {
    const r = await store.testConnection(form.baseUrl, apiKey.value || undefined, form.model)
    if (r.ok) store.show('✅ 连接成功', true)
    else store.show(`❌ 连接失败：${r.error}`, false)
  } finally {
    testing.value = false
  }
}

const importing = ref(false)
const importMsg = ref('')
const importOk = ref(false)

// ---------- 语义搜索 ----------
const indexing = ref(false)
const indexMsg = ref('')
const indexOk = ref(false)
const indexedCount = ref(0)

onMounted(async () => {
  const s = await window.api.semantic.status()
  indexedCount.value = s.indexed
})

async function onIndex(): Promise<void> {
  indexing.value = true
  indexMsg.value = ''
  try {
    const r = await window.api.semantic.index()
    if (r.ok) {
      indexedCount.value = (await window.api.semantic.status()).indexed
      indexOk.value = true
      indexMsg.value = `✅ 索引完成（本次新增 ${r.indexed} 条）`
    } else {
      indexOk.value = false
      indexMsg.value = `❌ ${r.error}`
    }
  } finally {
    indexing.value = false
  }
}

async function onImport(): Promise<void> {
  importing.value = true
  importMsg.value = ''
  try {
    const r = await window.api.import.exportZip()
    if (r.ok && r.summary) {
      importOk.value = true
      importMsg.value = `✅ 导入完成：${r.summary.conversations} 个会话，新增 ${r.summary.imported} 条，跳过重复 ${r.summary.skipped} 条`
    } else if (!r.canceled) {
      importOk.value = false
      importMsg.value = `❌ ${r.error || '导入失败'}`
    }
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.settings { max-width: 720px; margin: 0 auto; }
.card { background: #fff; border-radius: 10px; padding: 20px 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.field { margin-bottom: 14px; }
label { display: block; font-size: 13px; color: #555; margin-bottom: 4px; }
label.checkbox { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #333; }
input[type=text], input[type=password], input:not([type]), select {
  width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d0d3d8;
  border-radius: 6px; font-size: 14px; background: #fafbfc;
}
input:focus, select:focus { outline: 2px solid #4f7cff33; border-color: #4f7cff; }
.row { display: flex; gap: 8px; }
.row input { flex: 1; }
button {
  padding: 8px 18px; border: none; border-radius: 6px; background: #4f7cff;
  color: #fff; font-size: 14px; cursor: pointer;
}
button.secondary { background: #eef1f5; color: #333; }
button:disabled { opacity: .5; cursor: not-allowed; }
.hint { font-size: 12px; color: #888; }
code { font-size: 12px; color: #555; word-break: break-all; }
.msg { margin-top: 10px; font-size: 13px; }
.msg.ok { color: #0a8f4d; }
.msg.err { color: #d33; }
h3 { margin: 0 0 8px; font-size: 15px; }
</style>
