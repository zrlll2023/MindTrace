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
  },
  capture: {
    parse: (raw: string) => ipcRenderer.invoke('capture:parse', raw),
    commit: (raw: string, entries: unknown[]) => ipcRenderer.invoke('capture:commit', raw, entries)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
