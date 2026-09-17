<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">知识库</h1>
      <p class="page-sub">收录资料，写下原因与感受</p>
    </div>

    <div class="kb-toolbar">
      <p class="hint">
        支持 Markdown / 网页 / Word / PPT / Excel。收录时可写下原因，读完可记录感受；AI 总结与延伸只在你点按钮时进行。
      </p>
      <button class="secondary" @click="creatingFolder = true">
        <Icon name="plus" :size="15" />新建文件夹
      </button>
      <button class="secondary" :disabled="importingConversations" @click="importConversations">
        <Icon name="inbox" :size="15" />{{ importingConversations ? '导入中…' : '导入 AI 对话' }}
      </button>
    </div>
    <p v-if="importMessage" :class="importOk ? 'msg ok' : 'msg err'">{{ importMessage }}</p>

    <div class="kb-body">
      <!-- 文件夹列表 -->
      <aside class="folders card">
        <div class="section-label">文件夹</div>
        <div
          v-for="f in folders"
          :key="f.id"
          class="folder"
          :class="{ on: currentFolder?.id === f.id }"
          @click="selectFolder(f)"
        >
          <Icon name="folder" :size="16" />
          <span class="f-name">{{ f.name }}</span>
          <button v-if="f.system_key !== AI_QUICK_CAPTURE_FOLDER_KEY" class="ghost icon-btn" title="删除文件夹" @click.stop="removeFolder(f)">
            <Icon name="trash" :size="14" />
          </button>
        </div>
        <div v-if="!folders.length" class="arch-empty">还没有文件夹</div>

        <div v-if="creatingFolder" class="new-folder">
          <input v-model="newFolderName" placeholder="文件夹名" :aria-invalid="!!newFolderError" @input="folderMessage = ''" @keyup.enter="createFolder" />
          <p v-if="newFolderError || folderMessage" class="msg err folder-error">{{ newFolderError || folderMessage }}</p>
          <div class="row" style="margin-top: 8px">
            <button class="primary small" :disabled="!!newFolderError" @click="createFolder">创建</button>
            <button class="ghost small" @click="cancelCreateFolder">取消</button>
          </div>
        </div>
      </aside>

      <!-- 资料列表 -->
      <section class="items">
        <template v-if="currentFolder">
          <div class="items-toolbar">
            <h3>{{ currentFolder.name }}</h3>
            <div v-if="!isAiQuickCaptureFolder" class="row">
              <button class="secondary small" :disabled="importingFiles" @click="importFiles">
                <Icon name="inbox" :size="15" />{{ importingFiles ? '导入中…' : '导入文件' }}
              </button>
              <button class="secondary small" @click="creatingItem = true">
                <Icon name="pen" :size="15" />手动添加资料
              </button>
              <button class="primary small" :disabled="extending" @click="extendFolder">
                <Icon name="sparkles" :size="15" />
                {{ extending ? 'AI 延伸中…' : 'AI 延伸' }}
              </button>
            </div>
            <span v-else class="system-folder-note">仅 AI 快速记录可写入</span>
          </div>

          <p v-if="fileImportMessage" :class="fileImportOk ? 'msg ok' : 'msg err'">{{ fileImportMessage }}</p>

          <div v-if="extendResult" class="card accent">
            <h3>AI 延伸结果</h3>
            <pre class="ai-text">{{ extendResult }}</pre>
            <div class="row">
              <button class="secondary small" @click="saveExtendAsItem">存为新资料</button>
              <button class="ghost small" @click="extendResult = ''">关闭</button>
            </div>
          </div>

          <article v-for="it in items" :key="it.id" class="item card" @click="openItem(it)">
            <div class="item-head">
              <span class="tag">{{ typeLabel(it.source_type) }}</span>
              <strong>{{ it.title }}</strong>
              <button class="ghost icon-btn" title="删除" @click.stop="removeItem(it)">
                <Icon name="trash" :size="14" />
              </button>
            </div>
            <p v-if="it.reason" class="reason">收录原因：{{ it.reason }}</p>
            <p v-if="it.reflection" class="reflection">我的感受：{{ it.reflection }}</p>
            <p v-if="it.ai_summary" class="summary">AI 摘要：{{ it.ai_summary.slice(0, 120) }}{{ it.ai_summary.length > 120 ? '…' : '' }}</p>
          </article>
          <div v-if="!items.length" class="empty">
            <h3>这个文件夹还是空的</h3>
            <p>{{ isAiQuickCaptureFolder ? '在记录页面保存 AI 快速记录后，资料会出现在这里。' : '导入文件或手动添加一条资料。' }}</p>
          </div>
        </template>

        <div v-else class="empty">
          <h3>选择一个文件夹</h3>
          <p>或者新建一个，开始收集值得留下的内容。</p>
        </div>
      </section>
    </div>

    <!-- 手动添加资料 -->
    <div v-if="creatingItem" class="drawer-mask" @click.self="creatingItem = false">
      <div class="drawer">
        <div class="drawer-head">
          <h3 style="margin: 0">手动添加资料</h3>
          <button class="close" @click="creatingItem = false"><Icon name="close" :size="16" /></button>
        </div>
        <div class="field">
          <label>标题（必填）</label>
          <input v-model="newItem.title" placeholder="如：纸上得来终觉浅" />
        </div>
        <div class="field">
          <label>内容（Markdown，必填）</label>
          <textarea v-model="newItem.body" rows="8" placeholder="粘贴或撰写内容…" />
        </div>
        <div class="field">
          <label>收录原因（可选，留给未来的自己）</label>
          <input v-model="newItem.reason" placeholder="如：提醒自己重实践" />
        </div>
        <div class="row">
          <button class="primary" :disabled="!newItem.title.trim() || !newItem.body.trim()" @click="createItem">保存</button>
          <button class="ghost" @click="creatingItem = false">取消</button>
        </div>
        <p v-if="itemMessage" :class="itemOk ? 'msg ok' : 'msg err'">{{ itemMessage }}</p>
      </div>
    </div>

    <!-- 资料详情 -->
    <div v-if="detail" class="drawer-mask" @click.self="detail = null">
      <div class="drawer wide">
        <div class="drawer-head">
          <span class="tag">{{ typeLabel(detail.source_type) }}</span>
          <strong class="detail-title">{{ detail.title }}</strong>
          <button class="close" @click="detail = null"><Icon name="close" :size="16" /></button>
        </div>
        <div v-if="detail.file_path" class="hint path">{{ detail.file_path }}</div>

        <div class="field">
          <label>内容（可编辑）</label>
          <textarea v-model="detailBody" rows="10" />
        </div>
        <div class="field">
          <label>收录原因（可编辑）</label>
          <input v-model="detailReason" />
        </div>
        <div class="row" style="margin-bottom: 14px">
          <button class="primary small" @click="saveDetail">保存修改</button>
          <button class="secondary small" :disabled="summarizing" @click="summarize">
            <Icon name="sparkles" :size="15" />
            {{ summarizing ? 'AI 总结中…' : 'AI 一键总结' }}
          </button>
          <span v-if="detailMessage" :class="detailOk ? 'msg ok inline' : 'msg err inline'">{{ detailMessage }}</span>
        </div>

        <div v-if="detail.ai_summary" class="card accent">
          <h3>AI 总结</h3>
          <pre class="ai-text">{{ detail.ai_summary }}</pre>
        </div>

        <div class="field">
          <label>我的感受（你自己的话，AI 不会代写）</label>
          <textarea v-model="detailReflection" rows="3" placeholder="这份资料让你想到了什么？" />
        </div>
        <button class="primary small" @click="saveReflection">保存感受</button>
        <span v-if="reflectionMessage" :class="reflectionOk ? 'msg ok inline' : 'msg err inline'" style="margin-left: 8px">{{ reflectionMessage }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, reactive } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '../components/Icon.vue'

