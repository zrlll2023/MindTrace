<template>
  <div ref="root" class="combo-field">
    <div class="combo-input" :class="{ focused: open }">
      <input
        :value="modelValue"
        :placeholder="placeholder"
        role="combobox"
        :aria-expanded="open"
        :aria-controls="menuId"
        autocomplete="off"
        @input="onInput"
        @focus="openMenu"
        @keydown="onKeydown"
      />
      <button type="button" title="选择模型" aria-label="选择模型" @click="toggle">
        <Icon name="chevron-down" :size="16" :class="{ rotated: open }" />
      </button>
    </div>
    <div v-if="open && filteredOptions.length" :id="menuId" class="combo-menu" role="listbox">
      <button
        v-for="(option, index) in filteredOptions"
        :key="option"
        type="button"
        class="combo-option"
        :class="{ selected: option === modelValue, active: index === activeIndex }"
        role="option"
        :aria-selected="option === modelValue"
        @mouseenter="activeIndex = index"
        @click="choose(option)"
      >
        <span>{{ option }}</span><Icon v-if="option === modelValue" name="check" :size="15" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{ modelValue: string; options: string[]; placeholder?: string }>(), {
  placeholder: '输入或选择模型'
})
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const activeIndex = ref(0)
const menuId = `combo-${useId()}`
const filteredOptions = computed(() => {
  const query = props.modelValue.trim().toLowerCase()
  if (!query || props.options.some(option => option === props.modelValue)) return props.options
  return props.options.filter(option => option.toLowerCase().includes(query))
})

function openMenu(): void { open.value = true; activeIndex.value = 0 }
function toggle(): void { open.value ? open.value = false : openMenu() }
function choose(value: string): void { emit('update:modelValue', value); open.value = false }
function onInput(event: Event): void { emit('update:modelValue', (event.target as HTMLInputElement).value); openMenu() }
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { open.value = false; return }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
  if (!open.value) { openMenu(); return }
  if (!filteredOptions.value.length) return
  event.preventDefault()
  if (event.key === 'ArrowDown') activeIndex.value = (activeIndex.value + 1) % filteredOptions.value.length
  if (event.key === 'ArrowUp') activeIndex.value = (activeIndex.value - 1 + filteredOptions.value.length) % filteredOptions.value.length
  if (event.key === 'Enter') choose(filteredOptions.value[activeIndex.value])
}
function closeOutside(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', closeOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOutside))
</script>

<style scoped>
.combo-field { position: relative; width: 100%; flex: 1 1 260px; min-width: 180px; }
.combo-input { display: flex; border: 1px solid var(--border-strong); border-radius: var(--r); background: var(--surface); }
.combo-input.focused { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-weak); }
.combo-input input { min-width: 0; border: 0; box-shadow: none; background: transparent; }
.combo-input input:focus { border: 0; box-shadow: none; }
.combo-input button { width: 38px; flex: 0 0 38px; padding: 0; border: 0; background: transparent; color: var(--text-3); }
.combo-input button:hover { background: var(--surface-2); color: var(--text); }
.combo-input svg { transition: transform .15s var(--ease); }
.combo-input svg.rotated { transform: rotate(180deg); }
.combo-menu {
  position: absolute; z-index: 40; top: calc(100% + 5px); left: 0; right: 0; max-height: 260px; overflow-y: auto;
  padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--r); background: var(--surface); box-shadow: var(--shadow-lg);
}
.combo-option { width: 100%; min-height: 36px; justify-content: space-between; padding: 7px 9px; border: 0; background: transparent; color: var(--text); font-weight: 400; text-align: left; }
.combo-option.active { background: var(--surface-2); }
.combo-option.selected { color: var(--accent-text); }
.combo-option span { min-width: 0; overflow-wrap: anywhere; }
</style>
