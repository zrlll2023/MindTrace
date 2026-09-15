# MindTrace

MindTrace 是一款本地优先的个人生活记录与 AI 分析桌面应用。它将日常记录、时间线、知识资料和 AI 生成的日报/周报集中在一个 Windows 客户端中，数据库与密钥保存在本机。

仓库地址：[github.com/zrlll2023/MindTrace](https://github.com/zrlll2023/MindTrace)

## 主要功能

- **记录**：支持手动直录和 AI 辅助拆解，可编辑类型、内容和时间后归档。
- **时间线**：按日期浏览，通过类型、日期范围和全文关键词筛选历史记录。
- **报告**：基于记录生成日报和周报，并导出为 Markdown。
- **知识库**：按文件夹整理资料，记录收录原因与个人感受，支持 AI 总结和内容延伸。
- **实验室**：提供相关性仪表盘和引导式研究等实验能力。
- **AI 对话导入**：导入 ChatGPT、Claude 官方导出 ZIP，自动识别并按消息去重。
- **搜索**：支持关键词、语义、RRF 混合检索、长文本分块和 LLM 精排；未配置 Embedding 时自动退回关键词检索。
- **本地数据保护**：API Key 使用 Windows DPAPI 加密；支持出网脱敏、每日数据库备份和报告导出。

## 环境要求

- Windows 10/11 x64
- Node.js `^20.19.0 || >=22.12.0`，推荐 Node.js 22
- pnpm

> Git 已忽略 `node_modules/`、`dist/`、`dist-electron/` 和 `release/`。从 GitHub 新克隆的仓库不包含依赖、构建产物或安装包。

## 快速开始

### 方式一：使用项目内已有的免安装版

如果当前目录已经存在 `release/win-unpacked/MindTrace.exe`，双击根目录的 `启动MindTrace.bat`。启动器会直接打开免安装版，不创建额外的开发终端。

也可以直接双击：

```text
release\win-unpacked\MindTrace.exe
```

### 方式二：从 GitHub 源码启动

```powershell
git clone https://github.com/zrlll2023/MindTrace.git
cd MindTrace
nvm install 22
nvm use 22
npm install -g pnpm
pnpm install
pnpm dev
```

如果依赖已经安装，也可以双击 `启动MindTrace.bat`。当目录中没有免安装版时，启动器会检查 Node.js/pnpm，启动 Mock AI，然后在同一个控制台运行开发版。

### 方式三：构建 Windows 安装包

```powershell
pnpm install
pnpm dist
```

构建完成后，安装包和免安装目录位于 `release/`：

```text
release\MindTrace Setup 0.2.0.exe
release\win-unpacked\MindTrace.exe
```

## AI 配置

### 使用真实 AI 服务

打开 **设置** 页面：

1. 选择 DeepSeek、智谱 GLM、Moonshot Kimi、SiliconFlow、Ollama 或自定义提供商。
2. 点击“拉取模型列表”并选择模型。
3. 填写 API Key，测试连接后保存。
4. 如需语义搜索，开启 Embedding 并填写该提供商支持的 Embedding 模型。
5. 如需报告中的联网推荐，可配置 Tavily 或 Bocha 搜索服务。

发送给外部 AI 或搜索服务的内容可能离开本机。出网脱敏默认开启，但仍应避免记录不希望交给第三方处理的敏感信息；使用 Ollama 等本地服务可以减少外部传输。

### 使用本地 Mock AI

Mock 用于开发和功能体验，不需要真实 API Key：

```powershell
pnpm mock
```

然后在另一个终端运行：

```powershell
pnpm dev
```

在设置页填写：

```text
提供商：自定义
Base URL：http://localhost:8787/v1
API Key：mock
模型：mock-chat
```

## 基本使用

1. 在 **记录** 页选择手动记录或 AI 辅助模式，填写内容并确认归档。
2. 在 **时间线** 中搜索、筛选或修正结构化内容；原始记录保持只读。
3. 在 **报告** 中选择日期或周，生成并导出日报/周报。
4. 在 **知识库** 中创建文件夹，手动添加资料或导入 Markdown、TXT、DOCX、PPTX、XLSX、HTML 文件。
5. 在 **设置 → 导入 AI 对话** 中选择 ChatGPT/Claude 官方导出的原始 ZIP。

## 数据与备份

开发版和安装版默认共用以下目录：

```text
%APPDATA%\mindtrace\data\
```

- `mindtrace.db`：记录、报告、知识库及索引数据。
- `backups/`：每日自动备份，默认保留 30 份。
- `exports/`：导出的 Markdown 报告。
- `secrets.bin`：使用 Windows DPAPI 加密后的密钥。

恢复数据前请先关闭 MindTrace，再将目标备份复制回数据目录并重命名为 `mindtrace.db`。

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动 Vite 与 Electron 开发环境 |
| `pnpm mock` | 启动端口 8787 的 Mock AI 服务 |
| `pnpm test` | 运行 Vitest 测试 |
| `pnpm typecheck` | 检查 Vue、TypeScript 与 Electron 类型 |
| `pnpm build` | 构建前端并编译 Electron 主进程 |
| `pnpm dist` | 构建 Windows NSIS 安装包 |

## 技术栈

- Electron 44、Vue 3、TypeScript、Vite 8、Pinia、Vue Router
- sql.js 本地数据库与全文检索
- OpenAI 兼容的 Chat Completions、Models 与 Embeddings 接口
- Vitest、electron-builder、NSIS

## 版本记录

版本边界以 Git 标签为准。当前 `main` 在 `v0.2.0` 标签之后仍有多项功能提交，但 `package.json` 版本尚保持 `0.2.0`，因此单独列为未发布开发版。

### 未发布开发版（`v0.2.0` 之后）

**新增**

- Embedding 语义搜索与相关性仪表盘、引导式研究实验室。
- FTS 与语义结果的 RRF 混合检索，以及 AI 查询扩展。
- 长记录 Chunking 分块索引，搜索结果可定位具体命中片段。
- 对混合搜索 Top 20 结果进行 LLM Reranking 精排。
- 知识库页面：文件夹、资料、收录原因、感受记录、AI 总结与延伸。
- Markdown、TXT、DOCX、PPTX、XLSX、HTML 文件内容导入。
- AI 输出内容契约与结构校验。

**变更**

- 记录页改为“手动直录优先、AI 辅助可选”的双模式。
- 更新全局 UI/UX 设计系统和记录、时间线页面样式。
- 分析引擎与时间线接入混合搜索、分块结果和精排能力。
- 启动器优先打开已有免安装版；源码模式合并开发终端并加强 Node/NVM 检查。

**修复**

- 修复双击启动后 Electron 窗口可能不聚焦、用户看不到窗口的问题。
- 修复设置页必须先保存才能拉取模型列表的问题，现在直接使用表单草稿连接。
- 修复 NVM shim 存在但无活动 Node.js 版本时启动器误判成功的问题。

**删除或替代**

- 以 AI 聊天拆解作为唯一记录入口的交互被双模式取代；未删除历史记录、报告或导入数据能力。

### v0.2.0（2026-09-15）

**新增**

- ChatGPT、Claude 官方导出 ZIP 导入、格式自动识别和消息级去重。
- 邮箱、手机号、证件号、账号、链接和人名的出网脱敏。
- Tavily、Bocha 联网搜索适配器及报告“推荐内容”。
- 本地 Mock LLM 服务和全链路假数据测试。
- 一键启动脚本与启动说明。

**变更**

- 分析引擎可在生成报告时调用联网搜索，并将推荐内容写入报告。
- 设置页增加搜索提供商、搜索密钥和脱敏配置。
- 导入功能引入 `fflate` 读取官方 ZIP。

**修复**

- 导入同一个对话包时跳过已存在消息，避免重复记录。
- 出网脱敏覆盖解析、报告、调度和搜索等外部请求路径。

**删除**

- 没有明确删除用户功能；保留 v0.1.0 的记录、时间线、报告、备份和导出能力。

### v0.1.0（2026-09-15）

**新增**

- Electron + Vue 3 + TypeScript 桌面应用基础框架。
- 基于 sql.js 的五表本地存储、全文搜索与 LIKE 兜底检索。
- DeepSeek、智谱 GLM、Moonshot Kimi、SiliconFlow、Ollama 和自定义 OpenAI 兼容服务配置。
- Windows DPAPI 加密密钥存储。
- AI 辅助记录拆解、确认卡片与归档。
- 按日分组的时间线、类型/日期筛选和全文搜索。
- 有界工具调用分析引擎、日报、周报和当日首开调度。
- Markdown 报告导出、每日备份轮转、Windows NSIS 安装包和中文用户手册。

**变更**

- 设计阶段将桌面框架从 Tauri 调整为 Electron。
- 数据库实现从原生 SQLite 调整为 sql.js，降低 Windows 本地构建依赖。

**修复**

- MVP 阶段补齐数据库落盘、打包资源路径和 Windows 安装配置，使记录到报告形成完整闭环。

**删除或替代**

- 替代了设计阶段计划使用的 Tauri 与原生 SQLite 方案；首个正式版本不存在面向用户的功能删除。
