<template>
  <aside class="folders card">
    <div class="section-label">文件夹</div>

    <button
      class="nav-order-toggle"
      :class="{ on: reorderMode }"
      :title="reorderMode ? '完成顺序调整' : '调整文件夹顺序'"
      :disabled="busy || folders.length < 2"
      @click="toggleReorder"
    >
      <Icon name="grip-vertical" :size="15" />
      <span>{{ reorderMode ? '完成调整' : '调整顺序' }}</span>
    </button>
    <p v-if="reorderMode" class="hint reorder-hint">按住文件夹不放即可上下拖动，松手就保存；也能用方向键 ↑ ↓ 微调。</p>

    <div class="folder-list" :class="{ arranging: reorderMode }">
      <div
        v-for="(f, index) in arranged"
        :key="f.id"
        class="folder"
        :data-folder-id="f.id"
        :class="{
          on: !reorderMode && f.id === currentId,
          pressing: pressingId === f.id,
          dragging: draggingId === f.id
        }"
        :tabindex="reorderMode ? 0 : undefined"
        :aria-label="reorderMode ? `文件夹 ${f.name}，第 ${index + 1} 个，共 ${arranged.length} 个` : undefined"
        :title="reorderMode ? '长按后上下移动' : undefined"
        @pointerdown="startHold($event, f.id)"
        @pointermove="dragFolder"
        @pointerup="endHold"
        @pointercancel="endHold"
        @click="onRowClick(f)"
        @keydown.up.prevent="nudge(index, -1)"
        @keydown.down.prevent="nudge(index, 1)"
        @keydown.escape="exitReorder"
      >
        <Icon :name="isSystem(f) ? 'lock' : 'folder'" :size="16" />
        <div class="f-main">
          <template v-if="editingId === f.id">
            <input
              ref="editInput"
              v-model="editName"
              class="f-edit"
              aria-label="文件夹名称"
              :aria-invalid="!!editError"
              placeholder="文件夹名"
              @keyup.enter="commitRename(f)"
              @keyup.escape="cancelRename"
            />
            <input
              v-model="editDescription"
              class="f-edit f-edit-desc"
              aria-label="文件夹说明"
              placeholder="说明（可选）"
              @keyup.enter="commitRename(f)"
              @keyup.escape="cancelRename"
            />
            <p v-if="editError" class="msg err folder-error">{{ editError }}</p>
            <div class="row f-edit-actions">
              <button class="primary small" :disabled="!!editError || !editName.trim()" @click.stop="commitRename(f)">确认</button>
              <button class="ghost small" @click.stop="cancelRename">取消</button>
            </div>
          </template>
          <template v-else>
            <span class="f-name">{{ f.name }}</span>
            <div v-if="!reorderMode && f.tags?.length" class="f-meta">
              <span v-for="tag in visibleTags(f.tags)" :key="tag" class="tag f-tag">{{ tag }}</span>
              <span v-if="f.tags.length > 2" class="tag f-tag">+{{ f.tags.length - 2 }}</span>
            </div>
          </template>
        </div>

        <span v-if="isSystem(f) && !reorderMode" class="tag accent pinned-tag" :title="pinnedTitle(f)">固定</span>
        <div v-if="!reorderMode && !editingId" class="f-actions">
          <button
            v-if="canRename(f)"
            class="ghost icon-btn"
            title="重命名"
            aria-label="重命名文件夹"
            @click.stop="startRename(f)"
          ><Icon name="pen" :size="13" /></button>
          <button
            v-if="!isSystem(f)"
            class="ghost icon-btn"
            title="删除文件夹"
            aria-label="删除文件夹"
            @click.stop="emit('remove', f)"
          ><Icon name="trash" :size="13" /></button>
        </div>
        <Icon v-if="reorderMode" class="drag-handle" name="grip-vertical" :size="15" />
      </div>
    </div>

    <div v-if="!folders.length" class="arch-empty">还没有文件夹</div>
    <p v-else-if="!reorderMode && isSystem(current)" class="system-hint">带锁的文件夹由程序维护，不能删除。</p>

    <div v-if="creating" class="new-folder">
      <input
        ref="createInput"
        v-model="draftName"
        placeholder="文件夹名"
        :aria-invalid="!!draftError"
        @keyup.enter="commitCreate"
        @keyup.escape="cancelCreate"
      />
      <p v-if="draftError" class="msg err folder-error">{{ draftError }}</p>
      <div class="row" style="margin-top: 8px">
        <button class="primary small" :disabled="!!draftError || !draftName.trim()" @click="commitCreate">创建</button>
        <button class="ghost small" @click="cancelCreate">取消</button>
      </div>
    </div>
    <button v-else-if="!reorderMode" class="secondary folder-add" :disabled="busy" @click="startCreate">
      <Icon name="plus" :size="15" />新建文件夹
    </button>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import { AI_QUICK_CAPTURE_FOLDER_KEY, isSystemFolder, type KbFolder } from '../../utils/knowledge'

