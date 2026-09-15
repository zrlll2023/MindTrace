import { contextBridge, ipcRenderer } from 'electron'

const api = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings: unknown, apiKey?: string) => ipcRenderer.invoke('settings:save', settings, apiKey),
    openDataDir: () => ipcRenderer.invoke('settings:openDataDir'),
    getPresets: () => ipcRenderer.invoke('settings:getPresets')
  },
  llm: {
    listModels: () => ipcRenderer.invoke('llm:listModels'),
    testConnection: (baseUrl: string, apiKey?: string, model?: string) =>
      ipcRenderer.invoke('llm:testConnection', baseUrl, apiKey, model)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
