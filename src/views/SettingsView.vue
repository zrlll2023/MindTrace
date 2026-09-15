<template>
  <div class="settings page">
    <div class="page-head">
      <h1 class="page-title">设置</h1>
      <p class="page-sub">AI 服务、外观与本地数据</p>
    </div>

    <!-- 外观 -->
    <div class="card">
      <h3>外观</h3>
      <p class="hint">「纸」适合白天阅读，「墨」适合夜间记录；默认跟随系统。</p>
      <div class="theme-picker">
        <button
          v-for="opt in THEME_OPTIONS"
          :key="opt.mode"
          class="theme-opt"
          :class="{ on: theme.mode === opt.mode }"
          @click="theme.set(opt.mode)"
        >
          <span class="preview" :class="opt.mode">
            <span class="p-side" /><span class="p-main"><i /><i /><i /></span>
          </span>
          <span class="t-name">{{ opt.name }}</span>
        </button>
      </div>
    </div>

    <!-- AI 服务 -->
    <div class="card">
      <h3>AI 服务</h3>
      <p class="hint">API Key 加密存储在本机（Windows DPAPI），永远不会明文落盘。</p>

      <div class="field">
        <label>提供商预设</label>
        <select v-model="presetId" @change="onPresetChange">
          <option v-for="p in store.presets" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <p v-if="currentPreset?.note" class="hint">{{ currentPreset.note }}</p>
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
            {{ fetchingModels ? '刷新中…' : '刷新账户可用模型' }}
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
        <button class="primary" :disabled="saving" @click="onSave">{{ saving ? '保存中…' : '保存设置' }}</button>
        <button class="secondary" :disabled="testing" @click="onTest">
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
      </div>

      <p v-if="store.message" :class="store.messageOk ? 'msg ok' : 'msg err'">{{ store.message }}</p>
    </div>

    <!-- 语义搜索 -->
    <div class="card">
      <h3>语义搜索</h3>
      <p class="hint">
        按含义检索你的记录（如「情绪波动相关的记录」）。使用当前提供商的 Embedding 模型（需该服务支持，如 SiliconFlow / 智谱 / OpenAI / Ollama）。
      </p>
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
        <span v-if="indexMsg" :class="indexOk ? 'msg ok inline' : 'msg err inline'">{{ indexMsg }}</span>
      </div>
      <div class="field">
        <label class="checkbox">
          <input v-model="form.rerankEnabled" type="checkbox" />
          启用 AI 精排（Reranking）：搜索后由 AI 精读 top-20 候选并重排，更准但更慢
        </label>
      </div>
    </div>

    <!-- 数据 -->
    <div class="card">
      <h3>数据</h3>
      <p class="hint">所有数据存储在本地，只有 AI 分析文本会出网（可开启脱敏）。</p>
      <div class="field">
        <label>数据目录</label>
        <code class="path">{{ store.payload.dataDir || '…' }}</code>
      </div>
      <button class="secondary" @click="store.openDataDir()">
        <Icon name="folder" :size="15" />打开数据目录
      </button>
      <button class="secondary" @click="chooseDataDir"><Icon name="folder" :size="15" />更换数据目录</button>
      <button v-if="store.payload.previousDataDir" class="ghost" @click="store.openPreviousDataDir()">打开迁移前目录</button>
      <div v-if="migrationTarget" class="migration-box">
        <div><b>目标目录</b><code class="path">{{ migrationTarget }}</code></div>
        <p :class="migrationCheck?.ok ? 'msg ok' : 'msg err'">{{ migrationText }}</p>
        <label v-if="migrationCheck?.ok" class="checkbox"><input v-model="migrationConfirmed" type="checkbox" />我已核对目标目录，确认复制并校验全部数据</label>
        <button v-if="migrationCheck?.ok" class="primary" :disabled="!migrationConfirmed || migrating" @click="migrateNow">{{ migrating ? '迁移校验中…' : '确认迁移' }}</button>
      </div>
      <div v-if="restartRequired" class="card accent"><b>迁移完成</b><p>旧目录仍保留。重启后启用新目录。</p><button class="primary" @click="restartApp">立即重启</button></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, reactive } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useThemeStore, ThemeMode } from '../stores/theme'
import { AppSettings, DEFAULT_SETTINGS } from '../../electron/types'
import Icon from '../components/Icon.vue'

const THEME_OPTIONS: { mode: ThemeMode; name: string }[] = [
  { mode: 'light', name: '纸 · 浅色' },
  { mode: 'dark', name: '墨 · 深色' },
  { mode: 'system', name: '跟随系统' }
]