/** 与左侧导航调序一致的长按门槛，两处手感必须相同 */
const HOLD_MS = 450
const CANCEL_MOVE_PX = 7

const props = defineProps<{ folders: KbFolder[]; currentId: number | null; busy?: boolean }>()
const emit = defineEmits<{
  (e: 'select', folder: KbFolder): void
  (e: 'create', name: string): void
  (e: 'rename', folder: KbFolder, name: string, description: string): void
  (e: 'remove', folder: KbFolder): void
  (e: 'reorder', orderedIds: number[]): void
}>()

const creating = ref(false)
const draftName = ref('')
const editingId = ref<number | null>(null)
const editName = ref('')
const editDescription = ref('')
const createInput = ref<unknown>(null)
const editInput = ref<unknown>(null)

const current = computed(() => props.folders.find(f => f.id === props.currentId) ?? null)

// ---------- 调序：照搬导航栏的「进入调整模式 → 长按拖动 → 松手落库」 ----------
const reorderMode = ref(false)
const arranged = ref<KbFolder[]>([])
const draggingId = ref<number | null>(null)
const pressingId = ref<number | null>(null)
let holdTimer: ReturnType<typeof setTimeout> | undefined
let pressY = 0
let activePointerId: number | null = null

watch(() => props.folders, value => {
  // 拖动中途不被外部刷新打断，否则手上的行会跳走
  if (draggingId.value) return
  arranged.value = [...value]
}, { immediate: true })

function clearHold(): void {
  if (holdTimer) clearTimeout(holdTimer)
  holdTimer = undefined
  pressingId.value = null
}

function toggleReorder(): void {
  if (props.busy) return
  reorderMode.value = !reorderMode.value
  if (!reorderMode.value) {
    clearHold()
    draggingId.value = null
  }
}
function exitReorder(): void {
  if (!reorderMode.value) return
  clearHold()
  draggingId.value = null
  reorderMode.value = false
}

function startHold(event: PointerEvent, id: number): void {
  if (!reorderMode.value || event.button !== 0 || props.busy) return
  clearHold()
  pressY = event.clientY
  activePointerId = event.pointerId
  pressingId.value = id
  // 指针可能在这一下已经抬起，捕获失败不该打断长按
  try {
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  } catch { /* 没有捕获到指针，仍可完成拖动 */ }
  holdTimer = setTimeout(() => {
    draggingId.value = id
    pressingId.value = null
  }, HOLD_MS)
}

function moveTo(targetId: number): void {
  const from = arranged.value.findIndex(f => f.id === draggingId.value)
  const to = arranged.value.findIndex(f => f.id === targetId)
  if (from < 0 || to < 0 || from === to) return
  const list = [...arranged.value]
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
  arranged.value = list
}

function dragFolder(event: PointerEvent): void {
  if (!reorderMode.value || activePointerId !== event.pointerId) return
  if (!draggingId.value) {
    // 还没到长按门槛就上下动了，说明用户是想点选而不是拖动
    if (Math.abs(event.clientY - pressY) > CANCEL_MOVE_PX) clearHold()
    return
  }
  event.preventDefault()
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-folder-id]')
  const targetId = Number(target?.dataset.folderId)
  if (!targetId || targetId === draggingId.value) return
  moveTo(targetId)
}

function endHold(event: PointerEvent): void {
  if (activePointerId !== event.pointerId) return
  const target = event.currentTarget as HTMLElement
  try {
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  } catch { /* 指针本来就没被捕获 */ }
  if (draggingId.value) emit('reorder', arranged.value.map(f => f.id))
  clearHold()
  draggingId.value = null
  activePointerId = null
}

/** 键盘通路：拖动对读屏和只有键盘的人不可用，方向键给同样的结果 */
function nudge(index: number, delta: number): void {
  const target = index + delta
  if (!reorderMode.value || target < 0 || target >= arranged.value.length) return
  const ids = arranged.value.map(f => f.id)
  const moved = ids[index]
  ids[index] = ids[target]
  ids[target] = moved
  emit('reorder', ids)
}

function onRowClick(folder: KbFolder): void {
  if (reorderMode.value || editingId.value !== null) return
  emit('select', folder)
}

onBeforeUnmount(clearHold)

/** v-for 里的模板 ref 会被收集成数组，这里两种形状都要能聚焦 */
function focusInput(handle: unknown): void {
  const target = (Array.isArray(handle) ? handle[0] : handle) as HTMLInputElement | undefined
  target?.focus()
  target?.select()
}

function isSystem(folder: KbFolder | null): boolean {
  return isSystemFolder(folder)
}
function canRename(folder: KbFolder): boolean {
  // 系统文件夹的名字由记录页与导入流程按名识别，一律不给改名
  return !folder.system_key
}
function pinnedTitle(folder: KbFolder): string {
  return folder.system_key === AI_QUICK_CAPTURE_FOLDER_KEY
    ? '系统文件夹，不可删除；里面的正文由记录页生成，不可修改'
    : '系统文件夹，由程序维护，不可删除'
}
function visibleTags(tags: string[]): string[] {
  return tags.slice(0, 2)
}

