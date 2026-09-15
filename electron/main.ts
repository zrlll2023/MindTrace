import { app, BrowserWindow, nativeTheme } from 'electron'
import path from 'node:path'
import { initContext } from './context'
import { registerIpcHandlers } from './ipc/handlers'
import { Scheduler } from './scheduler'
import { runBackup } from './store/backup'

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'MindTrace',
    // 与「纸 / 墨」主题的底色一致，避免深色下露出原生白底
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1013' : '#f6f5f2',
    show: false, // 内容就绪后再显示，避免空白窗落在控制台后面
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
    if (process.platform === 'win32') app.focus({ steal: true }) // 从启动它的控制台手中抢回焦点
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
  // 当日首开自动生成日报（spec §11.1）+ 每日备份——后台执行，不阻塞窗口
  void (async () => {
    await runBackup(ctx.dataDir, ctx.getSettings().backupRetention)
    // 语义索引后台增量更新（启用时）
    const emb = ctx.getEmbedding()
    if (emb) {
      const { VectorStore } = await import('./db/vectors.js')
      new VectorStore(ctx.repo.getDb())
        .embedMissing(ctx.repo, emb)
        .catch(() => undefined)
    }
    const { VectorStore } = await import('./db/vectors.js')
    const { SemanticSearch } = await import('./analysis/semantic.js')
    const semantic = emb ? new SemanticSearch(ctx.repo, new VectorStore(ctx.repo.getDb()), emb) : null
    await new Scheduler(ctx.repo).ensureReportForToday(ctx.getLlm(), {
      desensitize: ctx.getSettings().desensitize,
      search: ctx.getSearch(),
      semantic
    })
  })()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