const AI_QUICK_CAPTURE_FOLDER_KEY = 'ai_quick_capture'

interface KbFolder {
  id: number
  name: string
  description: string
  system_key: string | null
  created_at: string
}
interface KbItem {
  id: number
  folder_id: number
  title: string
  source_type: string
  body: string
  file_path: string
  reason: string
  reflection: string
  ai_summary: string
  source_entry_id: number | null
  import_key: string | null
  created_at: string
  updated_at: string
}

const folders = ref<KbFolder[]>([])
const route = useRoute()
const currentFolder = ref<KbFolder | null>(null)
const items = ref<KbItem[]>([])

const creatingFolder = ref(false)
const newFolderName = ref('')
const folderMessage = ref('')
const creatingItem = ref(false)
const newItem = reactive({ title: '', body: '', reason: '' })
const itemMessage = ref('')
const itemOk = ref(false)

const detail = ref<KbItem | null>(null)
const detailBody = ref('')
const detailReason = ref('')
const detailReflection = ref('')
const detailMessage = ref('')
const detailOk = ref(false)
const reflectionMessage = ref('')
const reflectionOk = ref(false)
const summarizing = ref(false)

const extending = ref(false)
const extendResult = ref('')
const importingConversations = ref(false)
const importMessage = ref('')
const importOk = ref(false)
const importingFiles = ref(false)
const fileImportMessage = ref('')
const fileImportOk = ref(false)
const isAiQuickCaptureFolder = computed(() => currentFolder.value?.system_key === AI_QUICK_CAPTURE_FOLDER_KEY)
const newFolderError = computed(() => {
  const name = newFolderName.value.trim()
  if (!name) return '请输入文件夹名'
  if (name.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase() === 'ai快速记录'.toLocaleLowerCase()) {
    return '“AI 快速记录”是系统保留名称'
  }
  return ''
})

