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
  },
  timeline: {
    list: (filter: unknown) => ipcRenderer.invoke('timeline:list', filter),
    search: (keyword: string) => ipcRenderer.invoke('timeline:search', keyword),
    get: (id: number) => ipcRenderer.invoke('timeline:get', id),
    updateContent: (id: number, content: unknown) =>
      ipcRenderer.invoke('timeline:updateContent', id, content)
  },
  reports: {
    get: (type: 'daily' | 'weekly', period: string) =>
      ipcRenderer.invoke('reports:get', type, period),
    list: (type?: 'daily' | 'weekly') => ipcRenderer.invoke('reports:list', type),
    generate: (date: string) => ipcRenderer.invoke('reports:generate', date),
    generateWeekly: (endDate: string) => ipcRenderer.invoke('reports:generateWeekly', endDate)
  },
  export: {
    md: (report: { type: 'daily' | 'weekly'; period: string; content_md: string; meta: string }) =>
      ipcRenderer.invoke('export:md', report)
  },
  backup: {
    run: () => ipcRenderer.invoke('backup:run')
  },
  import: {
    exportZip: () => ipcRenderer.invoke('import:exportZip')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
