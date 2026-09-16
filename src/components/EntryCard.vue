<template>
  <div class="entry-card" :class="[kindClass(entry.kind), { low: entry.confidence < 0.7 }]">
    <div class="head">
      <span class="kind-dot" />
      <EntryKindPicker :model-value="entry.kind" :options="availableKinds" :disabled="locked" @update:model-value="changeKind" />
      <span class="conf">{{ Math.round(entry.confidence * 100) }}%</span>
      <button class="del" type="button" title="删除" :disabled="locked" @click="$emit('remove')">
        <Icon name="trash" :size="14" />
      </button>
    </div>
    <textarea
      v-if="isTextual"
      v-model="text"
      rows="2"
      :disabled="locked"
      placeholder="内容"
    />
    <div v-else class="kv">
      <label>睡眠时长（小时）</label>
      <input v-model.number="hours" type="number" step="0.5" min="0.1" max="24" :disabled="locked" />
    </div>
    <div class="moment-row">
      <label>
        <span>发生日期</span>
        <DatePicker v-model="entry.entryDate" :disabled="locked" :state="dateValid" open-above />
      </label>
      <label>
        <span>发生时间（可选）</span>
        <TimePicker v-model="entry.entryTime" :disabled="locked" :state="timeValid" open-above />
      </label>
    </div>
    <p v-if="!entryValid" class="validation-note">请补全有效内容和日期；时间可留空。</p>
    <p v-if="entry.confidence < 0.7" class="low-note">置信度偏低，确认前建议核对</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { EntryKind, ParsedEntry } from '../../electron/types'
import { KIND_PLAIN, kindClass } from '../utils/kinds'
import { changeCaptureEntryKind, isCaptureEntryValid } from '../stores/capture'
import Icon from './Icon.vue'
import DatePicker from './DatePicker.vue'
import TimePicker from './TimePicker.vue'
import EntryKindPicker from './EntryKindPicker.vue'

const props = defineProps<{ entry: ParsedEntry & { originalKind?: EntryKind }; locked?: boolean }>()
defineEmits<{ remove: [] }>()

const isTextual = computed(() => props.entry.kind !== 'sleep')
const availableKinds = computed<Partial<Record<EntryKind, string>>>(() =>
  props.entry.originalKind === 'sleep'
    ? KIND_PLAIN
    : Object.fromEntries(Object.entries(KIND_PLAIN).filter(([key]) => key !== 'sleep'))
)

const text = computed({
  get: () => String(props.entry.content.text ?? ''),
  set: (v: string) => (props.entry.content.text = v)
})

const hours = computed({
  get: () => Number(props.entry.content.hours ?? 0),
  set: (v: number) => (props.entry.content.hours = v)
})

const dateValid = computed(() => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(props.entry.entryDate)) return false
  const [year, month, day] = props.entry.entryDate.split('-').map(Number)
  const value = new Date(year, month - 1, day)
  return value.getFullYear() === year && value.getMonth() === month - 1 && value.getDate() === day
})
const timeValid = computed(() => !props.entry.entryTime || /^([01]\d|2[0-3]):[0-5]\d$/.test(props.entry.entryTime))
const entryValid = computed(() => isCaptureEntryValid(props.entry))

function changeKind(kind: EntryKind): void {
  changeCaptureEntryKind(props.entry, kind)
}
</script>

<style scoped>
.entry-card {
  border: 1px solid var(--border);
  border-left: 3px solid var(--kc, var(--border-strong));
  border-radius: var(--r-md);
  padding: 10px 13px;
  margin: 7px 0;
  background: var(--surface-2);
}
.entry-card.low { border-left-color: var(--warn); background: var(--warn-weak); }

.head { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
.conf {
  margin-left: auto; font-size: 11px; color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.del {
  padding: 4px; border: none; background: transparent;
  color: var(--text-3); cursor: pointer;
}
.del:hover:not(:disabled) { color: var(--danger); background: var(--danger-weak); }

textarea, input {
  width: 100%; box-sizing: border-box;
  border: 1px solid var(--border-strong); border-radius: var(--r);
  padding: 6px 9px; font-size: 13px; font-family: inherit;
  background: var(--surface); resize: vertical;
}
.kv label { display: block; font-size: 12px; color: var(--text-2); margin-bottom: 3px; }
.moment-row { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(140px, 0.7fr); gap: 8px; margin-top: 9px; }
.moment-row label > span { display: block; margin-bottom: 4px; font-size: 11.5px; color: var(--text-3); }
.moment-row :deep(.dp--main) { width: 100%; }
.validation-note { margin: 7px 0 0; font-size: 11.5px; color: var(--danger); }
.low-note { margin: 7px 0 0; font-size: 11.5px; color: var(--warn); }

@media (max-width: 560px) {
  .moment-row { grid-template-columns: 1fr; }
}
</style>
