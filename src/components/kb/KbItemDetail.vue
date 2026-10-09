<template>
  <div class="drawer-mask" @click.self="requestClose">
    <div class="drawer wide detail-drawer">
      <div class="drawer-head">
        <span class="item-type">{{ typeLabel(item.source_type) }}</span>
        <template v-if="editingTitle">
          <input
            ref="titleInput"
            v-model="draftTitle"
            class="title-edit"
            aria-label="资料标题"
            :disabled="suggesting"
            @keyup.enter="confirmTitle"
            @keyup.escape="cancelTitle"
          />
        </template>
        <strong v-else class="detail-title">{{ saved.title }}</strong>
        <button v-if="!editingTitle" class="ghost small" @click="startTitleEdit">
          <Icon name="pen" :size="14" />编辑标题
        </button>
        <button class="close" aria-label="关闭" @click="requestClose"><Icon name="close" :size="16" /></button>
      </div>

      <div v-if="editingTitle" class="title-editor">
        <div class="row">
          <button class="primary small" :disabled="!titleDirty || !draftTitle.trim()" @click="confirmTitle">确认修改</button>
          <button class="secondary small" :disabled="suggesting" @click="suggestTitle">
            <Icon name="sparkles" :size="14" />{{ suggesting ? 'AI 拟定中…' : 'AI 根据正文拟定' }}
          </button>
          <button class="ghost small" @click="cancelTitle">取消</button>
        </div>
        <p class="hint title-hint">标题要你点「确认修改」才会真的改掉；确认后的标题不再被正文自动覆盖。</p>
        <p v-if="titleMessage" :class="titleOk ? 'msg ok inline' : 'msg err inline'">{{ titleMessage }}</p>
      </div>

      <div class="detail-meta">
        <span><Icon name="clock" :size="12" />收录于 {{ createdText }}</span>
        <span v-if="updatedText">· 修改于 {{ updatedText }}</span>
        <span v-if="item.file_path" class="meta-path" :title="item.file_path">· 源文件 {{ baseName(item.file_path) }}</span>
      </div>

      <div class="detail-tags">
        <span class="tags-scope"><Icon name="tag" :size="11" />资料标签</span>
        <KbTagEditor
          :tags="draftTags"
          :label="`资料「${saved.title}」`"
          :busy="tagsBusy"
          @change="saveTags"
        />
      </div>
      <p v-if="tagsError" class="msg err inline tags-error">{{ tagsError }}</p>
      <div v-if="item.file_path" class="hint path">{{ item.file_path }}</div>

      <div class="section-label body-label">
        <span>正文<span v-if="bodyLocked" class="body-lock-hint">· 由记录页生成，只读；可补充下方原因与感受</span></span>
        <div class="row body-actions">
          <label v-if="!alreadyMarkdown" class="md-toggle">
            <input v-model="asMarkdown" type="checkbox" />按 Markdown 渲染
          </label>
          <button v-if="!bodyLocked" class="ghost small" :class="{ on: mode === 'preview' }" @click="mode = mode === 'preview' ? 'source' : 'preview'">
            <Icon :name="mode === 'preview' ? 'code' : 'eye'" :size="14" />{{ mode === 'preview' ? '编辑原文' : '看预览' }}
          </button>
          <button class="ghost small" @click="copyBody"><Icon name="copy" :size="14" />复制正文</button>
          <button class="ghost small" @click="exportItem"><Icon name="download" :size="14" />导出 md</button>
        </div>
      </div>

      <MarkdownBody v-if="mode === 'preview'" :text="draftBody" :format="renderFormat" />
      <textarea
        v-else
        v-model="draftBody"
        class="body-source"
        rows="14"
        placeholder="撰写或粘贴内容，可粘贴图片…"
        @paste="onPaste"
        @drop="onDrop"
        @dragover.prevent
      />

      <p v-if="bodyMessage" :class="bodyMessageKind === 'ok' ? 'msg ok inline' : 'msg err inline'">{{ bodyMessage }}</p>

      <div class="field">
        <label>收录原因（可选，留给未来的自己）</label>
        <input v-model="draftReason" />
      </div>
      <div class="row body-save">
        <button class="primary small" :disabled="!detailDirty" @click="saveDetail">保存修改</button>
        <button class="secondary small" :disabled="summarizing" @click="summarize">
          <Icon name="sparkles" :size="15" />{{ summarizing ? 'AI 总结中…' : 'AI 一键总结' }}
        </button>
        <span v-if="!detailDirty && !bodyMessage" class="hint quiet-hint">没有改动可保存</span>
      </div>

      <div v-if="summary" class="card accent">
        <h3>AI 总结</h3>
        <pre class="ai-text">{{ summary }}</pre>
      </div>

      <div class="field">
        <label>我的感受（你自己的话，AI 不会代写）</label>
        <textarea v-model="draftReflection" rows="3" placeholder="这份资料让你想到了什么？" />
      </div>
      <div class="row body-save">
        <button class="primary small" :disabled="!reflectionDirty" @click="saveReflection">保存感受</button>
        <span v-if="reflectionMessage" :class="reflectionOk ? 'msg ok inline' : 'msg err inline'">{{ reflectionMessage }}</span>
        <span v-else-if="!reflectionDirty" class="hint quiet-hint">没有改动可保存</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import Icon from '../Icon.vue'
