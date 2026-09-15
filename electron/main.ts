import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { initContext } from './context'
import { registerIpcHandlers } from './ipc/handlers'
import { Scheduler } from './scheduler'

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'MindTrace',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(async () => {
  const ctx = await initContext()
  registerIpcHandlers()
  await createWindow()
  // 当日首开自动生成日报（spec §11.1）——后台执行，不阻塞窗口
  void new Scheduler(ctx.repo).ensureReportForToday(ctx.getLlm())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
