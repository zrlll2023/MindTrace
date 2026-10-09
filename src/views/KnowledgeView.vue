<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">知识库</h1>
      <p class="page-sub">收录资料，写下原因与感受</p>
    </div>

    <div class="kb-toolbar">
      <p class="hint">
        支持 Markdown / 网页 / Word / PPT / Excel。Markdown 与文本资料可直接排版预览并显示图片；文件夹能改名、加标签和排序。AI 总结与拟定标题都只在你点按钮时进行，且要你确认后才写入。
      </p>
      <button class="secondary" :disabled="importingConversations" @click="importConversations">
        <Icon name="inbox" :size="15" />{{ importingConversations ? '导入中…' : '导入 AI 对话' }}
      </button>
    </div>
    <p v-if="importMessage" :class="importOk ? 'msg ok' : 'msg err'">{{ importMessage }}</p>
    <p v-else-if="folderMessage" class="msg err">{{ folderMessage }}</p>

    <div class="kb-body">
      <KbFolderList
        :folders="folders"
        :current-id="currentFolder?.id ?? null"
        :busy="folderBusy"
        @select="selectFolder"
        @create="createFolder"
        @rename="renameFolder"
        @remove="askDeleteFolder"
        @reorder="reorderFolders"
      />

      <section class="items">
        <template v-if="currentFolder">
          <div class="items-toolbar">
            <h3>
              {{ currentFolder.name }}
              <span v-if="folderCreatedText" class="folder-created" title="文件夹的创建时间">
                <Icon name="clock" :size="12" />创建时间 {{ folderCreatedText }}
              </span>
            </h3>
            <div v-if="!isCurrentAiFolder" class="row">
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
            <span v-else class="system-folder-note">仅 AI 快速记录可写入，资料正文只读</span>
          </div>

          <div class="folder-tag-row">
            <span class="tags-scope"><Icon name="tag" :size="11" />文件夹标签</span>
            <KbTagEditor
              :tags="currentFolder.tags ?? []"
              :label="`文件夹「${currentFolder.name}」`"
              :busy="folderBusy"
              @change="saveFolderTags"
            />
          </div>

          <div class="items-scroll">
            <p v-if="fileImportMessage" :class="fileImportOk ? 'msg ok' : 'msg err'">{{ fileImportMessage }}</p>
            <p v-if="itemError" class="msg err">{{ itemError }}</p>

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
                <span class="item-type">{{ typeLabel(it.source_type) }}</span>
                <strong>{{ it.title }}</strong>
                <button class="ghost icon-btn" title="删除资料" aria-label="删除资料" @click.stop="askDeleteItem(it)">
                  <Icon name="trash" :size="14" />
                </button>
              </div>

              <div v-if="itemTags(it).length" class="item-tags">
                <span v-for="tag in itemTags(it)" :key="tag" class="tag item-tag">{{ tag }}</span>
              </div>

              <p v-if="it.reason" class="reason">收录原因：{{ it.reason }}</p>
              <p v-if="it.reflection" class="reflection">我的感受：{{ it.reflection }}</p>
              <p v-if="it.ai_summary" class="summary">AI 摘要：{{ it.ai_summary }}</p>
              <div class="item-meta">
                <span><Icon name="clock" :size="11" />{{ createdText(it) }}</span>
                <span v-if="updatedText(it)">· 修改于 {{ updatedText(it) }}</span>
                <span v-if="isItemBodyLocked(it, folders)" class="meta-locked">正文只读</span>
              </div>
            </article>
            <div v-if="!items.length" class="empty">
              <h3>这个文件夹还是空的</h3>
              <p>{{ isCurrentAiFolder ? '在记录页面保存 AI 快速记录后，资料会出现在这里。' : '导入文件或手动添加一条资料。' }}</p>
            </div>
          </div>
        </template>

        <div v-else class="items-scroll">
          <div class="empty">
            <h3>选择一个文件夹</h3>
            <p>或者新建一个，开始收集值得留下的内容。</p>
          </div>
        </div>
      </section>
    </div>

    <!-- 手动添加资料 -->
    <div v-if="creatingItem" class="drawer-mask" @click.self="creatingItem = false">
      <div class="drawer">
        <div class="drawer-head">
          <h3 style="margin: 0">手动添加资料</h3>
          <button class="close" aria-label="关闭" @click="creatingItem = false"><Icon name="close" :size="16" /></button>
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
        <p v-if="newItemError" class="msg err">{{ newItemError }}</p>
      </div>
    </div>

    <KbItemDetail
      v-if="detail"
      :key="detail.id"
      :item="detail"
      :body-locked="isDetailBodyLocked"
      @closed="detail = null"
      @changed="refreshList"
    />

    <!-- 删除确认：与记录页归档弹窗同一套视觉，不再用系统 confirm -->
    <div v-if="pendingDelete" class="drawer-mask" @click.self="closeDeleteDialog">
      <section
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kb-delete-title"
        aria-describedby="kb-delete-desc"
        @keydown.esc="closeDeleteDialog"
      >
        <div class="confirm-icon"><Icon name="trash" :size="20" /></div>
        <div class="confirm-copy">
          <h3 id="kb-delete-title">{{ pendingDelete.title }}</h3>
          <p id="kb-delete-desc">{{ pendingDelete.description }}</p>
        </div>
        <div class="confirm-actions">
          <button ref="deleteCancelButton" class="ghost" type="button" :disabled="deleting" @click="closeDeleteDialog">取消</button>
          <button class="danger" type="button" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? '正在删除…' : '删除' }}
          </button>
        </div>
      </section>
    </div>

    <transition name="toast">
      <div v-if="actionToast" class="action-toast" role="status">
        <Icon name="check" :size="15" />{{ actionToast }}
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '../components/Icon.vue'
import KbFolderList from '../components/kb/KbFolderList.vue'
import KbItemDetail from '../components/kb/KbItemDetail.vue'
import KbTagEditor from '../components/kb/KbTagEditor.vue'
import {
  isAiQuickCaptureFolder,
  isItemBodyLocked,
  itemTags,
  typeLabel,
  type KbFolder,
  type KbItem
} from '../utils/knowledge'
import { formatSqlDateTime } from '../utils/datetime'

