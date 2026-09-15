import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readableUpdateError } from './updater-errors'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  latestVersion?: string
  percent?: number
  error?: string
}

let state: UpdateState
let initialized = false
let beforeInstall: (() => Promise<void>) | undefined

function initialState(): UpdateState {
  return {
    phase: app.isPackaged ? 'idle' : 'unsupported',
    currentVersion: app.getVersion()
  }
}

function publish(patch: Partial<UpdateState>): UpdateState {
  state = { ...state, ...patch }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:state', state)
  }
  return state
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) return state
  if (state.phase === 'checking' || state.phase === 'downloading') return state
  publish({ phase: 'checking', error: undefined, percent: undefined })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    publish({ phase: 'error', error: readableUpdateError(error), percent: undefined })
  }
  return state
}

async function confirmAndInstall(): Promise<void> {
  const choice = await dialog.showMessageBox({
    type: 'info',
    title: '安装 MindTrace 更新',
    message: `MindTrace v${state.latestVersion ?? ''} 已准备好`,
    detail: '安装前会备份本地数据库，随后应用将重启。',
    buttons: ['立即重启并安装', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  if (choice.response !== 0) return
  try {
    await beforeInstall?.()
    autoUpdater.quitAndInstall(false, true)
  } catch (error) {
    publish({ phase: 'error', error: `安装前备份失败：${readableUpdateError(error)}` })
  }
}

async function requestUpdate(): Promise<UpdateState> {
  if (!app.isPackaged) return state
  if (state.phase === 'error') {
    return checkForUpdates()
  } else if (state.phase === 'available') {
    publish({ phase: 'downloading', percent: 0, error: undefined })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      publish({ phase: 'error', error: readableUpdateError(error), percent: undefined })
    }
  } else if (state.phase === 'downloaded') {
    await confirmAndInstall()
  }
  return state
}

export function initializeUpdater(options: { beforeInstall?: () => Promise<void> } = {}): void {
  if (initialized) return
  initialized = true
  beforeInstall = options.beforeInstall
  state = initialState()

  ipcMain.handle('updater:getState', () => state)
  ipcMain.handle('updater:requestUpdate', () => requestUpdate())

  if (!app.isPackaged) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => publish({ phase: 'checking', error: undefined }))
  autoUpdater.on('update-available', info => publish({
    phase: 'available',
    latestVersion: info.version,
    percent: undefined,
    error: undefined
  }))
  autoUpdater.on('update-not-available', info => publish({
    phase: 'current',
    latestVersion: info.version || app.getVersion(),
    percent: undefined,
    error: undefined
  }))
  autoUpdater.on('download-progress', progress => publish({
    phase: 'downloading',
    percent: Math.max(0, Math.min(100, Math.round(progress.percent)))
  }))
  autoUpdater.on('update-downloaded', info => publish({
    phase: 'downloaded',
    latestVersion: info.version,
    percent: 100,
    error: undefined
  }))
  autoUpdater.on('error', error => publish({
    phase: 'error',
    percent: undefined,
    error: readableUpdateError(error)
  }))
}

export function startUpdaterChecks(): void {
  if (!app.isPackaged) return
  const initial = setTimeout(() => void checkForUpdates(), 2500)
  const periodic = setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000)
  initial.unref()
  periodic.unref()
}
