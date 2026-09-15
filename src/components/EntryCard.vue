<template>
  <div class="entry-card" :class="[kindClass(entry.kind), { low: entry.confidence < 0.7 }]">
    <div class="head">
      <span class="kind-dot" />
      <select v-model="entry.kind" class="kind-select" :disabled="locked">
        <option v-for="(label, k) in KIND_PLAIN" :key="k" :value="k">{{ label }}</option>
      </select>
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
      <input v-model.number="hours" type="number" step="0.5" min="0" max="24" :disabled="locked" />
    </div>
    <p v-if="entry.confidence < 0.7" class="low-note">置信度偏低，确认前建议核对</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ParsedEntry } from '../../electron/types'
import { KIND_PLAIN, kindClass } from '../utils/kinds'
import Icon from './Icon.vue'

const props = defineProps<{ entry: ParsedEntry; locked?: boolean }>()
defineEmits<{ remove: [] }>()

const isTextual = computed(() => props.entry.kind !== 'sleep')

const text = computed({
  get: () => String(props.entry.content.text ?? ''),
  set: (v: string) => (props.entry.content.text = v)
})

const hours = computed({
  get: () => Number(props.entry.content.hours ?? 0),
  set: (v: number) => (props.entry.content.hours = v)
})
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
.kind-select {
  width: auto; padding: 0; border: none; background: transparent;
  font-size: 13px; font-weight: 600; color: var(--kc, var(--text));
  cursor: pointer;
}
.kind-select:focus { box-shadow: none; }
.kind-select:disabled { cursor: default; opacity: 1; }
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
.low-note { margin: 7px 0 0; font-size: 11.5px; color: var(--warn); }
</style>