const folders = ref<KbFolder[]>([])
const route = useRoute()
const currentFolder = ref<KbFolder | null>(null)
const items = ref<KbItem[]>([])
const folderBusy = ref(false)
// 顶部行内提示只放失败信息：错误不该几秒后自己消失
const folderMessage = ref('')
const actionToast = ref('')
let actionToastTimer: ReturnType<typeof setTimeout> | undefined

function showActionToast(message: string): void {
  actionToast.value = message
  if (actionToastTimer) clearTimeout(actionToastTimer)
  actionToastTimer = setTimeout(() => { actionToast.value = '' }, 2600)
}

onBeforeUnmount(() => {
  if (actionToastTimer) clearTimeout(actionToastTimer)
})

const creatingItem = ref(false)
const newItem = reactive({ title: '', body: '', reason: '' })
const newItemError = ref('')

const detail = ref<KbItem | null>(null)

const extending = ref(false)
const extendResult = ref('')
const importingConversations = ref(false)
const importMessage = ref('')
const importOk = ref(false)
const importingFiles = ref(false)
const fileImportMessage = ref('')
const fileImportOk = ref(false)
const itemError = ref('')

const isCurrentAiFolder = computed(() => isAiQuickCaptureFolder(currentFolder.value))
const isDetailBodyLocked = computed(() => isItemBodyLocked(detail.value, folders.value))
const folderCreatedText = computed(() => formatSqlDateTime(currentFolder.value?.created_at))

function createdText(item: KbItem): string {
  return formatSqlDateTime(item.created_at) || '收录时间未知'
}
function updatedText(item: KbItem): string {
  if (!item.updated_at || item.updated_at === item.created_at) return ''
  return formatSqlDateTime(item.updated_at)
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
  folderMessage.value = ''
  items.value = await window.api.kb.listItems(f.id)
}

/** 文件夹操作统一走这里：出错时把数据层的中文原因原样显示在顶部 */
async function runFolderAction(action: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
  folderBusy.value = true
  folderMessage.value = ''
  actionToast.value = ''
  try {
    const r = await action()
    if (!r.ok) folderMessage.value = r.error || '操作失败'
    return r.ok
  } catch (error) {
    folderMessage.value = error instanceof Error ? error.message : '操作失败'
    return false
  } finally {
    folderBusy.value = false
  }
}

async function createFolder(name: string): Promise<void> {
  if (await runFolderAction(() => window.api.kb.addFolder(name))) {
    await loadFolders()
    showActionToast(`已新建文件夹「${name}」`)
  }
}