const store = useSettingsStore()
const theme = useThemeStore()
const form = reactive<AppSettings>({ ...DEFAULT_SETTINGS })
const presetId = ref('deepseek')
const apiKey = ref('')
const searchKey = ref('')
const models = ref<string[]>([])
const currentPreset = computed(() => store.presets.find(p => p.id === presetId.value))
const fetchingModels = ref(false)
const saving = ref(false)
const testing = ref(false)

onMounted(async () => {
  await store.load()
  Object.assign(form, store.payload.settings)
  const p = store.presets.find(p => p.id === form.providerId)
  if (p) { presetId.value = p.id; models.value = [...p.models] }
})

function onPresetChange(): void {
  const p = store.presets.find(p => p.id === presetId.value)
  if (p && p.baseUrl) form.baseUrl = p.baseUrl
  models.value = p ? [...p.models] : []
  if (models.value.length && !models.value.includes(form.model)) form.model = models.value[0]
  form.providerId = presetId.value
}

async function onFetchModels(): Promise<void> {
  if (!form.baseUrl.trim()) {
    store.show('请先填写 Base URL', false)
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

const migrationTarget=ref(''),migrationCheck=ref<{ok:boolean;error?:string;bytes:number;freeBytes:number}|null>(null),migrationConfirmed=ref(false),migrating=ref(false),restartRequired=ref(false)
const formatSize=(n:number)=>n<1024*1024?`${Math.ceil(n/1024)} KB`:`${(n/1024/1024).toFixed(1)} MB`
const migrationText=computed(()=>migrationCheck.value?.ok?`可迁移 ${formatSize(migrationCheck.value.bytes)}，目标磁盘剩余 ${formatSize(migrationCheck.value.freeBytes)}`:migrationCheck.value?.error??'')
async function chooseDataDir(){const r=await window.api.settings.selectDataDir();if(r.canceled)return;migrationTarget.value=r.path;migrationConfirmed.value=false;migrationCheck.value=await window.api.settings.inspectDataMigration(r.path)}
async function migrateNow(){if(!migrationConfirmed.value)return;migrating.value=true;try{const r=await window.api.settings.migrateData(migrationTarget.value);restartRequired.value=!!r.ok}catch(e){migrationCheck.value={ok:false,error:(e as Error).message,bytes:0,freeBytes:0}}finally{migrating.value=false}}
function restartApp(){void window.api.settings.restart()}
</script>

<style scoped>
.settings { max-width: 720px; }
.card > h3 { margin-bottom: 4px; }

/* 主题选择 */
.theme-picker { display: flex; gap: 12px; flex-wrap: wrap; }
.theme-opt {
  flex-direction: column; gap: 8px; padding: 8px;
  border: 1px solid var(--border-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--text-2);
}
.theme-opt:hover { border-color: var(--text-3); }
.theme-opt.on { border-color: var(--accent); background: var(--accent-weak); color: var(--accent-text); }
.preview {
  display: flex; width: 108px; height: 62px; overflow: hidden;
  border-radius: var(--r-sm); border: 1px solid rgba(0, 0, 0, 0.12);
}
.preview .p-side { width: 26px; }
.preview .p-main { flex: 1; padding: 9px 8px; display: flex; flex-direction: column; gap: 5px; }
.preview .p-main i { display: block; height: 5px; border-radius: 2px; }
.preview .p-main i:nth-child(1) { width: 70%; }
.preview .p-main i:nth-child(2) { width: 90%; opacity: 0.55; }
.preview .p-main i:nth-child(3) { width: 45%; opacity: 0.35; }
.preview.light { background: #f6f5f2; }
.preview.light .p-side { background: #ffffff; border-right: 1px solid #e4e1da; }
.preview.light .p-main i { background: #5546d0; }
.preview.dark { background: #0f1013; }
.preview.dark .p-side { background: #17181c; border-right: 1px solid #26282e; }
.preview.dark .p-main i { background: #a99bff; }
.preview.system { background: linear-gradient(100deg, #f6f5f2 0 50%, #0f1013 50% 100%); }
.preview.system .p-side { background: linear-gradient(180deg, #ffffff 0 50%, #17181c 50% 100%); border-right: 1px solid #9a9a9a; }
.preview.system .p-main i { background: #8a7ee8; }
.t-name { font-size: 12.5px; }

.path {
  display: block; font-size: 11.5px; color: var(--text-2);
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--r); padding: 7px 10px; word-break: break-all;
}
.migration-box{margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface-2)}
</style>
