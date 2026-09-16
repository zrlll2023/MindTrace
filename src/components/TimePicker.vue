<template>
  <div ref="root" class="time-picker">
    <button
      type="button"
      class="time-trigger"
      :class="{ invalid: state === false, active: open }"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <Icon name="clock" :size="15" />
      <span :class="{ placeholder: !modelValue }">{{ modelValue || placeholder }}</span>
      <button v-if="clearable && modelValue && !disabled" class="clear" type="button" title="清空时间" @click.stop="clear">×</button>
    </button>

    <div v-if="open" class="time-panel" :class="{ above: openAbove }" role="dialog" aria-label="选择发生时间">
      <div class="wheel-field" @wheel.prevent="onWheel('hour', $event)">
        <span class="unit">时</span>
        <button type="button" title="增加一小时" @click="step('hour', 1)">▲</button>
        <strong>{{ pad(draftHour) }}</strong>
        <button type="button" title="减少一小时" @click="step('hour', -1)">▼</button>
      </div>
      <span class="colon">:</span>
      <div class="wheel-field" @wheel.prevent="onWheel('minute', $event)">
        <span class="unit">分</span>
        <button type="button" title="增加五分钟" @click="step('minute', 1)">▲</button>
        <strong>{{ pad(draftMinute) }}</strong>
        <button type="button" title="减少五分钟" @click="step('minute', -1)">▼</button>
      </div>
      <div class="panel-actions">
        <button type="button" class="secondary" @click="clear">清空</button>
        <button type="button" class="primary" @click="apply">确定</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 单一发生时间选择器，与 DatePicker 共用 VueDatePicker 主题和输入行为。
 * 对外模型保持 HH:mm 字符串；空字符串表示用户未标记具体时间。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  clearable?: boolean
  placeholder?: string
  state?: boolean
  disabled?: boolean
  openAbove?: boolean
  minutesIncrement?: number
}>(), {
  modelValue: '',
  clearable: true,
  placeholder: '选择时间',
  state: undefined,
  disabled: false,
  openAbove: false,
  minutesIncrement: 5
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement>()
const open = ref(false)
const draftHour = ref(12)
const draftMinute = ref(0)

function pad(value: number): string { return String(value).padStart(2, '0') }
function syncDraft(value = props.modelValue): void {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (match) {
    draftHour.value = Number(match[1])
    draftMinute.value = Number(match[2])
  } else {
    const now = new Date()
    draftHour.value = now.getHours()
    draftMinute.value = Math.floor(now.getMinutes() / props.minutesIncrement) * props.minutesIncrement
  }
}
function toggle(): void {
  if (!open.value) syncDraft()
  open.value = !open.value
}
function step(field: 'hour' | 'minute', direction: number): void {
  if (field === 'hour') draftHour.value = (draftHour.value + direction + 24) % 24
  else draftMinute.value = (draftMinute.value + direction * props.minutesIncrement + 60) % 60
}
function onWheel(field: 'hour' | 'minute', event: WheelEvent): void {
  step(field, event.deltaY < 0 ? 1 : -1)
}
function apply(): void {
  emit('update:modelValue', `${pad(draftHour.value)}:${pad(draftMinute.value)}`)
  open.value = false
}
function clear(): void {
  emit('update:modelValue', '')
  open.value = false
}
function onOutside(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) open.value = false
}
watch(() => props.modelValue, value => { if (!open.value) syncDraft(value) })
onMounted(() => document.addEventListener('pointerdown', onOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
</script>

<style scoped>
.time-picker { position: relative; width: 100%; }
.time-trigger {
  width: 100%; height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 9px;
  border: 1px solid var(--border-strong); border-radius: var(--r); background: var(--surface);
  color: var(--text); font: inherit; font-size: 13px; text-align: left;
}
.time-trigger:hover:not(:disabled), .time-trigger.active { border-color: var(--accent); }
.time-trigger.active { box-shadow: 0 0 0 3px var(--accent-weak); }
.time-trigger.invalid { border-color: var(--danger); box-shadow: none; }
.time-trigger .placeholder { color: var(--text-3); }
.time-trigger .clear { margin-left: auto; padding: 0 2px; border: 0; background: transparent; color: var(--text-3); font-size: 17px; }
.time-panel {
  position: absolute; z-index: 50; top: calc(100% + 6px); right: 0; width: 196px;
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px;
  padding: 10px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--surface); box-shadow: var(--shadow-lg);
}
.time-panel.above { top: auto; bottom: calc(100% + 6px); }
.wheel-field { display: grid; justify-items: center; gap: 3px; border-radius: var(--r); padding: 3px; }
.wheel-field:hover { background: var(--surface-2); }
.wheel-field .unit { font-size: 10px; color: var(--text-3); }
.wheel-field strong { min-width: 36px; font-size: 22px; font-weight: 500; text-align: center; font-variant-numeric: tabular-nums; }
.wheel-field button { width: 30px; height: 22px; padding: 0; border: 0; background: transparent; color: var(--text-3); font-size: 10px; }
.wheel-field button:hover { color: var(--accent-text); background: var(--accent-weak); }
.colon { margin-top: 14px; font-size: 19px; }
.panel-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 6px; padding-top: 7px; border-top: 1px solid var(--border); }
.panel-actions button { min-width: 48px; padding: 5px 9px; font-size: 11.5px; }
</style>
