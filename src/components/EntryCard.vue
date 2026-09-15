<template>
  <div class="card" :class="{ low: entry.confidence < 0.7 }">
    <div class="head">
      <select v-model="entry.kind" class="kind" :disabled="locked">
        <option v-for="(label, k) in KIND_LABELS" :key="k" :value="k">{{ label }}</option>
      </select>
      <span class="conf" :title="`置信度 ${Math.round(entry.confidence * 100)}%`">
        {{ Math.round(entry.confidence * 100) }}%
      </span>
      <button class="del" @click="$emit('remove')" :disabled="locked">删除</button>
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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ParsedEntry, KIND_LABELS, EntryKind } from '../../electron/types'

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
.card {
  border: 1px solid #dfe3ea; border-radius: 10px; padding: 10px 12px; margin: 6px 0;
  background: #fafbfc;
}
.card.low { border-color: #f0b429; background: #fffaf0; }
.head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.kind { font-size: 13px; border: none; background: transparent; }
.conf { font-size: 11px; color: #888; margin-left: auto; }
.del { font-size: 12px; border: none; background: transparent; color: #d33; cursor: pointer; }
textarea, input {
  width: 100%; box-sizing: border-box; border: 1px solid #e2e5ea; border-radius: 6px;
  padding: 6px 8px; font-size: 13px; font-family: inherit; resize: vertical;
}
.kv label { display: block; font-size: 12px; color: #666; margin-bottom: 2px; }
</style>
