<template>
  <VueDatePicker
    :model-value="inner"
    six-weeks="center"
    model-type="yyyy-MM-dd"
    :formats="{ input: 'yyyy-MM-dd' }"
    :locale="LOCALE"
    :auto-apply="true"
    :time-config="{ enableTimePicker: false }"
    :input-attrs="{ clearable, state }"
    :teleport="true"
    :floating="openAbove ? ABOVE_FLOATING : undefined"
    :placeholder="placeholder"
    :disabled="disabled"
    :min-date="minDate || undefined"
    :max-date="maxDate || undefined"
    @update:model-value="onInput"
    @cleared="onInput(null)"
  />
</template>

<script setup lang="ts">
/**
 * 日期选择器（@vuepic/vue-datepicker v14 的项目封装）。
 *
 * 对外模型保持项目统一的 `YYYY-MM-DD` 字符串（'' 表示未选），
 * 视图层无需感知 Date 对象；样式主题在 src/style.css 中统一映射到设计 token。
 */
import { computed } from 'vue'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import { zhCN } from 'date-fns/locale'

const props = withDefaults(
  defineProps<{
    /** YYYY-MM-DD 字符串；'' 表示未选择 */
    modelValue?: string
    /** 是否允许清空（清空后为 ''） */
    clearable?: boolean
    /** 占位提示 */
    placeholder?: string
    /** 校验状态（false 时输入框标红） */
    state?: boolean
    /** 禁用 */
    disabled?: boolean
    /** 固定在输入框上方展开，适用于页面下半区的表单 */
    openAbove?: boolean
    /** 最早可选日期（YYYY-MM-DD） */
    minDate?: string
    /** 最晚可选日期（YYYY-MM-DD） */
    maxDate?: string
  }>(),
  {
    modelValue: '',
    clearable: true,
    placeholder: '',
    state: undefined,
    disabled: false,
    openAbove: false,
    minDate: '',
    maxDate: ''
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const LOCALE = zhCN
const ABOVE_FLOATING = { placement: 'top-start' as const, flip: false, shift: true }

/** v14 的 model-type 是双向的：入参与出参都是 'yyyy-MM-dd' 字符串，直接透传 */
const inner = computed<string | null>(() => props.modelValue || null)

function onInput(v: unknown): void {
  if (!v || typeof v !== 'string') {
    emit('update:modelValue', '')
    return
  }
  emit('update:modelValue', v)
}
</script>