const TYPE_LABELS: Record<string, string> = {
  markdown: 'Markdown',
  md: 'Markdown',
  txt: '文本',
  html: '网页',
  htm: '网页',
  docx: 'Word',
  pptx: 'PPT',
  xlsx: 'Excel',
  'ai-conversation': 'AI 对话',
  entry: 'AI 记录'
}
function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? t
}

async function loadFolders(): Promise<void> {
  folders.value = await window.api.kb.listFolders()
  if (currentFolder.value) {
    const previousId = currentFolder.value.id
    const replacement = currentFolder.value.system_key
      ? folders.value.find(folder => folder.system_key === currentFolder.value?.system_key)
      : folders.value.find(folder => folder.id === currentFolder.value?.id)
    currentFolder.value = replacement ?? null
    if (!replacement) items.value = []
    else if (replacement.id !== previousId) items.value = await window.api.kb.listItems(replacement.id)
  }
}

async function selectFolder(f: KbFolder): Promise<void> {
  currentFolder.value = f
  extendResult.value = ''
  fileImportMessage.value = ''
  items.value = await window.api.kb.listItems(f.id)
}

async function createFolder(): Promise<void> {
  if (newFolderError.value) return
  folderMessage.value = ''
  try {
    const r = await window.api.kb.addFolder(newFolderName.value)
    if (r.ok) {
      cancelCreateFolder()
      await loadFolders()
    } else {
      folderMessage.value = r.error || '创建失败'
    }
  } catch (error) {
    folderMessage.value = error instanceof Error ? error.message : '创建失败'
  }
}

function cancelCreateFolder(): void {
  creatingFolder.value = false
  newFolderName.value = ''
  folderMessage.value = ''
}

async function removeFolder(f: KbFolder): Promise<void> {
  if (!confirm(`删除文件夹「${f.name}」及其全部资料？不可恢复。`)) return
  await window.api.kb.deleteFolder(f.id)
  if (currentFolder.value?.id === f.id) {
    currentFolder.value = null
    items.value = []
  }
  await loadFolders()
}

async function createItem(): Promise<void> {
  if (!currentFolder.value || !newItem.title.trim() || !newItem.body.trim()) return
  itemMessage.value = ''
  const r = await window.api.kb.addItem(
    currentFolder.value.id,
    { title: newItem.title.trim(), sourceType: 'markdown', reason: newItem.reason },
    newItem.body.trim()
  )
  if (r.ok) {
    itemOk.value = true
    creatingItem.value = false
    newItem.title = ''
    newItem.body = ''
    newItem.reason = ''
    items.value = await window.api.kb.listItems(currentFolder.value.id)
  } else {
    itemOk.value = false
    itemMessage.value = r.error || '保存失败'
  }
}

