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
        <SelectField v-model="presetId" :options="providerOptions" @change="onPresetChange" />
        <p v-if="currentPreset?.note" class="hint">{{ currentPreset.note }}</p>
      </div>

      <div class="field">
        <label>Base URL</label>
        <input v-model="form.baseUrl" placeholder="例如 https://api.deepseek.com" />
      </div>

      <div class="field">
        <label>模型</label>
        <div class="row">
          <ComboboxField v-model="form.model" :options="models" placeholder="例如 deepseek-chat" />
          <button class="secondary" :disabled="fetchingModels" @click="onFetchModels">
            {{ fetchingModels ? '刷新中…' : '刷新账户可用模型' }}
          </button>
        </div>
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
        <SelectField v-model="searchProviderModel" :options="SEARCH_OPTIONS" />
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
      <div class="row data-actions">
        <button class="secondary" @click="store.openDataDir()"><Icon name="folder" :size="15" />打开数据目录</button>
        <button class="secondary" :disabled="restartRequired" @click="chooseDataDir"><Icon name="folder" :size="15" />更换数据目录</button>
        <button v-if="!usingDefaultDataDir" class="ghost" :disabled="restartRequired" @click="beginRestoreDefault">恢复默认目录</button>
        <button v-if="store.payload.previousDataDir" class="ghost" @click="store.openPreviousDataDir()">打开迁移前目录</button>
      </div>
      <p class="hint default-path">默认路径：{{ store.payload.defaultDataDir || '…' }}</p>
      <div v-if="migrationTarget" class="migration-box">
        <div><b>目标目录</b><code class="path">{{ migrationTarget }}</code></div>
        <p :class="migrationCheck?.ok ? 'msg ok' : 'msg err'">{{ migrationText }}</p>
        <label v-if="migrationCheck?.ok" class="checkbox"><input v-model="migrationConfirmed" type="checkbox" />我已核对目标目录，确认复制并校验全部数据</label>
        <div class="row">
          <button v-if="migrationCheck?.ok" class="primary" :disabled="!migrationConfirmed || migrating" @click="migrateNow">{{ migrating ? '迁移校验中…' : '确认迁移' }}</button>
          <button class="ghost" :disabled="migrating" @click="cancelMigrationSelection">取消本次更换</button>
        </div>
      </div>
      <div v-if="restorePending" class="migration-box">
        <b>恢复默认数据目录</b>
        <p class="hint">当前数据会复制并校验到默认路径。默认路径中的旧数据会先归档，当前目录也会保留。</p>
        <label class="checkbox"><input v-model="restoreConfirmed" type="checkbox" />我确认恢复默认目录并在完成后重启</label>
        <div class="row">
          <button class="primary" :disabled="!restoreConfirmed || migrating" @click="restoreDefaultNow">{{ migrating ? '复制校验中…' : '确认恢复' }}</button>
          <button class="ghost" :disabled="migrating" @click="cancelRestoreDefault">取消</button>
        </div>
      </div>
      <div v-if="restartRequired" class="restart-notice">
        <b>目录切换已准备完成</b><p>当前目录和目标目录均已保留。重启后启用新目录。</p>
        <div class="row"><button class="primary" @click="restartApp">立即重启</button><button class="ghost" @click="undoMigration">撤销此次更换</button></div>
      </div>

      <div class="export-location">
        <div class="field">
          <label>报告导出目录</label>
          <code class="path">{{ form.exportDirectory || '尚未设置，首次导出时询问' }}</code>
          <p class="hint">日报和周报会保存到这里。清除后，下次导出会重新询问。</p>
        </div>
        <div class="row">
          <button class="secondary" @click="chooseExportDir">
            <Icon name="folder" :size="15" />{{ form.exportDirectory ? '更改导出目录' : '选择导出目录' }}
          </button>
          <button v-if="form.exportDirectory" class="ghost" @click="clearExportDir">清除设置</button>
        </div>
        <p v-if="exportLocationMessage" :class="exportLocationOk ? 'msg ok' : 'msg err'">{{ exportLocationMessage }}</p>
      </div>
    </div>

    <div class="card">
      <h3>诊断日志</h3>
      <p class="hint">日志仅保存在本机，记录运行阶段、错误栈和版本信息，不记录 API Key、记录正文或 AI 请求内容。</p>
      <div class="row">
        <button class="secondary" @click="openLogs"><Icon name="folder" :size="15" />打开日志目录</button>
        <button class="secondary" :disabled="exportingLogs" @click="exportLogs"><Icon name="download" :size="15" />{{ exportingLogs ? '导出中…' : '导出诊断包' }}</button>
        <button v-if="!confirmClearLogs" class="ghost" @click="confirmClearLogs = true">清除旧日志</button>
      </div>
      <div v-if="confirmClearLogs" class="confirm-row">
        <span>确定清除当前诊断日志？</span><button class="danger" @click="clearLogs">确认清除</button><button class="ghost" @click="confirmClearLogs = false">取消</button>
      </div>
      <p v-if="diagnosticMessage" :class="diagnosticOk ? 'msg ok' : 'msg err'">{{ diagnosticMessage }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, reactive } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useThemeStore, ThemeMode } from '../stores/theme'
