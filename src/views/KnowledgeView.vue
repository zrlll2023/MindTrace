<template>
  <div class="kb-page">
    <div class="kb-head">
      <h2>知识库</h2>
      <div class="row">
        <button class="secondary" @click="creatingFolder = true">＋ 新建文件夹</button>
      </div>
    </div>
    <p class="hint">收集资料：markdown / 网页 / Word / PPT / Excel。收录时可写下原因，读完可记录感受；AI 总结与延伸只在你点按钮时进行。</p>

    <div class="kb-body">
      <!-- 文件夹列表 -->
      <aside class="folders">
        <div
          v-for="f in folders"
          :key="f.id"
          class="folder"
          :class="{ on: currentFolder?.id === f.id }"
          @click="selectFolder(f)"
        >
          <span class="f-icon">📁</span>
          <span class="f-name">{{ f.name }}</span>
          <button class="ghost small" title="删除文件夹" @click.stop="removeFolder(f)">🗑</button>
        </div>
        <div v-if="!folders.length" class="empty" style="padding: 20px 0">还没有文件夹</div>

        <div v-if="creatingFolder" class="new-folder">
          <input v-model="newFolderName" placeholder="文件夹名" @keyup.enter="createFolder" />
          <div class="row" style="margin-top: 6px">
            <button class="primary small" @click="createFolder">创建</button>
            <button class="ghost small" @click="creatingFolder = false">取消</button>
          </div>
        </div>
      </aside>

      <!-- 资料列表 -->
      <section class="items">
        <template v-if="currentFolder">
          <div class="items-toolbar">
            <h3>{{ currentFolder.name }}</h3>
            <div class="row">
              <button class="secondary" @click="importFiles">📥 导入文件</button>
              <button class="secondary" @click="creatingItem = true">✍️ 手动添加</button>
              <button class="primary" :disabled="extending" @click="extendFolder">
                {{ extending ? 'AI 延伸中…' : '✨ AI 延伸（按本夹内容）' }}
              </button>
            </div>
          </div>

          <div v-if="extendResult" class="card ai-card">
            <h3>AI 延伸结果</h3>
            <pre class="ai-text">{{ extendResult }}</pre>
            <div class="row">
              <button class="secondary small" @click="saveExtendAsItem">存为新资料</button>
              <button class="ghost small" @click="extendResult = ''">关闭</button>
            </div>
          </div>

          <div v-for="it in items" :key="it.id" class="item card" @click="openItem(it)">
            <div class="item-head">
              <span class="tag">{{ typeLabel(it.source_type) }}</span>
              <strong>{{ it.title }}</strong>
              <button class="ghost small" title="删除" @click.stop="removeItem(it)">🗑</button>
            </div>
            <p v-if="it.reason" class="reason">📌 收录原因：{{ it.reason }}</p>
            <p v-if="it.reflection" class="reflection">💭 感受：{{ it.reflection }}</p>
            <p v-if="it.ai_summary" class="summary">🤖 {{ it.ai_summary.slice(0, 120) }}{{ it.ai_summary.length > 120 ? '…' : '' }}</p>
          </div>
          <div v-if="!items.length" class="empty">这个文件夹还是空的</div>
        </template>
        <div v-else class="empty" style="margin-top: 10vh">
          <p>选择左侧文件夹，或新建一个开始收集。</p>
        </div>
      </section>
    </div>

    <!-- 手动添加资料 -->
    <div v-if="creatingItem" class="drawer-mask" @click.self="creatingItem = false">
      <div class="drawer">
        <h3>手动添加资料</h3>
        <div class="field">
          <label>标题</label>
          <input v-model="newItem.title" placeholder="如：纸上得来终觉浅" />
        </div>
        <div class="field">
          <label>内容（Markdown）</label>
          <textarea v-model="newItem.body" rows="8" placeholder="粘贴或撰写内容…" />
        </div>
        <div class="field">
          <label>收录原因（可选，留给未来的自己）</label>
          <input v-model="newItem.reason" placeholder="如：提醒自己重实践" />
        </div>
        <div class="row">
          <button class="primary" :disabled="!newItem.title.trim()" @click="createItem">保存</button>
          <button class="ghost" @click="creatingItem = false">取消</button>
        </div>
      </div>
    </div>

    <!-- 资料详情 -->
    <div v-if="detail" class="drawer-mask" @click.self="detail = null">
      <div class="drawer wide">
        <div class="drawer-head">
          <span class="tag">{{ typeLabel(detail.source_type) }}</span>
          <strong style="font-size: 15px">{{ detail.title }}</strong>
          <button class="close" @click="detail = null">✕</button>
        </div>
        <div v-if="detail.file_path" class="hint">{{ detail.file_path }}</div>

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
            {{ summarizing ? 'AI 总结中…' : '🤖 AI 一键总结' }}
          </button>
        </div>

        <div v-if="detail.ai_summary" class="ai-card card">
          <h3>AI 总结</h3>
          <pre class="ai-text">{{ detail.ai_summary }}</pre>
        </div>

        <div class="field">
          <label>我的感受（你自己的话，AI 不会代写）</label>
          <textarea v-model="detailReflection" rows="3" placeholder="这份资料让你想到了什么？" />
        </div>
        <button class="primary small" @click="saveReflection">保存感受</button>
        <span v-if="detailSaved" class="msg ok" style="margin-left: 8px">已保存 ✓</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, reactive } from 'vue'

