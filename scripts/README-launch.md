# MindTrace 打开方式

## 方式一：一键启动（开发模式，无需安装、无需 API Key）

双击项目根目录的 **`启动MindTrace.bat`**。

它会：
1. 后台启动 Mock AI 服务器（端口 8787）——**替代 API Key**
2. 编译并打开 MindTrace 窗口，窗口就绪后自动弹到前台

> 启动器窗口会在检测到应用后自动关闭。如果 20~40 秒后仍没看到窗口，请看任务栏有没有 MindTrace 图标（可能被最小化），或检查被最小化的 "MindTrace App" 窗口里的报错信息。

**首次使用需在设置页配置一次**（之后永久记住）：
- 提供商预设：选「自定义」
- Base URL：`http://localhost:8787/v1`
- API Key：随便填，如 `mock`
- 点「拉取模型列表」→ 选 `mock-chat` → 保存

> 前提：电脑装过 Node.js 和 pnpm（你已经有）。

## 方式二：安装正式版（桌面图标，独立运行）

```bash
pnpm dist
```

产出 `release/MindTrace Setup 0.2.0.exe` → 双击安装 → 桌面出现 **MindTrace** 图标，以后点图标即开。

安装版配置真实 AI 时：设置页选 DeepSeek 等预设 → 填真实 Key。想体验完整功能（含联网搜索推荐）可再去 tavily.com 免费申请一个搜索 Key。

## 数据在哪里

- 开发模式数据：`%APPDATA%/mindtrace/data/`（与安装版共用位置，切换模式数据不丢）
- 备份：`数据目录/backups/`，导出的报告：`数据目录/exports/`