import MarkdownBody from './MarkdownBody.vue'
import KbTagEditor from './KbTagEditor.vue'
import { renderFormatFor } from '../../utils/kb-render'
import { itemTags, typeLabel, type KbItem } from '../../utils/knowledge'
import { formatSqlDateTime } from '../../utils/datetime'

const props = defineProps<{ item: KbItem; bodyLocked: boolean }>()
const emit = defineEmits<{
  (e: 'closed'): void
  (e: 'changed'): void
}>()

const saved = ref<KbItem>(props.item)
const draftBody = ref(props.item.body)
const draftReason = ref(props.item.reason)
const draftReflection = ref(props.item.reflection)
const draftTitle = ref(props.item.title)
const draftTags = ref<string[]>(itemTags(props.item))
const tagsBusy = ref(false)
const tagsError = ref('')
const summary = ref(props.item.ai_summary)
const mode = ref<'preview' | 'source'>('preview')
const asMarkdown = ref(false)

const editingTitle = ref(false)
const titleInput = ref<unknown>(null)
const titleMessage = ref('')
const titleOk = ref(false)
const suggesting = ref(false)

const bodyMessage = ref('')
const bodyMessageKind = ref<'ok' | 'err'>('ok')
const reflectionMessage = ref('')
const reflectionOk = ref(false)
const summarizing = ref(false)

const renderFormat = computed(() => (asMarkdown.value ? 'markdown' : renderFormatFor(saved.value.source_type)))
// 本来就是 Markdown 的资料不需要再开开关；纯文本资料才值得手动试一次
const alreadyMarkdown = computed(() => renderFormatFor(saved.value.source_type) === 'markdown')

const detailDirty = computed(() => draftBody.value !== saved.value.body || draftReason.value !== saved.value.reason)
const reflectionDirty = computed(() => draftReflection.value !== saved.value.reflection)
const titleDirty = computed(() => draftTitle.value.trim() !== saved.value.title)
const dirty = computed(() => detailDirty.value || reflectionDirty.value || titleDirty.value)

const createdText = computed(() => formatSqlDateTime(saved.value.created_at) || '时间未知')
const updatedText = computed(() => {
  const updated = saved.value.updated_at
  if (!updated || updated === saved.value.created_at) return ''
  return formatSqlDateTime(updated)
})

function baseName(filePath: string): string {
  return String(filePath).split(/[\\/]/).pop() ?? filePath
}

function requestClose(): void {
  if (dirty.value && !confirm('还有未保存的改动，确定关闭？')) return
  emit('closed')
}

async function saveDetail(): Promise<void> {
  if (!detailDirty.value) return
  bodyMessage.value = ''
  // 只读资料连正文都不提交，避免把同一份正文当改动送回
  const patch = props.bodyLocked
    ? { reason: draftReason.value }
    : { body: draftBody.value, reason: draftReason.value }
  try {
    const r = await window.api.kb.updateItem(saved.value.id, patch)
    if (!r.ok) {
      bodyMessageKind.value = 'err'
      bodyMessage.value = r.error || '保存修改失败'
      return
    }
    if (r.changed) {
      saved.value = r.item
      bodyMessageKind.value = 'ok'
      bodyMessage.value = '修改已保存'
      emit('changed')
    } else {
      bodyMessageKind.value = 'ok'
      bodyMessage.value = '没有需要保存的改动'
    }
  } catch (error) {
    bodyMessageKind.value = 'err'
    bodyMessage.value = error instanceof Error ? error.message : '保存修改失败'
  }
}

