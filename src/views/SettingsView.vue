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

      <div class="row">
        <button :disabled="saving" @click="onSave">{{ saving ? '保存中…' : '保存设置' }}</button>
        <button class="secondary" :disabled="testing" @click="onTest">
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
      </div>

      <p v-if="store.message" :class="store.messageOk ? 'msg ok' : 'msg err'">{{ store.message }}</p>
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
  // 先保存 baseUrl/model 草稿以便主进程用新配置拉取
  saving.value = true
  await window.api.settings.save({ ...form })
  saving.value = false
  fetchingModels.value = true
  try {
    models.value = await store.fetchModels(form.baseUrl)
  } finally {
    fetchingModels.value = false
  }
}

async function onSave(): Promise<void> {
  saving.value = true
  try {
    await store.save({ ...form }, apiKey.value || undefined)
    apiKey.value = ''
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