async function importFiles(): Promise<void> {
  if (!currentFolder.value || isAiQuickCaptureFolder.value) return
  importingFiles.value = true
  fileImportMessage.value = ''
  try {
    const r = await window.api.kb.importFiles(currentFolder.value.id)
    if (r.canceled) return
    if (r.ok) {
      fileImportOk.value = true
      const failed = r.failures?.length ?? 0
      fileImportMessage.value = failed
        ? `成功导入 ${r.imported} 个文件，${failed} 个文件失败：${r.failures.map((failure: { fileName: string; error: string }) => `${failure.fileName}（${failure.error}）`).join('；')}`
        : `成功导入 ${r.imported} 个文件。`
      items.value = await window.api.kb.listItems(currentFolder.value.id)
    } else {
      fileImportOk.value = false
      fileImportMessage.value = `导入失败：${r.error || '无法读取文件'}`
    }
  } catch (error) {
    fileImportOk.value = false
    fileImportMessage.value = `导入失败：${error instanceof Error ? error.message : '无法读取文件'}`
  } finally {
    importingFiles.value = false
  }
}

async function importConversations(): Promise<void> {
  importingConversations.value = true
  importMessage.value = ''
  try {
    const r = await window.api.import.exportZip()
    if (r.ok && r.summary) {
      importOk.value = true
      importMessage.value = `导入完成：${r.summary.knowledgeItems} 个完整会话进入知识库，时间线新增 ${r.summary.timelineSummaries} 条摘要，跳过 ${r.summary.skipped} 个重复会话。`
      await loadFolders()
      const folder = folders.value.find(f => f.system_key === 'ai_conversation_import')
      if (folder) await selectFolder(folder)
    } else if (!r.canceled) {
      importOk.value = false
      importMessage.value = `导入失败：${r.error || '无法读取文件'}`
    }
  } finally { importingConversations.value = false }
}

function openItem(it: KbItem): void {
  detail.value = it
  detailBody.value = it.body
  detailReason.value = it.reason
  detailReflection.value = it.reflection
  detailMessage.value = ''
  reflectionMessage.value = ''
}

async function saveDetail(): Promise<void> {
  if (!detail.value) return
  detailMessage.value = ''
  detailOk.value = false
  try {
    const result = await window.api.kb.updateItem(detail.value.id, { body: detailBody.value, reason: detailReason.value })
    const saved = result.item as KbItem | null | undefined
    if (!result.ok || !saved) {
      detailMessage.value = result.error || '保存修改失败'
      return
    }
    if (saved.body !== detailBody.value || saved.reason !== detailReason.value) {
      detailMessage.value = '保存结果校验失败，请重试'
      return
    }
    detail.value = saved
    detailOk.value = true
    detailMessage.value = '修改已保存 ✓'
    await refreshList()
  } catch (error) {
    detailMessage.value = error instanceof Error ? error.message : '保存修改失败'
  }
}

async function saveReflection(): Promise<void> {
  if (!detail.value) return
  reflectionMessage.value = ''
  reflectionOk.value = false
  try {
    const result = await window.api.kb.updateReflection(detail.value.id, detailReflection.value)
    const saved = result.item as KbItem | null | undefined
    if (!result.ok || !saved) {
      reflectionMessage.value = result.error || '保存感受失败'
      return
    }
    if (saved.reflection !== detailReflection.value) {
      reflectionMessage.value = '保存结果校验失败，请重试'
      return
    }
    detail.value = saved
    reflectionOk.value = true
    reflectionMessage.value = '感受已保存 ✓'
    await refreshList()
  } catch (error) {
    reflectionMessage.value = error instanceof Error ? error.message : '保存感受失败'
  }
}

async function summarize(): Promise<void> {
  if (!detail.value) return
  summarizing.value = true
  try {
    const r = await window.api.kb.summarize(detail.value.id)
    if (r.ok && r.summary) {
      detail.value.ai_summary = r.summary
    } else {
      alert(`总结失败：${r.error}`)
    }
  } finally {
    summarizing.value = false
  }
}

