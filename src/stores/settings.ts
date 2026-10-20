import { defineStore } from 'pinia'
import { ref } from 'vue'
import { AppSettings, DEFAULT_SETTINGS, ProviderPreset } from '../../electron/types'

interface SettingsPayload {
  settings: AppSettings
  hasApiKey: boolean
  hasSearchKey: boolean
  dataDir: string
  defaultDataDir: string
  previousDataDir: string | null
  pendingDataDir: string | null
}

export const useSettingsStore = defineStore('settings', () => {
  const payload = ref<SettingsPayload>({
    settings: { ...DEFAULT_SETTINGS },
    hasApiKey: false,
    hasSearchKey: false,
    dataDir: '',
    defaultDataDir: '',
    previousDataDir: null,
    pendingDataDir: null
  })
  const presets = ref<ProviderPreset[]>([])
  const loading = ref(false)
  const message = ref('')
  const messageOk = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      payload.value = await window.api.settings.get()
      presets.value = await window.api.settings.getPresets()
    } finally {
      loading.value = false
    }
  }

  async function save(settings: AppSettings, apiKey?: string, searchKey?: string): Promise<void> {
    loading.value = true
    try {
      await window.api.settings.save(settings, apiKey, searchKey)
      if (apiKey) payload.value.hasApiKey = true
      if (searchKey !== undefined) payload.value.hasSearchKey = searchKey !== ''
      payload.value.settings = { ...settings }
      show('设置已保存', true)
    } catch (e) {
      show(`保存失败：${(e as Error).message}`, false)
    } finally {
      loading.value = false
    }
  }

  async function fetchModels(baseUrl: string, apiKey?: string): Promise<string[]> {
    const r = await window.api.llm.listModels(baseUrl, apiKey)
    if (!r.ok) {
      show(`拉取模型列表失败：${r.error}`, false)
      return []
    }
    return r.models.map((m: { id: string }) => m.id)
  }

  /**
   * 刷新某个提供商的模型列表，并写回预设缓存。
   * 首次进入设置页、已配置 Key 且从未刷新过时自动调用一次。
   */
  async function refreshProviderModels(
    providerId: string,
    baseUrl?: string,
    apiKey?: string
  ): Promise<{ ok: boolean; error?: string; models: string[] }> {
    const r = await window.api.settings.refreshModels(providerId, baseUrl, apiKey)
    if (Array.isArray(r?.presets)) presets.value = r.presets
    return { ok: !!r?.ok, error: r?.error, models: Array.isArray(r?.models) ? r.models : [] }
  }

  /** 是否已为本机自动刷新过一次模型列表（只影响自动触发，不阻止手动刷新） */
  const AUTO_REFRESH_FLAG = 'mindtrace.models.autoRefreshed.v1'

  /**
   * 首次使用自动拉取 /models：仅在「已保存 API Key」且「本机从未自动刷新过」时执行一次。
   * 失败不打扰用户（静默记入 message），避免开屏就弹错误。
   */
  async function autoRefreshModelsOnce(): Promise<void> {
    try {
      if (localStorage.getItem(AUTO_REFRESH_FLAG)) return
      if (!payload.value.hasApiKey) return
      const s = payload.value.settings
      if (!s.baseUrl) return
      const r = await refreshProviderModels(s.providerId, s.baseUrl)
      if (r.ok) {
        localStorage.setItem(AUTO_REFRESH_FLAG, new Date().toISOString())
      } else {
        // 不标记为已完成：允许用户下次手动刷新；但也不反复自动重试
        localStorage.setItem(AUTO_REFRESH_FLAG, 'failed:' + new Date().toISOString())
      }
    } catch {
      // 自动刷新永远不应影响设置页可用性
    }
  }

  async function testConnection(baseUrl: string, apiKey?: string, model?: string) {
    return window.api.llm.testConnection(baseUrl, apiKey, model)
  }

  async function openDataDir(): Promise<void> {
    await window.api.settings.openDataDir()
  }
  async function openPreviousDataDir(): Promise<void> { await window.api.settings.openPreviousDataDir() }

  function show(msg: string, ok: boolean): void {
    message.value = msg
    messageOk.value = ok
    setTimeout(() => (message.value = ''), 5000)
  }

  return {
    payload,
    presets,
    loading,
    message,
    messageOk,
    load,
    save,
    fetchModels,
    refreshProviderModels,
    autoRefreshModelsOnce,
    testConnection,
    openDataDir,
    openPreviousDataDir,
    show
  }
})