async function renameFolder(folder: KbFolder, name: string, description: string): Promise<void> {
  if (name === folder.name && description === folder.description) return
  if (await runFolderAction(() => window.api.kb.renameFolder(folder.id, name, description))) {
    await loadFolders()
    showActionToast(`文件夹已改名为「${name}」`)
  }
}

async function setFolderTags(folder: KbFolder, tags: string[]): Promise<void> {
  if (await runFolderAction(() => window.api.kb.setFolderTags(folder.id, tags))) await loadFolders()
}

/** 工具条上的文件夹标签输入框：当前文件夹在这里取，模板不必处理 null */
async function saveFolderTags(tags: string[]): Promise<void> {
  const folder = currentFolder.value
  if (folder) await setFolderTags(folder, tags)
}

async function reorderFolders(orderedIds: number[]): Promise<void> {
  if (await runFolderAction(() => window.api.kb.reorderFolders(orderedIds))) await loadFolders()
}

/** 删除先过确认框：系统 confirm 的样式与全应用脱节，这里跟记录页归档弹窗同一套 */
interface DeleteRequest { title: string; description: string; run: () => Promise<void> }
const pendingDelete = ref<DeleteRequest | null>(null)
const deleting = ref(false)
const deleteCancelButton = ref<HTMLButtonElement>()

function askDelete(request: DeleteRequest): void {
  pendingDelete.value = request
  // 焦点放在「取消」上：回车不该等于删掉东西
  void nextTick(() => { deleteCancelButton.value?.focus() })
}

function askDeleteFolder(f: KbFolder): void {
  askDelete({
    title: `删除文件夹「${f.name}」`,
    description: '文件夹里的资料会一起删除，删除后不可恢复。',
    run: () => removeFolder(f)
  })
}

function askDeleteItem(it: KbItem): void {
  askDelete({
    title: `删除资料「${it.title}」`,
    description: '这条资料删除后不可恢复。',
    run: () => removeItem(it)
  })
}

function closeDeleteDialog(): void {
  if (deleting.value) return
  pendingDelete.value = null
}

async function confirmDelete(): Promise<void> {
  const request = pendingDelete.value
  if (!request) return
  deleting.value = true
  try {
    await request.run()
  } catch (error) {
    itemError.value = error instanceof Error ? error.message : '删除失败'
  } finally {
    deleting.value = false
    pendingDelete.value = null
  }
}

async function removeFolder(f: KbFolder): Promise<void> {
  if (!await runFolderAction(() => window.api.kb.deleteFolder(f.id))) return
  if (currentFolder.value?.id === f.id) {
    currentFolder.value = null
    items.value = []
    detail.value = null
  }
  await loadFolders()
  showActionToast(`已删除文件夹「${f.name}」`)
}

async function createItem(): Promise<void> {
  if (!currentFolder.value || !newItem.title.trim() || !newItem.body.trim()) return
  newItemError.value = ''
  const r = await window.api.kb.addItem(
    currentFolder.value.id,
    { title: newItem.title.trim(), sourceType: 'markdown', reason: newItem.reason },
    newItem.body.trim()
  )
  if (r.ok) {
    creatingItem.value = false
    newItem.title = ''
    newItem.body = ''
    newItem.reason = ''
    await refreshList()
  } else {
    newItemError.value = r.error || '保存失败'
  }
}

async function importFiles(): Promise<void> {
  if (!currentFolder.value || isCurrentAiFolder.value) return
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
  // 浅拷贝：详情里改草稿不能顺带改写列表行
  detail.value = { ...it }
  itemError.value = ''
}

async function extendFolder(): Promise<void> {
  if (!currentFolder.value) return
  extending.value = true
  extendResult.value = ''
  itemError.value = ''
  try {
    const r = await window.api.kb.extend(currentFolder.value.id)
    if (r.ok && r.text) {
      extendResult.value = r.text
    } else {
      itemError.value = `延伸失败：${r.error || '模型没有返回内容'}`
    }
  } finally {
    extending.value = false
  }
}

async function saveExtendAsItem(): Promise<void> {
  if (!currentFolder.value || !extendResult.value) return
  const r = await window.api.kb.addItem(
    currentFolder.value.id,
    {
      title: `AI 延伸 ${new Date().toLocaleDateString('zh-CN')}`,
      sourceType: 'markdown',
      reason: 'AI 延伸结果（用户确认保存）',
      action: 'extend'
    },
    extendResult.value
  )
  if (!r.ok) {
    itemError.value = r.error || '保存延伸结果失败'
    return
  }
  extendResult.value = ''
  await refreshList()
}

