import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 主题模式：固定浅色 / 固定深色 / 跟随系统 */
export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'mt-theme'

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readMode(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readMode())
  const resolved = ref<ResolvedTheme>(mode.value === 'system' ? systemTheme() : mode.value)

  function apply(): void {
    resolved.value = mode.value === 'system' ? systemTheme() : mode.value
    document.documentElement.dataset.theme = resolved.value
  }

  function set(next: ThemeMode): void {
    mode.value = next
    localStorage.setItem(STORAGE_KEY, next)
    apply()
  }

  /** 应用启动时调用；返回清理函数 */
  function init(): () => void {
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      if (mode.value === 'system') apply()
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }

  return { mode, resolved, set, init }
})
