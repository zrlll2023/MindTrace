# MindTrace

> 本地优先的个人生活记录、知识整理与 AI 分析桌面应用。

[![Release](https://img.shields.io/github/v/release/zrlll2023/MindTrace?display_name=tag&sort=semver)](https://github.com/zrlll2023/MindTrace/releases/latest)
[![Release MindTrace](https://github.com/zrlll2023/MindTrace/actions/workflows/release.yml/badge.svg)](https://github.com/zrlll2023/MindTrace/actions/workflows/release.yml)
[![License](https://img.shields.io/github/license/zrlll2023/MindTrace)](LICENSE)

MindTrace 希望解决一个很具体的问题：生活记录散落在备忘录、聊天记录和文件里，写下之后却很难再次利用。

它把日常记录、时间线、知识资料、个人趋势和 AI 报告放进同一个 Windows 客户端，让一条随手记录可以继续进入知识库、参与检索和报告分析，同时把数据库与密钥留在用户自己的电脑上。

## 下载与安装

普通用户无需克隆仓库，也不需要安装 Node.js。

[**前往 Releases 下载最新版 MindTrace**](https://github.com/zrlll2023/MindTrace/releases/latest)

下载其中的 Windows 安装包并按提示安装：

```text
MindTrace-Setup-x.y.z.exe
```

系统要求：Windows 10/11 x64。

> 从 `v0.3.0` 开始，正式安装版可以在应用左下角检查和下载后续版本。通过 BAT、`pnpm dev` 或 `electron .` 启动的源码开发模式不会执行应用更新。

## MindTrace 能做什么

### 记录，而不只是保存文字

- 使用手动直录快速保存睡眠、事件、对话、句子、想法和其他内容。
- 也可以把一段自然语言交给 AI，拆解、检查后再确认归档。
- 非睡眠记录可以同时加入知识库，并在记录时选择或创建文件夹。
- AI 快速记录保留一个可跨重启恢复的持久会话；已经归档的数据不会因清空会话而删除。

### 用时间线回看生活

- 按日期浏览全部记录，并按类型、日期范围或关键词筛选。
- 原始记录保持只读，结构化内容可以修正。
- 语义搜索开启后，可以找回“表达不同但含义相近”的旧记录。

### 把记录沉淀为知识

- 使用文件夹整理知识资料，记录收录原因和个人感受。
- 支持导入 Markdown、TXT、DOCX、PPTX、XLSX 和 HTML 文件。
- 支持 AI 总结、内容延伸，以及关键词与语义混合检索。
- 可导入 ChatGPT、Claude 官方导出的对话 ZIP：一个完整会话保存为一条知识资料，时间线只保留一条摘要。
- 重复导入同一会话会自动跳过，避免产生重复资料。

### 生成个人报告与趋势

- 根据记录生成日报和周报，并导出为 Markdown。
- 在“我的”页面维护名称、称呼、职业/身份、所在地、个人简介、目标和兴趣。
- 查看睡眠、负面事件和记录趋势，并按日期范围筛选。
- AI 识别出的个人资料只会成为待确认草稿；手动填写的资料始终优先，不会被 AI 覆盖。

### 更深入地检索和分析

- 支持全文检索与 Embedding 语义搜索。
- 使用 Chunking 对长资料分块，并返回具体命中片段。
- 使用 RRF 融合关键词与语义结果。
- 可选用 AI 查询扩展和 LLM Reranking 对候选结果再次精排。
- 未配置 Embedding 或 AI 服务时，基础记录、知识管理和关键词搜索仍可使用。

## 本地优先意味着什么

MindTrace 不依赖自建云端账号或 MindTrace 服务器。默认数据目录为：

```text
%APPDATA%\mindtrace\data\
```

| 内容 | 本地存储方式 |
| --- | --- |
| 记录、时间线、报告、知识库、资料与索引 | `mindtrace.db` |
| 数据库备份 | `backups/`，默认保留最近 30 份 |
| 导出的 Markdown 报告 | `exports/` |
| AI 与搜索服务 API Key | `secrets.bin`，使用 Windows DPAPI 加密 |

设置页可以安全迁移数据目录。迁移前会检查目标目录、写入权限和剩余空间，复制后逐文件校验；旧目录不会自动删除，新目录不可用时也不会静默创建空数据库。

正常更新程序或重新安装不会删除上述用户数据。尽管如此，在移动目录、恢复备份或进行重要升级前，仍建议保留一份独立备份。

## AI 与隐私边界

基础记录和知识管理不要求配置 AI。需要 AI 解析、报告、总结、语义能力或联网推荐时，可以在设置中选择：

- DeepSeek
- 智谱 GLM
- Moonshot Kimi
- SiliconFlow
- Ollama
- 其他 OpenAI 兼容服务

提供商预设自带常用模型列表，不填写 API Key 也可以先选择模型；“刷新账户可用模型”和真实请求是否需要 Key，由具体服务决定。Ollama 等本地服务通常无需 Key。

API Key 会加密保存在本机，但发送给外部 AI 或搜索服务的请求仍可能离开设备。出网脱敏默认开启，用于减少人名、账号等识别信息；对于不希望交给第三方处理的内容，请使用本地模型或不要启用相关在线能力。

## 基本使用流程

1. 安装并打开 MindTrace。
2. 在“记录”中使用手动直录，或按需配置 AI 快速记录。
3. 在“时间线”中回看、筛选和搜索历史。
4. 将值得长期保留的内容收入“知识库”，或导入文件与 AI 对话。
5. 在“我的”中维护个人资料和查看趋势。
6. 在“报告”中生成日报、周报并导出 Markdown。

更详细的操作方法请查看 [MindTrace 用户手册](docs/user-guide.md)。

## 当前版本

当前正式版本为 [`v0.4.0`](https://github.com/zrlll2023/MindTrace/releases/tag/v0.4.0)。主要更新包括：

- 完善 AI 快速记录归档流程，解析内容可稳定写入时间线和知识库。
- 保存后保留解析结果并显示完成反馈，支持一键撤回本次时间线和知识资料。
- 自动识别、恢复和保护 AI 快速记录系统目录，避免误删除、同名冲突和导入混用。
- 修复知识资料编辑的假成功问题，并让 AI 记录列表摘要随正文同步更新。
- 优化清空对话、消息时间、最新对话定位和发生时间选择体验。
- 完善睡眠时间、生活趋势、报告导出和实验室设置的可靠性。
- 日报与周报生成内容统一使用宋体，同时保持原有字号和内容层级。

完整内容请查看 [v0.4.0 Release Notes](https://github.com/zrlll2023/MindTrace/releases/tag/v0.4.0)。

## 开发者指南

只有参与开发或希望从源码运行时，才需要以下环境：

- Node.js `^20.19.0 || >=22.12.0`，推荐 Node.js 22
- pnpm `10.34.5`

```powershell
git clone https://github.com/zrlll2023/MindTrace.git
cd MindTrace
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动 Vite 与 Electron 开发环境 |
| `pnpm mock` | 启动本地 Mock AI 服务 |
| `pnpm typecheck` | 检查 Vue、TypeScript 与 Electron 类型 |
| `pnpm build` | 构建前端并编译 Electron 主进程 |
| `pnpm test` | 运行 Vitest 测试 |
| `pnpm dist` | 构建 Windows NSIS 安装包 |

仓库根目录的 `启动MindTrace.bat` 面向源码开发与本地调试，不是普通用户的安装入口。启动器的完整说明见 [开发版启动说明](scripts/README-launch.md)。

## 技术栈

- Electron 44、Vue 3、TypeScript、Vite 8、Pinia、Vue Router
- sql.js 本地数据库与全文检索
- OpenAI 兼容的 Chat Completions、Models 与 Embeddings 接口
- Vitest、electron-builder、NSIS、electron-updater

## 参与与反馈

发现问题或有功能建议，可以在 [GitHub Issues](https://github.com/zrlll2023/MindTrace/issues) 提交。请不要在 Issue、截图或日志中公开真实 API Key、私人记录和其他敏感数据。

## License

[MIT](LICENSE)
