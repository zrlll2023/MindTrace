import { defineStore } from 'pinia'
import { ref } from 'vue'
import { AppSettings, DEFAULT_SETTINGS, ProviderPreset } from '../../electron/types'

export interface SettingsPayload {
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
    testConnection,
    openDataDir,
    openPreviousDataDir,
    show
  }
})
