# MindTrace MVP 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 MindTrace MVP——本地优先的 Electron 桌面应用：聊天框录入生活数据，AI 解析归档，生成日报/周报并可导出 Markdown。

**Architecture:** Electron 双进程架构。主进程（Node.js）持有 sql.js 数据库、LLM 适配器、分析引擎、调度器；渲染进程（Vue 3 + TypeScript）通过 contextBridge 暴露的类型化 IPC API 调用主进程能力，自身不直接触网、不直接触库。数据目录默认 `%APPDATA%/MindTrace/`。

**Tech Stack:** Electron、Vue 3、TypeScript、Vite、Pinia、sql.js（WASM SQLite）、Vitest、electron-builder。

**Spec:** `docs/superpowers/specs/2026-09-14-mindtrace-design.md`（本计划从 spec 论证；执行者需同时阅读两者）

## Global Constraints

- 界面、报告、文档、用户可见文案**全部中文**（spec §约定）
- **全项目禁用原生模块**：SQLite 必须用 sql.js（WASM）；添加任何依赖前检查是否含 .node 原生绑定（spec §10）
- 数据全本地：出网仅限 LLM/搜索适配器发出的 HTTP 请求；渲染进程 `contextIsolation: true`、`nodeIntegration: false`（spec §8）
- `entries.raw_text` 永不修改、永不删除（spec §4.1）
- API Key 本机加密存储（Node `safeStorage`，DPAPI），不明文落盘（spec §8）
- 日报触发：当日首次打开应用时生成；设置页可手动补任意日期（spec §11.1）
- v1 无联网搜索（有界 Agent 工具仅查本地，上限 6 次调用）（spec §6.2）
- Node v26、pnpm 包管理器；提交信息格式见仓库既有提交（中文 + 「本次上传内容」段落）
- 每个任务完成即 commit；每完成一个里程碑（跨任务的功能块）即 push 到 GitHub

---

### Task 1: 项目脚手架（Electron + Vite + Vue 3 + TS）

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`(不需要则省略), `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`
- Create: `electron/main.ts`, `electron/preload.ts`
- Create: `src/main.ts`, `src/App.vue`
- Create: `.gitignore`
- Test: `tests/e2e/smoke.test.ts`（仅验证构建产物存在；真 E2E 后置）

**Interfaces:**
- Produces: 可 `pnpm dev` 启动 Electron 窗口显示 Vue 页面；`pnpm build` 产出构建；主进程 `index.html` 加载逻辑就绪
- Produces: `electron/preload.ts` 暴露空壳 `window.api = {}`（后续任务填充）

- [ ] **Step 1: 初始化项目与依赖**

```bash
pnpm init
pnpm add vue pinia
pnpm add -D electron vite @vitejs/plugin-vue typescript vue-tsc vitest electron-builder concurrently wait-on
```

`package.json` 关键字段：

```json
{
  "name": "mindtrace",
  "version": "0.1.0",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "concurrently \"vite\" \"wait-on tcp:5173 && electron .\"",
    "build": "vite build && tsc -p tsconfig.node.json",
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit && tsc -p tsconfig.node.json --noEmit"
  }
}
```

- [ ] **Step 2: 写 Vite/TS 配置**

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: { outDir: 'dist' },
  server: { port: 5173, strictPort: true }
})
```

`tsconfig.json`（渲染进程）标准 Vue 推荐配置，含 `"types": ["vite/client"]`；`tsconfig.node.json` 覆盖 `electron/`，`outDir: dist-electron`，`module: commonjs`（Electron 主进程用 CJS）。

- [ ] **Step 3: 主进程与 preload 最小实现**

```ts
// electron/main.ts
import { app, BrowserWindow } from 'electron'
import path from 'node:path'

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 800,
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

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

```ts
// electron/preload.ts
import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('api', {})
```

- [ ] **Step 4: Vue 入口与冒烟测试**

`src/main.ts` 挂载 App 与 Pinia；`src/App.vue` 先渲染 `<h1>MindTrace</h1>`。

```ts
// tests/e2e/smoke.test.ts
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'

describe('构建产物冒烟', () => {
  it('vite 构建产出 index.html', () => {
    expect(existsSync('dist/index.html')).toBe(true)
  })
  it('主进程编译产物存在', () => {
    expect(existsSync('dist-electron/main.js')).toBe(true)
  })
})
```

（先跑 `pnpm build` 再跑测试。）

- [ ] **Step 5: 验证 dev 模式窗口能打开（人工确认一次）**

Run: `pnpm dev` → 出现 Electron 窗口显示「MindTrace」。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Electron+Vue3+TS 项目脚手架，dev/build/test 脚本可用"
```

