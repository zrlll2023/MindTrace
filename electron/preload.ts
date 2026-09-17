import { contextBridge, ipcRenderer } from 'electron'

const api = {
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  updater: {
    getState: () => ipcRenderer.invoke('updater:getState'),
    requestUpdate: () => ipcRenderer.invoke('updater:requestUpdate'),
    onState: (listener: (state: import('./updater').UpdateState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: import('./updater').UpdateState) => listener(state)
      ipcRenderer.on('updater:state', handler)
      return () => ipcRenderer.removeListener('updater:state', handler)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings: unknown, apiKey?: string, searchKey?: string) =>
      ipcRenderer.invoke('settings:save', settings, apiKey, searchKey),
    openDataDir: () => ipcRenderer.invoke('settings:openDataDir'),
    openPreviousDataDir: () => ipcRenderer.invoke('settings:openPreviousDataDir'),
    selectDataDir: () => ipcRenderer.invoke('settings:selectDataDir'),
    selectExportDir: () => ipcRenderer.invoke('settings:selectExportDir'),
    clearExportDir: () => ipcRenderer.invoke('settings:clearExportDir'),
    inspectDataMigration: (target: string) => ipcRenderer.invoke('settings:inspectDataMigration', target),
    migrateData: (target: string) => ipcRenderer.invoke('settings:migrateData', target),
    restart: () => ipcRenderer.invoke('settings:restart'),
    getPresets: () => ipcRenderer.invoke('settings:getPresets')
  },
  llm: {
    listModels: (baseUrl?: string, apiKey?: string) =>
      ipcRenderer.invoke('llm:listModels', baseUrl, apiKey),
    testConnection: (baseUrl: string, apiKey?: string, model?: string) =>
      ipcRenderer.invoke('llm:testConnection', baseUrl, apiKey, model)
  },
  capture: {
    list: () => ipcRenderer.invoke('capture:list'),
    parse: (raw: string) => ipcRenderer.invoke('capture:parse', raw),
    commit: (messageId: number, entries: unknown[]) => ipcRenderer.invoke('capture:commit', messageId, entries),
    clear: () => ipcRenderer.invoke('capture:clear')
  },
  entries: {
    manual: (kind: string, content: object, rawText: string, entryDate?: string, knowledge?: unknown) =>
      ipcRenderer.invoke('entries:manual', kind, content, rawText, entryDate, knowledge),
    remove: (id: number) => ipcRenderer.invoke('timeline:delete', id)
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
  },
  profile: {
    get: () => ipcRenderer.invoke('profile:get'),
    save: (values: unknown) => ipcRenderer.invoke('profile:save', values),
    confirmDraft: (messageId: number, values: unknown) => ipcRenderer.invoke('profile:confirmDraft', messageId, values)
  },
  semantic: {
    search: (query: string, topK?: number) => ipcRenderer.invoke('semantic:search', query, topK),
    index: () => ipcRenderer.invoke('semantic:index'),
    status: () => ipcRenderer.invoke('semantic:status')
  },
  hybrid: {
    search: (query: string, topK?: number, expand?: boolean) =>
      ipcRenderer.invoke('hybrid:search', query, topK, expand)
  },
  kb: {
    listFolders: () => ipcRenderer.invoke('kb:listFolders'),
    addFolder: (name: string, description?: string) => ipcRenderer.invoke('kb:addFolder', name, description),
    renameFolder: (id: number, name: string, description?: string) =>
      ipcRenderer.invoke('kb:renameFolder', id, name, description),
    deleteFolder: (id: number) => ipcRenderer.invoke('kb:deleteFolder', id),
    listItems: (folderId: number) => ipcRenderer.invoke('kb:listItems', folderId),
    getItem: (id: number) => ipcRenderer.invoke('kb:getItem', id),
    addItem: (folderId: number, meta: { title: string; sourceType: string; reason?: string }, body: string, filePath?: string) =>
      ipcRenderer.invoke('kb:addItem', folderId, meta, body, filePath),
    updateItem: (id: number, patch: { title?: string; body?: string; reason?: string }) =>
      ipcRenderer.invoke('kb:updateItem', id, patch),
    updateReflection: (id: number, text: string) => ipcRenderer.invoke('kb:updateReflection', id, text),
    deleteItem: (id: number) => ipcRenderer.invoke('kb:deleteItem', id),
    summarize: (itemId: number) => ipcRenderer.invoke('kb:summarize', itemId),
    extend: (folderId: number) => ipcRenderer.invoke('kb:extend', folderId),
    importFiles: (folderId: number, reason?: string) => ipcRenderer.invoke('kb:importFiles', folderId, reason)
  },
  labs: {
    metrics: (dateFrom: string, dateTo: string) => ipcRenderer.invoke('labs:metrics', dateFrom, dateTo),
    planResearch: () => ipcRenderer.invoke('labs:planResearch'),
    saveFinding: (text: string, from: string) => ipcRenderer.invoke('labs:saveFinding', text, from)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
