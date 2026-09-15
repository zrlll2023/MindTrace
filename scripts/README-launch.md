# MindTrace 打开方式

## 方式一：一键启动（优先免安装版，必要时开发模式）

双击项目根目录的 **`启动MindTrace.bat`**。

启动器按以下顺序工作：
1. 本机已有 `release/win-unpacked/MindTrace.exe` 时，直接打开免安装正式版，不启动额外的开发终端
2. 没有正式版产物时，读取并校验 `node --version` 和 `pnpm --version` 的真实输出，再用当前启动器窗口运行 Mock AI 与开发版
3. 两种方式都不可用时，保留错误窗口并显示需要执行的安装命令

> 开发模式只保留启动器自身的一个命令行窗口，并在其中显示错误；不会再为 Mock 和应用重复弹出多个终端。

**仅开发模式使用 Mock AI 时，需在设置页配置一次**（之后永久记住）：
- 提供商预设：选「自定义」
- Base URL：`http://localhost:8787/v1`
- API Key：随便填，如 `mock`
- 点「拉取模型列表」→ 选 `mock-chat` → 保存

免安装正式版不会自动启动 Mock AI；需要 AI 功能时，请在设置页选择 DeepSeek 等真实提供商并填写对应 API Key。

> 开发模式前提：Node.js 22.12+ 已安装并处于活动状态，且已安装 pnpm（Vite 8.3.0 要求 Node.js `^20.19.0 || >=22.12.0`）。仅能在 PATH 中找到 NVM shim 不代表 Node.js 可用；启动器也会隔离某些 NVM shim 对批处理标准输入的错误读取。

> `release/` 已被 Git 忽略，GitHub 新克隆的项目不会包含免安装正式版；这种情况下必须先配置 Node.js/pnpm 并执行 `pnpm install`。

## 方式二：安装正式版（桌面图标，独立运行）

```bash
pnpm dist
```

产出 `release/MindTrace Setup 0.2.0.exe` → 双击安装 → 桌面出现 **MindTrace** 图标，以后点图标即开。

安装版配置真实 AI 时：设置页选 DeepSeek 等预设 → 填真实 Key。想体验完整功能（含联网搜索推荐）可再去 tavily.com 免费申请一个搜索 Key。

## 数据在哪里

- 开发模式数据：`%APPDATA%/mindtrace/data/`（与安装版共用位置，切换模式数据不丢）
- 备份：`数据目录/backups/`，导出的报告：`数据目录/exports/`