---

### Task 2: sql.js 存储层 + Schema + FTS

**Files:**
- Create: `electron/db/connection.ts`, `electron/db/schema.ts`, `electron/db/repository.ts`
- Test: `tests/db/schema.test.ts`, `tests/db/repository.test.ts`

**Interfaces:**
- Produces: `initDb(dataDir: string): Promise<Database>`（sql.js 实例，落盘到 `<dataDir>/mindtrace.db`）
- Produces: `Repository` 类，方法（后续任务全部经此访问数据）：
  - `insertEntry(e: NewEntry): Promise<Entry>`
  - `listEntries(filter: EntryFilter): Promise<Entry[]>`
  - `searchEntries(keyword: string): Promise<Entry[]>`
  - `insertReport(r: NewReport): Promise<Report>`
  - `getReport(type: ReportType, period: string): Promise<Report | null>`
  - `getSetting(key: string): Promise<string | null>` / `setSetting(key: string, value: string): Promise<void>`

- [ ] **Step 1: 写 schema 迁移的失败测试**

```ts
// tests/db/schema.test.ts
import { describe, it, expect } from 'vitest'
import { initDb } from '../../electron/db/connection'

describe('schema 迁移', () => {
  it('创建 entries/threads/entry_threads/reports/settings 表', async () => {
    const db = await initDb(':memory:')
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]
      .values.flat()
    expect(tables).toContain('entries')
    expect(tables).toContain('threads')
    expect(tables).toContain('entry_threads')
    expect(tables).toContain('reports')
    expect(tables).toContain('settings')
  })
})
```

- [ ] **Step 2: 运行确认失败** — Run: `pnpm test` → FAIL（模块不存在）

- [ ] **Step 3: 实现 connection 与 schema**