async function saveReflection(): Promise<void> {
  if (!reflectionDirty.value) return
  reflectionMessage.value = ''
  try {
    const r = await window.api.kb.updateReflection(saved.value.id, draftReflection.value)
    if (!r.ok) {
      reflectionOk.value = false
      reflectionMessage.value = r.error || '保存感受失败'
      return
    }
    reflectionOk.value = true
    if (r.changed) {
      saved.value = r.item
      reflectionMessage.value = '感受已保存'
      emit('changed')
    } else {
      reflectionMessage.value = '没有需要保存的改动'
    }
  } catch (error) {
    reflectionOk.value = false
    reflectionMessage.value = error instanceof Error ? error.message : '保存感受失败'
  }
}

/** 标签即时生效：回车就写，写失败只在这一行下面报错，不占用正文保存的提示位 */
async function saveTags(tags: string[]): Promise<void> {
  if (tagsBusy.value) return
  tagsBusy.value = true
  tagsError.value = ''
  try {
    const r = await window.api.kb.setItemTags(saved.value.id, tags)
    if (!r.ok || !r.item) {
      tagsError.value = r.error || '保存标签失败'
      return
    }
    saved.value = r.item
    draftTags.value = itemTags(r.item)
    if (r.changed) emit('changed')
  } catch (error) {
    tagsError.value = error instanceof Error ? error.message : '保存标签失败'
  } finally {
    tagsBusy.value = false
  }
}

function startTitleEdit(): void {
  draftTitle.value = saved.value.title
  titleMessage.value = ''
  editingTitle.value = true
  void nextTick(() => {
    const target = (Array.isArray(titleInput.value) ? titleInput.value[0] : titleInput.value) as HTMLInputElement | undefined
    target?.focus()
    target?.select()
  })
}
function cancelTitle(): void {
  editingTitle.value = false
  titleMessage.value = ''
  draftTitle.value = saved.value.title
}

async function confirmTitle(): Promise<void> {
  const title = draftTitle.value.trim()
  if (!title) {
    titleOk.value = false
    titleMessage.value = '标题不能为空'
    return
  }
  try {
    const r = await window.api.kb.setItemTitle(saved.value.id, title)
    if (!r.ok) {
      titleOk.value = false
      titleMessage.value = r.error || '保存标题失败'
      return
    }
    saved.value = r.item
    titleOk.value = true
    titleMessage.value = r.changed ? '标题已修改' : '标题没有变化，已锁定不再被正文覆盖'
    emit('changed')
    editingTitle.value = false
  } catch (error) {
    titleOk.value = false
    titleMessage.value = error instanceof Error ? error.message : '保存标题失败'
  }
}

async function suggestTitle(): Promise<void> {
  suggesting.value = true
  titleMessage.value = ''
  try {
    const r = await window.api.kb.suggestTitle(saved.value.id)
    if (r.ok) {
      draftTitle.value = r.title
      titleOk.value = true
      titleMessage.value = 'AI 给出了候选标题，确认后才会改'
    } else {
      titleOk.value = false
      titleMessage.value = r.error || '生成标题失败'
    }
  } finally {
    suggesting.value = false
  }
}

async function summarize(): Promise<void> {
  summarizing.value = true
  bodyMessage.value = ''
  try {
    const r = await window.api.kb.summarize(saved.value.id)
    if (r.ok && r.summary) {
      summary.value = r.summary
      emit('changed')
    } else {
      bodyMessageKind.value = 'err'
      bodyMessage.value = `总结失败：${r.error || '模型没有返回内容'}`
    }
  } finally {
    summarizing.value = false
  }
}

