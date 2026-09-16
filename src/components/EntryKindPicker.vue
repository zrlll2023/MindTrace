<template>
  <div ref="root" class="kind-picker">
    <button
      class="kind-trigger"
      type="button"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open = !open"
    >
      <span>{{ options[modelValue] }}</span>
      <span class="chevron" :class="{ open }" />
    </button>
    <div v-if="open" class="kind-menu" role="listbox">
      <button
        v-for="(label, value) in options"
        :key="value"
        type="button"
        role="option"
        :aria-selected="value === modelValue"
        :class="{ selected: value === modelValue }"
        @click="select(value as EntryKind)"
      >
        <span class="kind-dot" />{{ label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { EntryKind } from '../../electron/types'

defineProps<{
  modelValue: EntryKind
  options: Partial<Record<EntryKind, string>>
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: EntryKind] }>()
const root = ref<HTMLElement>()
const open = ref(false)

function select(value: EntryKind): void {
  emit('update:modelValue', value)
  open.value = false
}

function onOutside(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('pointerdown', onOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
</script>

<style scoped>
.kind-picker { position: relative; width: 116px; }
.kind-trigger {
  width: 100%; height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 0 9px; border: 1px solid var(--border-strong); border-radius: var(--r);
  background: var(--surface); color: var(--kc, var(--text)); font: inherit; font-size: 13px; font-weight: 600; text-align: left;
}
.kind-trigger > span:first-child { flex: 1; text-align: left; }
.kind-trigger:hover:not(:disabled) { border-color: var(--accent); }
.kind-trigger:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-weak); outline: none; }
.chevron { width: 7px; height: 7px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg) translateY(-2px); transition: transform 0.15s var(--ease); }
.chevron.open { transform: rotate(225deg) translate(-1px, -1px); }
.kind-menu {
  position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; width: 100%; box-sizing: border-box;
  padding: 4px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--surface); box-shadow: var(--shadow-lg);
}
.kind-menu button {
  width: 100%; height: 30px; display: flex; align-items: center; justify-content: flex-start; gap: 7px; padding: 0 8px;
  border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text-2);
  font: inherit; font-size: 12.5px; text-align: left;
}
.kind-menu button:hover { background: var(--surface-2); color: var(--text); }
.kind-menu button.selected { background: var(--accent-weak); color: var(--accent-text); font-weight: 600; }
</style>