async function extendFolder(): Promise<void> {
  if (!currentFolder.value) return
  extending.value = true
  extendResult.value = ''
  try {
    const r = await window.api.kb.extend(currentFolder.value.id)
    if (r.ok && r.text) {
      extendResult.value = r.text
    } else {
      alert(`延伸失败：${r.error}`)
    }
  } finally {
    extending.value = false
  }
}

async function saveExtendAsItem(): Promise<void> {
  if (!currentFolder.value || !extendResult.value) return
  await window.api.kb.addItem(
    currentFolder.value.id,
    {
      title: `AI 延伸 ${new Date().toLocaleDateString('zh-CN')}`,
      sourceType: 'markdown',
      reason: 'AI 延伸结果（用户确认保存）'
    },
    extendResult.value
  )
  extendResult.value = ''
  items.value = await window.api.kb.listItems(currentFolder.value.id)
}

async function removeItem(it: KbItem): Promise<void> {
  if (!confirm(`删除资料「${it.title}」？不可恢复。`)) return
  await window.api.kb.deleteItem(it.id)
  if (detail.value?.id === it.id) detail.value = null
  await refreshList()
}

async function refreshList(): Promise<void> {
  if (currentFolder.value) items.value = await window.api.kb.listItems(currentFolder.value.id)
}

onMounted(async () => {
  await loadFolders()
  const itemId = Number(route.query.itemId)
  if (itemId > 0) {
    const item = await window.api.kb.getItem(itemId)
    if (!item) { importOk.value = false; importMessage.value = '对应的知识资料已被删除。'; return }
    const folder = folders.value.find(f => f.id === item.folder_id)
    if (folder) { await selectFolder(folder); openItem(item) }
  }
})
</script>

<style scoped>
.kb-toolbar {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 14px; margin-bottom: 16px;
}
.kb-toolbar .hint { max-width: 640px; }
.kb-body { display: flex; gap: 18px; align-items: flex-start; }

.folders { width: 220px; flex: 0 0 220px; padding: 14px; }
.folder {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: var(--r);
  cursor: pointer; color: var(--text-2); font-size: 13.5px;
}
.folder:hover { background: var(--surface-2); color: var(--text); }
.folder.on { background: var(--accent-weak); color: var(--accent-text); font-weight: 600; }
.f-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder .icon-btn { opacity: 0; }
.folder:hover .icon-btn, .folder.on .icon-btn { opacity: 1; }
.arch-empty { font-size: 12.5px; color: var(--text-3); padding: 8px 10px; }
.new-folder { padding: 8px 4px 2px; }

.items { flex: 1; min-width: 0; }
.items-toolbar {
  display: flex; justify-content: space-between; align-items: center;
  gap: 10px; flex-wrap: wrap; margin-bottom: 12px;
}
.items-toolbar h3 { margin: 0; font-size: 15px; }
.system-folder-note { color: var(--text-3); font-size: 12.5px; }
.folder-error { margin: 6px 0 0; font-size: 12px; }

.item { cursor: pointer; }
.item:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); }
.item-head { display: flex; align-items: center; gap: 8px; }
.item-head strong { flex: 1; font-size: 14px; }
.item-head .icon-btn { opacity: 0; }
.item:hover .icon-btn { opacity: 1; }
.reason { color: var(--warn); font-size: 12.5px; margin: 6px 0 0; }
.reflection { color: var(--ok); font-size: 12.5px; margin: 4px 0 0; }
.summary { color: var(--text-3); font-size: 12.5px; margin: 4px 0 0; }

.ai-text {
  font-family: var(--font-sans); white-space: pre-wrap; word-break: break-word;
  margin: 0 0 10px; font-size: 13.5px; line-height: 1.7;
}
.detail-title { font-size: 15px; flex: 1; }
.path {
  font-family: var(--font-mono); font-size: 11.5px;
  word-break: break-all; margin-bottom: 14px;
}

@media (max-width: 820px) {
  .kb-body { flex-direction: column; }
  .folders { width: 100%; flex: none; }
}
</style>