async function copyBody(): Promise<void> {
  bodyMessage.value = ''
  try {
    await navigator.clipboard.writeText(saved.value.body)
    bodyMessageKind.value = 'ok'
    bodyMessage.value = '正文已复制到剪贴板'
  } catch {
    bodyMessageKind.value = 'err'
    bodyMessage.value = '复制失败，请改用「导出 md」'
  }
}

async function exportItem(): Promise<void> {
  bodyMessage.value = ''
  try {
    const r = await window.api.kb.exportItem(saved.value.id)
    bodyMessageKind.value = r.ok ? 'ok' : 'err'
    if (r.ok) bodyMessage.value = `已导出到 ${r.path}`
    else bodyMessage.value = r.canceled ? '已取消导出' : `导出失败：${r.error}`
  } catch (error) {
    bodyMessageKind.value = 'err'
    bodyMessage.value = error instanceof Error ? error.message : '导出失败'
  }
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

async function insertImages(files: File[]): Promise<void> {
  const images = files.filter(file => file.type.startsWith('image/'))
  if (!images.length) return
  if (props.bodyLocked) {
    bodyMessageKind.value = 'err'
    bodyMessage.value = '这条资料的正文是只读的，不能插入图片'
    return
  }
  for (const file of images) {
    try {
      const dataBase64 = await fileToBase64(file)
      const r = await window.api.kb.saveImageAsset({ dataBase64, fileName: file.name || 'image.png' })
      if (!r.ok) {
        bodyMessageKind.value = 'err'
        bodyMessage.value = `图片保存失败：${r.error}`
        continue
      }
      const alt = (file.name || '图片').replace(/\.[^.]+$/, '')
      const prefix = draftBody.value && !draftBody.value.endsWith('\n') ? '\n\n' : ''
      draftBody.value = `${draftBody.value}${prefix}![${alt}](${r.url})\n`
      bodyMessageKind.value = 'ok'
      bodyMessage.value = '图片已插入，记得点「保存修改」'
    } catch (error) {
      bodyMessageKind.value = 'err'
      bodyMessage.value = error instanceof Error ? error.message : '图片保存失败'
    }
  }
}

async function onPaste(event: ClipboardEvent): Promise<void> {
  const files = Array.from(event.clipboardData?.files ?? [])
  if (!files.some(file => file.type.startsWith('image/'))) return
  event.preventDefault()
  await insertImages(files)
}

async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  await insertImages(Array.from(event.dataTransfer?.files ?? []))
}
</script>

<style scoped>
.detail-drawer { display: flex; flex-direction: column; gap: 4px; }
.detail-title { font-size: 15px; flex: 1; }
.title-edit { flex: 1; font-size: 14px; font-weight: 600; }
.title-editor { margin: -4px 0 10px; }
.title-hint { font-size: 11.5px; margin: 8px 0 0; }
.detail-meta {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: 11.5px; color: var(--text-3); margin-bottom: 8px;
}
.detail-meta span { display: inline-flex; align-items: center; gap: 4px; }
/* 类型是自动生成的元信息，用纯文字；芯片只留给用户自己贴的标签 */
.item-type { font-size: 11px; color: var(--text-3); letter-spacing: 0.02em; }
.detail-tags { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.tags-scope {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--text-3); flex: 0 0 auto;
}
.tags-error { margin: 0 0 8px; }
.path {
  font-family: var(--font-mono); font-size: 11.5px;
  word-break: break-all; margin-bottom: 10px;
}
.body-label { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.body-actions { align-items: center; gap: 4px; }
.body-actions .ghost.small.on { background: var(--accent-weak); color: var(--accent-text); }
.md-toggle { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text-3); cursor: pointer; }
/* 只读说明挂在「正文」标题后，刻意不做成方框：否则会被误读成正文本身的内容 */
.body-lock-hint { margin-left: 6px; font-size: 11px; font-weight: 400; color: var(--text-3); }
.body-source {
  min-height: 240px; font-family: var(--font-mono); font-size: 13px; line-height: 1.7;
}
.body-save { margin: 4px 0 14px; align-items: center; }
.quiet-hint { font-size: 11.5px; }
.ai-text {
  font-family: var(--font-sans); white-space: pre-wrap; word-break: break-word;
  margin: 0 0 10px; font-size: 13.5px; line-height: 1.7;
}
</style>
