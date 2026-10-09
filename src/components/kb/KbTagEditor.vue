<template>
  <div class="tag-editor" @click.stop>
    <span v-for="tag in tags" :key="tag" class="tag chip">
      {{ tag }}
      <button class="tag-x" :aria-label="`删除标签 ${tag}`" :disabled="busy" @click="drop(tag)">×</button>
    </span>

    <template v-if="open">
      <input
        ref="entry"
        v-model="draft"
        class="tag-entry"
        :class="{ full: limitReached }"
        :placeholder="limitReached ? `最多 ${MAX_TAG_COUNT} 个标签` : placeholder"
        :aria-label="label"
        :disabled="limitReached || busy"
        :maxlength="MAX_TAG_LENGTH + 12"
        @keyup.enter="add"
        @keyup.escape="close"
        @blur="onBlur"
      />
      <button v-if="closable" class="ghost tiny" aria-label="收起标签输入" @click="close">×</button>
    </template>
    <button
      v-else
      class="ghost tiny add"
      :aria-label="`给${label}添加标签`"
      :disabled="limitReached || busy"
      @click="openNow"
    >
      <Icon name="plus" :size="12" />{{ tags.length ? '标签' : '加标签' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import { MAX_TAG_COUNT, MAX_TAG_LENGTH } from '../../utils/knowledge'

const props = withDefaults(defineProps<{
  tags: string[]
  /** 这组标签属于谁，用于读屏与占位文案 */
  label: string
  placeholder?: string
  /** 卡片上一眼铺六个输入框太吵，默认收成一个按钮 */
  collapsed?: boolean
  busy?: boolean
}>(), {
  placeholder: '输入标签后回车',
  collapsed: false,
  busy: false
})

const emit = defineEmits<{ (e: 'change', tags: string[]): void }>()

const open = ref(!props.collapsed)
const draft = ref('')
const entry = ref<unknown>(null)

const limitReached = computed(() => props.tags.length >= MAX_TAG_COUNT)
const closable = computed(() => props.collapsed)

watch(() => props.label, () => { draft.value = '' })
watch(open, value => {
  if (value) void nextTick(() => {
    const target = (Array.isArray(entry.value) ? entry.value[0] : entry.value) as HTMLInputElement | undefined
    target?.focus()
  })
})

function openNow(): void {
  open.value = true
}
function close(): void {
  draft.value = ''
  if (props.collapsed) open.value = false
}
function onBlur(): void {
  // 输入一半点别处：丢掉草稿，别让它变成一个想不起自己加过的标签
  if (!draft.value.trim()) close()
}

function add(): void {
  const tag = draft.value.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH)
  if (!tag || limitReached.value || props.tags.includes(tag)) {
    draft.value = ''
    return
  }
  emit('change', [...props.tags, tag])
  draft.value = ''
}
function drop(tag: string): void {
  emit('change', props.tags.filter(t => t !== tag))
}
</script>

<style scoped>
.tag-editor {
  display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap;
  min-width: 0;
}
.chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 400; padding: 1px 5px 1px 8px;
}
.tag-x {
  border: none; background: none; padding: 0 1px; cursor: pointer;
  color: var(--text-3); font-size: 13px; line-height: 1;
}
.tag-x:hover:not(:disabled) { color: var(--danger); }
.tag-x:disabled, .add:disabled { opacity: 0.4; cursor: default; }
.tag-entry {
  width: 104px; height: 22px; font-size: 11.5px; padding: 0 8px;
  border-radius: var(--r-full);
  border: 1px solid var(--border-strong);
  background: var(--surface); color: var(--text);
}
.tag-entry:focus { border-color: var(--accent); outline: none; }
.tag-entry.full { background: var(--surface-2); color: var(--text-3); }
.ghost.tiny {
  display: inline-flex; align-items: center; gap: 3px;
  border: none; background: none; cursor: pointer;
  font-size: 11.5px; color: var(--text-3); padding: 2px 6px; border-radius: var(--r);
}
.ghost.tiny:hover { color: var(--accent-text); background: var(--surface-2); }
</style>