interface KbFolder {
  id: number
  name: string
  description: string
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
  created_at: string
  updated_at: string
}

const folders = ref<KbFolder[]>([])
const currentFolder = ref<KbFolder | null>(null)
const items = ref<KbItem[]>([])

const creatingFolder = ref(false)
const newFolderName = ref('')
const creatingItem = ref(false)
const newItem = reactive({ title: '', body: '', reason: '' })

const detail = ref<KbItem | null>(null)
const detailBody = ref('')
const detailReason = ref('')
const detailReflection = ref('')
const detailSaved = ref(false)
const summarizing = ref(false)

const extending = ref(false)
const extendResult = ref('')

const TYPE_LABELS: Record<string, string> = {
  markdown: 'Markdown',
  md: 'Markdown',
  txt: '文本',
  html: '网页',
  htm: '网页',
  docx: 'Word',
  pptx: 'PPT',
  xlsx: 'Excel'
}
function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? t
}

async function loadFolders(): Promise<void> {
  folders.value = await window.api.kb.listFolders()
}

async function selectFolder(f: KbFolder): Promise<void> {
  currentFolder.value = f
  items.value = await window.api.kb.listItems(f.id)
}

async function createFolder(): Promise<void> {
  if (!newFolderName.value.trim()) return
  const r = await window.api.kb.addFolder(newFolderName.value)
  if (r.ok) {
    creatingFolder.value = false
    newFolderName.value = ''
    await loadFolders()
  }
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
  if (!currentFolder.value || !newItem.title.trim()) return
  const r = await window.api.kb.addItem(
    currentFolder.value.id,
    { title: newItem.title, sourceType: 'markdown', reason: newItem.reason },
    newItem.body
  )
  if (r.ok) {
    creatingItem.value = false
    newItem.title = ''
    newItem.body = ''
    newItem.reason = ''
    items.value = await window.api.kb.listItems(currentFolder.value.id)
  }
}

async function importFiles(): Promise<void> {
  if (!currentFolder.value) return
  const reason = prompt('这批资料收录的原因（可选，直接确定可跳过）') ?? undefined
  const r = await window.api.kb.importFiles(currentFolder.value.id, reason || undefined)
  if (r.ok) {
    items.value = await window.api.kb.listItems(currentFolder.value.id)
  }
}

function openItem(it: KbItem): void {
  detail.value = it
  detailBody.value = it.body
  detailReason.value = it.reason
  detailReflection.value = it.reflection
  detailSaved.value = false
}

async function saveDetail(): Promise<void> {
  if (!detail.value) return
  await window.api.kb.updateItem(detail.value.id, { body: detailBody.value, reason: detailReason.value })
  detail.value.body = detailBody.value
  detail.value.reason = detailReason.value
  detailSaved.value = true
  setTimeout(() => (detailSaved.value = false), 2000)
  await refreshList()
}

async function saveReflection(): Promise<void> {
  if (!detail.value) return
  await window.api.kb.updateReflection(detail.value.id, detailReflection.value)
  detail.value.reflection = detailReflection.value
  detailSaved.value = true
  setTimeout(() => (detailSaved.value = false), 2000)
  await refreshList()
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
    { title: `AI 延伸 ${new Date().toLocaleDateString('zh-CN')}`, sourceType: 'markdown', reason: 'AI 延伸结果（用户确认保存）' },
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

onMounted(loadFolders)
</script>

<style scoped>
.kb-head { display: flex; justify-content: space-between; align-items: center; }
.kb-body { display: flex; gap: 16px; margin-top: 12px; align-items: flex-start; }

.folders {
  width: 220px; flex: 0 0 220px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px; box-shadow: var(--shadow);
}
.folder {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px;
  cursor: pointer; color: var(--text-2);
}
.folder:hover { background: var(--surface-2); }
.folder.on { background: var(--accent-weak); color: var(--accent); font-weight: 600; }
.f-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.new-folder { padding: 8px 6px; }

.items { flex: 1; min-width: 0; }
.items-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.item { cursor: pointer; }
.item:hover { border-color: var(--accent); }
.item-head { display: flex; align-items: center; gap: 8px; }
.item-head strong { flex: 1; }
.reason { color: var(--warn); font-size: 12.5px; margin: 6px 0 0; }
.reflection { color: var(--ok); font-size: 12.5px; margin: 4px 0 0; }
.summary { color: var(--text-3); font-size: 12.5px; margin: 4px 0 0; }

.ai-card { background: var(--accent-weak); border-color: transparent; }
.ai-text { font-family: inherit; white-space: pre-wrap; margin: 0 0 10px; font-size: 13.5px; }

.drawer-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, .35);
  display: flex; align-items: center; justify-content: center; z-index: 50;
}
.drawer {
  width: 560px; max-width: 92vw; max-height: 86vh; overflow-y: auto;
  background: var(--surface); border-radius: 12px; padding: 20px 22px; box-shadow: 0 8px 30px rgba(0,0,0,.18);
}
.drawer.wide { width: 720px; }
.drawer-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.drawer-head .close { margin-left: auto; border: none; background: none; font-size: 16px; color: var(--text-3); cursor: pointer; }
</style>