`pnpm add sql.js`；`connection.ts` 用 `initSqlJs()` 加载 wasm（Electron 打包时从 `node_modules/sql.js/dist/` 复制 wasm 到资源目录）；`schema.ts` 内嵌 DDL（spec §4.1 五张表 + `entries` 的 FTS5 虚表：

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  content, content='entries', content_rowid='id', tokenize='trigram'
);
```

sql.js 编译产物若不含 FTS5，`connection.ts` 检测 `SELECT fts5(?1)` 失败时降级用 LIKE（spec §3 兜底条款）。

- [ ] **Step 4: 写 repository 失败测试（插入/查询/全文检索/round-trip）**

```ts
// tests/db/repository.test.ts（节选）
it('插入并按类型查询 entry', async () => {
  const repo = new Repo(await initDb(':memory:'))
  await repo.insertEntry({ raw_text: '睡了6.5小时', kind: 'sleep',
    content: JSON.stringify({ hours: 6.5 }), confidence: 0.9, source: 'chat' })
  const got = await repo.listEntries({ kind: 'sleep' })
  expect(got).toHaveLength(1)
  expect(got[0].raw_text).toBe('睡了6.5小时')
})
it('FTS/LIKE 兜底检索', async () => {
  const repo = new Repo(await initDb(':memory:'))
  await repo.insertEntry({ raw_text: 'x', kind: 'idea',
    content: JSON.stringify({ text: 'RAG评估新方法' }), confidence: 1, source: 'chat' })
  expect((await repo.searchEntries('RAG')).length).toBe(1)
})
```

- [ ] **Step 5: 实现 repository 至测试通过**

- [ ] **Step 6: Commit** — `feat: sql.js 存储层，五表 schema + FTS/LIKE 兜底检索`

---

### Task 3: IPC 桥 + 设置页（提供商适配器）

**Files:**
- Create: `electron/ipc/handlers.ts`, `electron/adapters/llm.ts`, `electron/store/secrets.ts`
- Create: `src/views/SettingsView.vue`, `src/stores/settings.ts`
- Modify: `electron/preload.ts`（暴露类型化 API）, `src/App.vue`（导航壳）
- Test: `tests/adapters/llm.test.ts`, `tests/store/secrets.test.ts`

**Interfaces:**
- Produces: `window.api.settings.get(): Promise<Settings>`、`window.api.settings.save(s: Settings): Promise<void>`、`window.api.llm.listModels(): Promise<ModelInfo[]>`、`window.api.llm.testConnection(): Promise<{ok: boolean, error?: string}>`
- Produces: `LLMAdapter.chat(messages: ChatMessage[], opts?: {json?: boolean}): Promise<string>`——所有 AI 功能唯一入口
- Produces: `SecretBox.set(key, plain)` / `SecretBox.get(key)`（safeStorage 加密落盘 `<dataDir>/secrets.bin`）

- [ ] **Step 1: 失败测试 LLM 适配器（fetch mock，测 OpenAI 兼容请求形状 + /models 拉取）**

```ts
// tests/adapters/llm.test.ts（节选）
it('chat 发送 OpenAI 兼容请求', async () => {
  const calls: any[] = []
  global.fetch = async (url: any, init: any) => {
    calls.push({ url, init }); return jsonResp({ choices: [{ message: { content: '你好' } }] })
  }
  const a = new LLMAdapter({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-x', model: 'deepseek-chat' })
  const out = await a.chat([{ role: 'user', content: 'hi' }])
  expect(out).toBe('你好')
  expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions')
  expect(JSON.parse(calls[0].init.body).model).toBe('deepseek-chat')
})
it('listModels 解析 /models 返回', async () => {
  global.fetch = async () => jsonResp({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })
  const a = new LLMAdapter({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-x', model: 'deepseek-chat' })
  const models = await a.listModels()
  expect(models.map(m => m.id)).toContain('deepseek-chat')
})
```

- [ ] **Step 2: 失败测试 SecretBox**（临时目录落盘→读取 round-trip；未设 key 返回 null）

- [ ] **Step 3: 实现至通过**（`LLMAdapter` 用 Node 18+ 全局 fetch；`SecretBox` 用 `safeStorage`，不可用时显式报错提示，禁止明文降级）

- [ ] **Step 4: IPC handlers + preload 类型**

`handlers.ts` 用 `ipcMain.handle('settings:get'| 'settings:save' | 'llm:listModels' | 'llm:testConnection', ...)`；`preload.ts` 对应 `contextBridge.exposeInMainWorld('api', { settings: {...}, llm: {...} })`；`src/types/api.d.ts` 声明 `window.api` 类型。

- [ ] **Step 5: 设置页 UI（中文）**

预设下拉（DeepSeek/智谱/Moonshot/SiliconFlow/Ollama/自定义）→ 选定自动填 baseUrl →「拉取模型列表」按钮调 `llm.listModels` → 下拉选模型 → API Key 输入框（打码）→「测试连接」显示成功/失败 → 保存。附数据目录显示与「打开数据目录」按钮。

- [ ] **Step 6: 人工验证 + Commit** — `feat: LLM 提供商适配器 + 加密密钥存储 + 中文设置页`

---

### Task 4: 聊天捕获 + AI 解析 + 确认卡片 UI

**Files:**
- Create: `electron/analysis/parser.ts`
- Create: `src/views/CaptureView.vue`, `src/stores/capture.ts`, `src/components/EntryCard.vue`
- Modify: `electron/ipc/handlers.ts`（新增 `capture:parse`、`capture:commit`）
- Test: `tests/analysis/parser.test.ts`

**Interfaces:**
- Produces: `parseDump(text: string): Promise<ParsedEntry[]>`；`ParsedEntry = { kind: EntryKind, content: object, confidence: number }`
- Produces: `window.api.capture.parse(raw: string): Promise<ParsedEntry[]>`、`window.api.capture.commit(raw: string, entries: ParsedEntry[]): Promise<Entry[]>`

- [ ] **Step 1: 失败测试解析器（mock LLMAdapter 返回固定 JSON）**

```ts
// tests/analysis/parser.test.ts（节选）
it('解析混合 dump 为多条结构化条目', async () => {
  const fake = new LLMAdapter(fakeCfg)
  fake.chat = async () => JSON.stringify([
    { kind: 'sleep', content: { hours: 6.5 }, confidence: 0.95 },
    { kind: 'quote', content: { text: '纸上得来终觉浅' }, confidence: 0.9 }
  ])
  const out = await parseDumpWith(fake, '睡了6.5小时。今天看到一句话：纸上得来终觉浅')
  expect(out).toHaveLength(2)
  expect(out[0].kind).toBe('sleep')
})
it('LLM 返回非法 JSON 时不崩溃并重试一次', async () => {
  const fake = new LLMAdapter(fakeCfg)
  let calls = 0
  fake.chat = async () => { calls++; return calls === 1 ? '抱歉我无法输出JSON' : JSON.stringify([{ kind: 'idea', content: { text: '测试' }, confidence: 0.8 }]) }
  const out = await parseDumpWith(fake, '随便一句')
  expect(calls).toBe(2)
  expect(out[0].kind).toBe('idea')
})
```

- [ ] **Step 2: 实现解析器**：system prompt（中文，定义六种 kind 与各 content schema，要求只输出 JSON 数组）；`json: true`；非法输出重试 1 次；仍失败则整条存为 `kind: 'other'`、`confidence: 0`。

- [ ] **Step 3: IPC + 确认卡片 UI**

`capture:commit` 一次事务写入 raw_text + 所有条目；前端聊天框 → 调 parse → 渲染卡片（类型图标 😴😞📖💡 + 置信度 < 0.7 黄色边框）→ 卡片可改 kind/编辑内容/删除 → 「确认归档」调 commit → 追加到时间线。聊天框自动聚焦、Enter 发送、`Ctrl+Enter` 换行。

- [ ] **Step 4: 人工验证摩擦预算**：配置好真实 DeepSeek key 后，从唤起到确认 ≤ 30 秒走一遍。

- [ ] **Step 5: Commit** — `feat: 聊天捕获 + AI 结构化解析 + 确认卡片归档`

---

### Task 5: 时间线页（浏览/筛选/搜索）

**Files:**
- Create: `src/views/TimelineView.vue`, `src/components/EntryDetail.vue`
- Modify: `electron/ipc/handlers.ts`（`timeline:list`、`timeline:search`）
- Test: 扩展 `tests/db/repository.test.ts` 的 filter/分页用例

**Interfaces:**
- Consumes: Task 2 的 `listEntries(filter)`（`filter` 全形为 `{ dateFrom?, dateTo?, kind?, limit, offset }`）、`searchEntries`
- Produces: `window.api.timeline.list(filter): Promise<Entry[]>`、`window.api.timeline.search(kw): Promise<Entry[]>`

- [ ] **Step 1: 失败测试**

```ts
// tests/db/repository.test.ts 追加
it('按日期范围+类型组合过滤，created_at 倒序分页', async () => {
  const repo = new Repo(await initDb(':memory:'))
  await seedThreeDays(repo) // 9-10: sleep+idea, 9-11: event, 9-12: sleep+quote
  const page1 = await repo.listEntries({ dateFrom: '2026-09-10', dateTo: '2026-09-12', kind: 'sleep', limit: 1, offset: 0 })
  const page2 = await repo.listEntries({ dateFrom: '2026-09-10', dateTo: '2026-09-12', kind: 'sleep', limit: 1, offset: 1 })
  expect(page1).toHaveLength(1)
  expect(page2).toHaveLength(1)
  expect(page1[0].id).not.toBe(page2[0].id)
  expect(page1[0].created_at >= page2[0].created_at).toBe(true) // 倒序
})
```
- [ ] **Step 2: 实现 repository 扩展与 IPC**
- [ ] **Step 3: 时间线 UI**：按日分组的虚拟滚动列表；顶部 kind 筛选 chips + 日期范围 + 搜索框（调 searchEntries）；点条目开 `EntryDetail` 抽屉（raw_text 与 content 对照展示，可改 content——raw 永不可改）
- [ ] **Step 4: Commit** — `feat: 时间线页，按日分组浏览/多条件筛选/全文搜索`

---

### Task 6: 分析引擎（流水线 + 有界 Agent）+ 报告生成

**Files:**
- Create: `electron/analysis/engine.ts`, `electron/analysis/tools.ts`, `electron/scheduler.ts`
- Modify: `electron/adapters/llm.ts`（支持 tool_calls 循环）
- Test: `tests/analysis/engine.test.ts`, `tests/analysis/tools.test.ts`

**Interfaces:**
- Produces: `analyzeDay(date: string): Promise<Report>`（核心入口，严格按 spec §6.1 流水线：读当日 entries → 有界工具循环（≤6 次）→ 更新 threads → 生成报告 → 写 reports 表）
- Produces: `Repository.upsertThread(t: { id?, title, description, status }): Promise<Thread>` 与 `Repository.associateEntryToThread(entryId, threadId): Promise<void>`（Task 2 已建表，本任务启用）
- Produces: `Scheduler.ensureReportForToday(): Promise<Report | null>`（当日首开触发；无当日 entries 返回 null）
- Produces: `window.api.reports.get(date)` / `.list()` / `.generate(date)`

- [ ] **Step 1: 失败测试三个本地工具**（query_entries 按关键词/日期查；get_thread 空实现先返回 []，v2 补 thread 维护；correlate 对 mock 数据算出睡眠-情绪相关系数）

```ts
// tests/analysis/tools.test.ts（节选）
it('correlate 计算睡眠时长与负面事件数的负相关', async () => {
  const db = await seededDb() // 7 天：睡得少的日子负面事件多
  const r = await correlate(db, 'sleep.hours', 'event.negative_count', '2026-09-01', '2026-09-07')
  expect(r.coefficient).toBeLessThan(-0.5)
})
```

- [ ] **Step 2: 失败测试引擎主流程**（mock LLM：工具调用请求 2 次→返回报告 Markdown；断言：报告入库、meta 记录 token 与引用 entry ids、工具调用次数 ≤ 6）

- [ ] **Step 3: 实现 tool-calls 循环**（OpenAI tools 协议；超 6 次强制注入「立即撰写报告」收尾指令；LLM 输出非 JSON/空报告时重试 1 次后落 `meta.degraded: true`）

- [ ] **Step 3.5: 实现 threads 更新（spec §6.1「更新 threads」步骤）**：报告调用要求 LLM 在 JSON 载荷中同时返回 `{ report_md, threads: [{ title, description, status, linked_entry_ids }] }`；引擎据返回值 `upsertThread` + `associateEntryToThread`（按 title 幂等匹配已有线）。此后 `get_thread` 工具返回真实数据。对应测试：mock LLM 返回含 threads 的载荷 → 断言 threads/entry_threads 表出现新行；二次分析同 title 线不重复建行。

- [ ] **Step 4: 实现调度器**（app ready 后 `ensureReportForToday()`；`reports:generate` IPC 供设置页/报告页手动补生成任意日期）

- [ ] **Step 5: Commit** — `feat: 分析引擎（固定流水线+≤6次有界工具循环）+ 日报/周报生成 + 当日首开调度`

---

### Task 7: 报告页 + Markdown 导出 + 每日备份

**Files:**
- Create: `src/views/ReportsView.vue`, `src/components/ReportViewer.vue`, `electron/export/markdown.ts`, `electron/store/backup.ts`
- Modify: `electron/ipc/handlers.ts`（`reports:*`、`export:md`、`backup:run`）
- Test: `tests/export/markdown.test.ts`

**Interfaces:**
- Consumes: Task 6 的 reports 数据
- Produces: `exportMarkdown(report): Promise<{path: string}>`（写 `<dataDir>/exports/YYYY-MM-DD-日报.md`）；`runBackup(): Promise<void>`（`mindtrace.db` → `backups/mindtrace-YYYY-MM-DD.db`，保留 30 份）

- [ ] **Step 1: 失败测试导出器**（生成文件名/内容含日期与报告正文；已存在同名覆盖）

- [ ] **Step 2: 失败测试备份轮转**（造 31 份→断言最旧被删）

- [ ] **Step 3: 实现**；报告页 UI：日报/周报 Tab + 归档列表 + `ReportViewer` 渲染 Markdown（`marked` + DOMPurify，渲染进程本地依赖）+「导出 Markdown」按钮（成功后 toast 显示路径）+「立即生成」下拉（选任意日期）

- [ ] **Step 4: 人工验收对照 spec §2.2 成功标准逐条打勾；Commit** — `feat: 报告页/MD导出/每日备份轮转，MVP 功能闭环`

- [ ] **Step 5: 里程碑 push** — `git push`（MVP 功能全部完成）

---

### Task 8: electron-builder 打包 + 端到端人工验收

**Files:**
- Modify: `package.json`（`electron-builder` 配置：nsis 安装包、sql.js wasm 与 `dist/` 打进 asar、`extraResources` 含 wasm）
- Create: `docs/user-guide.md`（中文用户手册：首次配置/录入/读报告/备份恢复）
- Test: 冒烟测试 + 人工清单

**Interfaces:**
- Produces: `pnpm dist` 产出 Windows 安装包；安装后应用可独立运行（不依赖开发环境）

- [ ] **Step 1: 配置 electron-builder 并出包**（nsis x64；注意 sql.js 的 `sql-wasm.wasm` 必须进 `extraResources` 且主进程按 `process.resourcesPath` 定位）
- [ ] **Step 2: 安装包装机验收**：装到本机 → 配置 DeepSeek → 录入 3 天数据 → 生成日报/周报 → 导出 MD → 重启验证数据仍在
- [ ] **Step 3: 验收清单逐项对照 spec §2.2（30 秒摩擦/报告有价值/数据主权/可换模型）**
- [ ] **Step 4: 写用户手册并 commit** — `feat: Windows 安装包打包 + 中文用户手册，MVP 完成`
- [ ] **Step 5: 打 tag `v0.1.0` 并 push** — `git push --tags`
