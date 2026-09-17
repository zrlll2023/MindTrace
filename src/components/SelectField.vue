<template>
  <div ref="root" class="select-field">
    <button
      class="select-trigger"
      type="button"
      role="combobox"
      :aria-expanded="open"
      :aria-controls="menuId"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span class="select-value">{{ selected?.label ?? placeholder }}</span>
      <Icon name="chevron-down" :size="16" :class="{ rotated: open }" />
    </button>
    <div v-if="open" :id="menuId" class="select-menu" role="listbox">
      <button
        v-for="(option, index) in options"
        :key="option.value"
        type="button"
        class="select-option"
        :class="{ selected: option.value === modelValue, active: index === activeIndex }"
        role="option"
        :aria-selected="option.value === modelValue"
        @mouseenter="activeIndex = index"
        @click="choose(option.value)"
      >
        <span><b>{{ option.label }}</b><small v-if="option.description">{{ option.description }}</small></span>
        <Icon v-if="option.value === modelValue" name="check" :size="15" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import Icon from './Icon.vue'

export interface SelectOption { value: string; label: string; description?: string }

const props = withDefaults(defineProps<{ modelValue: string; options: SelectOption[]; placeholder?: string }>(), {
  placeholder: '请选择'
})
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [value: string] }>()
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const activeIndex = ref(0)
const menuId = `select-${useId()}`
const selected = computed(() => props.options.find(option => option.value === props.modelValue))

function toggle(): void {
  open.value = !open.value
  if (open.value) activeIndex.value = Math.max(0, props.options.findIndex(option => option.value === props.modelValue))
}

function choose(value: string): void {
  emit('update:modelValue', value)
  emit('change', value)
  open.value = false
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { open.value = false; return }
  if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return
  event.preventDefault()
  if (!open.value) { toggle(); return }
  if (event.key === 'ArrowDown') activeIndex.value = (activeIndex.value + 1) % props.options.length
  if (event.key === 'ArrowUp') activeIndex.value = (activeIndex.value - 1 + props.options.length) % props.options.length
  if (event.key === 'Enter' || event.key === ' ') choose(props.options[activeIndex.value].value)
}

function closeOutside(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('pointerdown', closeOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOutside))
</script>

<style scoped>
.select-field { position: relative; width: 100%; }
.select-trigger {
  width: 100%; min-height: 39px; justify-content: space-between; padding: 8px 11px;
  border: 1px solid var(--border-strong); border-radius: var(--r); background: var(--surface); color: var(--text);
  font-weight: 400; text-align: left;
}
.select-trigger:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-weak); outline: none; }
.select-trigger svg { flex: 0 0 auto; color: var(--text-3); transition: transform .15s var(--ease); }
.select-trigger svg.rotated { transform: rotate(180deg); }
.select-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.select-menu {
  position: absolute; z-index: 40; top: calc(100% + 5px); left: 0; right: 0; max-height: 260px; overflow-y: auto;
  padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--r); background: var(--surface);
  box-shadow: var(--shadow-lg);
}
.select-option {
  width: 100%; min-height: 38px; justify-content: space-between; padding: 7px 9px; border: 0;
  background: transparent; color: var(--text); text-align: left; font-weight: 400;
}
.select-option.active { background: var(--surface-2); }
.select-option.selected { color: var(--accent-text); }
.select-option > span { min-width: 0; display: flex; flex-direction: column; }
.select-option b { overflow-wrap: anywhere; font-weight: 500; }
.select-option small { color: var(--text-3); font-size: 11.5px; }
</style>