async function removeItem(it: KbItem): Promise<void> {
  await window.api.kb.deleteItem(it.id)
  if (detail.value?.id === it.id) detail.value = null
  await refreshList()
  showActionToast(`已删除资料「${it.title}」`)
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
.kb-toolbar .hint { max-width: 560px; }
/* 整页固定：页面撑满可用高度，滚动只发生在文件夹列表和资料列表内部 */
.page { display: flex; flex-direction: column; min-height: 0; }
.kb-body { flex: 1; min-height: 0; display: flex; gap: 18px; align-items: stretch; }

.items { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.items-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.items-toolbar {
  display: flex; justify-content: space-between; align-items: center;
  gap: 10px; flex-wrap: wrap; margin-bottom: 12px;
}
.items-toolbar h3 { margin: 0; font-size: 15px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
/* 创建时间跟在文件夹名后，刻意比标题轻一档，免得被当成名字的一部分 */
.folder-created {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 400; color: var(--text-3);
}
/* 文件夹标签在这里改；资料标签只在详情抽屉里改 */
.folder-tag-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: -4px 0 12px;
}
.system-folder-note { color: var(--text-3); font-size: 12.5px; }

.item { cursor: pointer; }
.item:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); }
.item-head { display: flex; align-items: center; gap: 8px; }
.item-head strong { flex: 1; font-size: 14px; }
.item-head .icon-btn { opacity: 0; }
.item:hover .icon-btn { opacity: 1; }
/* 类型是自动生成的元信息，用纯文字；芯片只留给用户自己贴的标签 */
.item-type {
  flex: 0 0 auto; font-size: 11px; color: var(--text-3);
  letter-spacing: 0.02em; white-space: nowrap;
}
/* 标签只在详情抽屉里编辑，卡片只负责展示已有标签 */
.item-tags {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 7px;
}
.item-tag { font-size: 10.5px; padding: 0 6px; }
.tags-scope { font-size: 10.5px; color: var(--text-3); flex: 0 0 auto; }
.reason { color: var(--warn); font-size: 12.5px; margin: 6px 0 0; }
.reflection { color: var(--ok); font-size: 12.5px; margin: 4px 0 0; }
.summary {
  color: var(--text-3); font-size: 12.5px; margin: 4px 0 0;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  line-clamp: 2; overflow: hidden;
}
.item-meta {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: 8px; font-size: 11px; color: var(--text-3);
}
.item-meta span { display: inline-flex; align-items: center; gap: 3px; }
.meta-locked { color: var(--text-2); }

.ai-text {
  font-family: var(--font-sans); white-space: pre-wrap; word-break: break-word;
  margin: 0 0 10px; font-size: 13.5px; line-height: 1.7;
}

/* 右下角成功浮窗：位置同报告页，配色同记录页的成功提示 */
.action-toast {
  position: fixed; z-index: 90; bottom: 22px; right: 26px;
  display: flex; align-items: center; gap: 8px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 10px 14px; border-radius: var(--r);
  border: 1px solid color-mix(in srgb, var(--ok) 35%, var(--border));
  background: var(--surface); color: var(--ok);
  box-shadow: var(--shadow-lg); font-size: 13px;
}
/* 确认框：与记录页 .clear-dialog 同一套尺寸与配色 */
.confirm-dialog {
  display: grid; grid-template-columns: auto 1fr; gap: 12px 14px;
  width: min(420px, calc(100vw - 32px)); padding: 20px;
  border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--surface); box-shadow: var(--shadow-lg);
}
.confirm-icon {
  display: grid; place-items: center; width: 38px; height: 38px;
  border-radius: var(--r); color: var(--danger); background: var(--danger-weak);
}
.confirm-copy h3 { margin: 1px 0 7px; font-size: 16px; }
.confirm-copy p { margin: 0; color: var(--text-2); font-size: 13px; line-height: 1.65; }
.confirm-actions {
  grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s var(--ease), transform 0.2s var(--ease); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(6px); }

@media (max-width: 820px) {
  /* 堆叠后固定高度会把两栏挤扁，这一档退回整页滚动 */
  .page { display: block; height: auto; }
  .kb-body { display: block; }
  .items { display: block; }
  .items-scroll { overflow: visible; }
  .kb-toolbar { flex-direction: column; }
}
</style>
