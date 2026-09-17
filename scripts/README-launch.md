# MindTrace 打开方式

## 方式一：一键启动（默认始终打开最新版本）

双击项目根目录的 **`启动MindTrace.bat`**。

启动器**默认从源码构建并运行**，因此打开的永远是最新版本，不会因为 `release/` 里留着旧包而看到过期界面。

工作流程：
1. 检查仓库内的 `node_modules/electron` 是否已安装
2. 使用 Electron 内置的 Node.js 执行 `scripts/check-stale.mjs`，比对 `dist/` 与源码（`src/`、`electron/`、`index.html`、`vite.config.mts`、`package.json`）的修改时间
   - 源码更新或 `dist/` 不存在 → 直接调用本地 `vite` / `tsc` 构建，不依赖系统 Node 或 NVM
   - 已是最新 → 跳过编译，直接启动
3. 启动 Electron 加载 `dist/index.html`，随后启动器窗口自行关闭

可用参数：

| 参数 | 作用 |
| --- | --- |
| （无） | 构建（如需）+ 从源码启动，始终最新版 |
| `--rebuild` | 强制重新构建后再启动 |
| `--packaged` | 直接打开 `release/win-unpacked/MindTrace.exe`（**可能是旧版**） |

> Mock AI 不再随启动器自动运行。需要时另开一个终端执行 `pnpm mock`。

**仅开发模式使用 Mock AI 时，需在设置页配置一次**（之后永久记住）：
- 提供商预设：选「自定义」
- Base URL：`http://localhost:8787/v1`
- API Key：随便填，如 `mock`
- 点「拉取模型列表」→ 选 `mock-chat` → 保存

以 `--packaged` 打开免安装版时不会自动启动 Mock AI；需要 AI 功能时，请在设置页选择 DeepSeek 等真实提供商并填写对应 API Key。

> 前提：项目依赖已经安装并存在 `node_modules/electron`。默认源码启动使用 Electron 内置 Node.js，不要求 NVM 当前已激活。
> 若 Node.js 不可用但存在免安装版，启动器会退回打开免安装版并提示其可能不是最新。

> `release/` 已被 Git 忽略，GitHub 新克隆的项目不会包含免安装正式版；这种情况下必须先配置 Node.js 并执行 `pnpm install`（或 `npm install`）。

## 方式二：安装正式版（桌面图标，独立运行）

```bash
pnpm dist
```

产出 `release/MindTrace-Setup-0.4.0.exe` → 双击安装 → 桌面出现 **MindTrace** 图标，以后点图标即开。

安装版配置真实 AI 时：设置页选 DeepSeek 等预设 → 填真实 Key。想体验完整功能（含联网搜索推荐）可再去 tavily.com 免费申请一个搜索 Key。

## 数据在哪里

- 开发模式数据：`%APPDATA%/mindtrace/data/`（与安装版共用位置，切换模式数据不丢）
- 备份：`数据目录/backups/`，导出的报告：`数据目录/exports/`