/** 与数据层同口径的保留名检查：先挡掉明显无效的名字，省一次往返 */
function folderNameIssue(name: string, taken: string[]): string {
  const clean = name.trim()
  if (!clean) return '请输入文件夹名'
  if (clean.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase() === 'ai快速记录') return '“AI 快速记录”是系统保留名称'
  if (taken.includes(clean)) return '已经有同名文件夹了'
  return ''
}
const draftError = computed(() => {
  if (!draftName.value.trim()) return ''
  return folderNameIssue(draftName.value, props.folders.filter(f => f.id !== editingId.value).map(f => f.name))
})
const editError = computed(() => {
  if (editingId.value === null) return ''
  return folderNameIssue(editName.value, props.folders.filter(f => f.id !== editingId.value).map(f => f.name))
})

function startCreate(): void {
  creating.value = true
  draftName.value = ''
  void nextTick(() => { focusInput(createInput.value) })
}
function cancelCreate(): void {
  creating.value = false
  draftName.value = ''
}
function commitCreate(): void {
  if (draftError.value || !draftName.value.trim()) return
  emit('create', draftName.value.trim())
  cancelCreate()
}

function startRename(folder: KbFolder): void {
  editingId.value = folder.id
  editName.value = folder.name
  editDescription.value = folder.description
  void nextTick(() => { focusInput(editInput.value) })
}
function cancelRename(): void {
  editingId.value = null
  editName.value = ''
  editDescription.value = ''
}
function commitRename(folder: KbFolder): void {
  if (editingId.value !== folder.id) return
  if (editError.value || !editName.value.trim()) return
  emit('rename', folder, editName.value.trim(), editDescription.value.trim())
  cancelRename()
}
</script>

<style scoped>
/* 面板本身固定：标题、调整顺序、新建文件夹都不滚动，只有文件夹列表吃中间那段 */
.folders {
  width: 250px; flex: 0 0 250px; padding: 14px; margin-bottom: 0;
  display: flex; flex-direction: column; min-height: 0;
}
.folder-list { flex: 1; min-height: 0; overflow-y: auto; }
.folder {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 7px 8px 7px 10px; border-radius: var(--r);
  cursor: pointer; color: var(--text-2); font-size: 13.5px;
}
.folder:hover { background: var(--surface-2); color: var(--text); }
.folder.on { background: var(--accent-weak); color: var(--accent-text); font-weight: 600; }
.folder > svg { margin-top: 3px; flex: 0 0 auto; }
.f-main { flex: 1; min-width: 0; }
.f-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.f-edit { width: 100%; font-size: 13px; padding: 2px 6px; }
.f-edit-desc { margin-top: 4px; font-size: 12px; }
.f-edit-actions { margin-top: 6px; gap: 6px; }
.f-meta {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  margin-top: 4px; font-weight: 400;
}
.f-tag { font-size: 10.5px; padding: 0 6px; font-weight: 400; }
.pinned-tag { font-size: 10.5px; padding: 0 6px; font-weight: 400; }
.f-actions { display: flex; gap: 1px; opacity: 0; }
.folder:hover .f-actions, .folder.on .f-actions { opacity: 1; }
.f-actions .icon-btn { padding: 2px 4px; }
.f-actions .icon-btn:disabled { opacity: 0.3; cursor: default; }
.arch-empty { font-size: 12.5px; color: var(--text-3); padding: 8px 10px; }
.system-hint { font-size: 11.5px; color: var(--text-3); margin: 8px 2px 0; }
.folder-error { margin: 6px 0 0; font-size: 12px; }
.new-folder { padding: 8px 4px 2px; }
.folder-add { width: 100%; margin-top: 10px; justify-content: center; }
.reorder-hint { font-size: 11.5px; margin: 0 2px 8px; }

/* 与 .nav-main.arranging 同一套视觉语言，两处调序手感必须看起来一样 */
.drag-handle { margin-left: auto; flex: 0 0 auto; color: var(--text-3); align-self: center; }
.folder-list.arranging .folder {
  margin: 1px 0;
  border: 1px dashed var(--border-strong);
  background: var(--surface-2);
  cursor: grab;
  touch-action: none;
  outline: none;
}
.folder-list.arranging .folder:hover { background: var(--surface-3); }
.folder-list.arranging .folder:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-weak); }
.folder-list.arranging .folder.pressing {
  border-color: var(--accent);
  background: linear-gradient(90deg, var(--accent-weak) 0 70%, var(--surface-2) 70%);
  color: var(--accent-text);
}
.folder-list.arranging .folder.dragging {
  border-style: solid;
  border-color: var(--accent);
  background: var(--accent-weak);
  color: var(--accent-text);
  box-shadow: var(--shadow-md);
  cursor: grabbing;
}

@media (max-width: 820px) {
  .folders { width: 100%; flex: none; display: block; }
  .folder-list { flex: none; overflow: visible; }
}
</style>