import { AppSettings, DEFAULT_SETTINGS, SearchProvider } from '../../electron/types'
import Icon from '../components/Icon.vue'
import SelectField, { SelectOption } from '../components/SelectField.vue'
import ComboboxField from '../components/ComboboxField.vue'

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
const providerOptions = computed<SelectOption[]>(() => store.presets.map(p => ({ value: p.id, label: p.name, description: p.note })))
const SEARCH_OPTIONS: SelectOption[] = [
  { value: 'none', label: '关闭', description: '仅使用本地分析' },
  { value: 'tavily', label: 'Tavily', description: '国际搜索服务' },
  { value: 'bocha', label: '博查 Bocha', description: '国内搜索服务' }
]
const searchProviderModel = computed({
  get: () => form.searchProvider,
  set: value => { form.searchProvider = value as SearchProvider }
})
const fetchingModels = ref(false)
const saving = ref(false)
const testing = ref(false)
const exportLocationMessage = ref('')
const exportLocationOk = ref(false)

onMounted(async () => {
  await store.load()
  Object.assign(form, store.payload.settings)
  restartRequired.value = !!store.payload.pendingDataDir
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
const restorePending=ref(false),restoreConfirmed=ref(false)
const usingDefaultDataDir=computed(()=>store.payload.dataDir.toLowerCase()===store.payload.defaultDataDir.toLowerCase())
const formatSize=(n:number)=>n<1024*1024?`${Math.ceil(n/1024)} KB`:`${(n/1024/1024).toFixed(1)} MB`
const migrationText=computed(()=>migrationCheck.value?.ok?`可迁移 ${formatSize(migrationCheck.value.bytes)}，目标磁盘剩余 ${formatSize(migrationCheck.value.freeBytes)}`:migrationCheck.value?.error??'')
async function chooseDataDir(){restorePending.value=false;const r=await window.api.settings.selectDataDir();if(r.canceled)return;migrationTarget.value=r.path;migrationConfirmed.value=false;migrationCheck.value=await window.api.settings.inspectDataMigration(r.path)}
async function migrateNow(){if(!migrationConfirmed.value)return;migrating.value=true;try{const r=await window.api.settings.migrateData(migrationTarget.value);if(r.ok){restartRequired.value=true;store.payload.pendingDataDir=migrationTarget.value;cancelMigrationSelection()}else migrationCheck.value={ok:false,error:r.error??'迁移失败',bytes:0,freeBytes:0}}catch(e){migrationCheck.value={ok:false,error:(e as Error).message,bytes:0,freeBytes:0}}finally{migrating.value=false}}
function cancelMigrationSelection(){migrationTarget.value='';migrationCheck.value=null;migrationConfirmed.value=false}
function beginRestoreDefault(){cancelMigrationSelection();restorePending.value=true;restoreConfirmed.value=false}
function cancelRestoreDefault(){restorePending.value=false;restoreConfirmed.value=false}
async function restoreDefaultNow(){if(!restoreConfirmed.value)return;migrating.value=true;try{const r=await window.api.settings.restoreDefaultDataDir();if(r.ok){restartRequired.value=true;store.payload.pendingDataDir=r.target;cancelRestoreDefault()}else store.show(`恢复默认目录失败：${r.error}`,false)}finally{migrating.value=false}}
async function undoMigration(){const r=await window.api.settings.undoDataMigration();if(r.ok){restartRequired.value=false;store.payload.pendingDataDir=null;store.show('已撤销目录更换，继续使用当前目录',true)}}
async function restartApp(){const r=await window.api.settings.restart();if(!r.ok)store.show(`重启前同步失败：${r.error}`,false)}

const exportingLogs=ref(false),confirmClearLogs=ref(false),diagnosticMessage=ref(''),diagnosticOk=ref(false)
function showDiagnostic(message:string,ok:boolean){diagnosticMessage.value=message;diagnosticOk.value=ok;setTimeout(()=>diagnosticMessage.value='',5000)}
async function openLogs(){const r=await window.api.diagnostics.openLogs();if(!r.ok)showDiagnostic(`无法打开日志目录：${r.error}`,false)}
async function exportLogs(){exportingLogs.value=true;try{const r=await window.api.diagnostics.export();if(r.ok)showDiagnostic(`诊断包已导出：${r.path}`,true);else if(!r.canceled)showDiagnostic(`导出失败：${r.error}`,false)}finally{exportingLogs.value=false}}
async function clearLogs(){const r=await window.api.diagnostics.clear();confirmClearLogs.value=false;showDiagnostic(r.ok?'诊断日志已清除':`清除失败：${r.error}`,!!r.ok)}

async function chooseExportDir(): Promise<void> {
  try {
    const r = await window.api.settings.selectExportDir()
    if (r.canceled) return
    form.exportDirectory = r.path
    store.payload.settings.exportDirectory = r.path
    showExportLocationMessage('报告导出目录已更新', true)
  } catch (e) {
    showExportLocationMessage(`选择导出目录失败：${(e as Error).message}`, false)
  }
}

async function clearExportDir(): Promise<void> {
  try {
    await window.api.settings.clearExportDir()
    form.exportDirectory = ''
    store.payload.settings.exportDirectory = ''
    showExportLocationMessage('已清除报告导出目录', true)
  } catch (e) {
    showExportLocationMessage(`清除导出目录失败：${(e as Error).message}`, false)
  }
}

function showExportLocationMessage(message: string, ok: boolean): void {
  exportLocationMessage.value = message
  exportLocationOk.value = ok
  setTimeout(() => (exportLocationMessage.value = ''), 5000)
}
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
.data-actions { flex-wrap: wrap; }
.default-path { margin-top: 7px; word-break: break-all; }
.restart-notice { margin-top: 12px; padding: 12px; border: 1px solid var(--accent); border-radius: var(--r-md); background: var(--accent-weak); }
.restart-notice p { color: var(--text-2); }
.confirm-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 9px 10px; border-radius: var(--r); background: var(--danger-weak); color: var(--danger); }
.confirm-row span { margin-right: auto; }
.export-location { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--border); }
.export-location .msg { margin-top: 10px; margin-bottom: 0; }
</style>
