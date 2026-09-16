<template>
  <div class="trp" :class="{ invalid: state === false }">
    <VueDatePicker
      :model-value="inner"
      :range="{ partialRange: false }"
      six-weeks="center"
      model-type="yyyy-MM-dd HH:mm"
      :formats="{ input: 'yyyy-MM-dd HH:mm' }"
      :locale="LOCALE"
      :auto-apply="true"
      :time-config="{
        enableSeconds: false,
        is24: true,
        minutesIncrement,
        startTime: START_TIME,
        timePickerInline: true
      }"
      :input-attrs="{ clearable, state }"
      :teleport="true"
      :floating="ABOVE_FLOATING"
      :placeholder="placeholder"
      :disabled="disabled"
      @update:model-value="onInput"
      @cleared="onInput(null)"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 时间段选择器（@vuepic/vue-datepicker v14 的项目封装，睡眠记录专用）。
 *
 * 选择一个日期时间段（开始 → 结束），精确到分钟、不带秒，
 * 对外模型为 `{ start, end }`，格式 `YYYY-MM-DD HH:mm`；null 表示未选择。
 * 样式主题在 src/style.css 中统一映射到设计 token。
 */
import { computed } from 'vue'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import { zhCN } from 'date-fns/locale'

export interface TimeRangeValue {
  /** 开始时间，YYYY-MM-DD HH:mm */
  start: string
  /** 结束时间，YYYY-MM-DD HH:mm */
  end: string
}

const props = withDefaults(
  defineProps<{
    modelValue?: TimeRangeValue | null
    /** 是否允许清空 */
    clearable?: boolean
    /** 占位提示 */
    placeholder?: string
    /** 校验状态（false 时输入框标红） */
    state?: boolean
    /** 分钟步进粒度 */
    minutesIncrement?: number
    /** 禁用 */
    disabled?: boolean
  }>(),
  {
    modelValue: null,
    clearable: true,
    placeholder: '选择时间段（精确到分钟）',
    state: undefined,
    minutesIncrement: 5,
    disabled: false
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: TimeRangeValue | null]
}>()

const LOCALE = zhCN
const ABOVE_FLOATING = { placement: 'top-start' as const, flip: false, shift: true }
/** 打开面板时的起止时间初始值（贴近「昨晚入睡」场景） */
const START_TIME = [
  { hours: 22, minutes: 0 },
  { hours: 7, minutes: 0 }
]

const inner = computed<[string, string] | null>(() => {
  const v = props.modelValue
  return v?.start && v?.end ? [v.start, v.end] : null
})

function isRangeStrings(v: unknown): v is [string, string] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === 'string' &&
    !!v[0] &&
    typeof v[1] === 'string' &&
    !!v[1]
  )
}

function onInput(v: unknown): void {
  // 清空
  if (!v) {
    emit('update:modelValue', null)
    return
  }
  // 完整的起止选择（字符串模型，v14 model-type 双向）
  if (isRangeStrings(v)) {
    emit('update:modelValue', { start: v[0], end: v[1] })
  }
  // 其余（选择过程中的中间态）不外发
}
</script>

<style scoped>
.trp { width: 100%; }
.trp.invalid :deep(.dp--input) { border-color: var(--danger); }
</style>
