# MindTrace 架构结构基线

版本：v7 及以前（汇总），最后更新 2026-10-20。

本文件回答一个问题：**新写的代码应该放在哪里，什么时候允许导出或删除。**

它不是设计文档，也不是风格指南，而是一份可以直接照着执行的落位决策表。动手前先查表，不要凭目录名或习惯猜测。

## 1. 跨进程共享契约：唯一落位 `electron/types.ts`

| 规则 | 内容 |
|---|---|
| 唯一声明位置 | 所有跨主进程／渲染进程共享的数据结构，唯一声明在 `electron/types.ts` |
| 已落地实例 | `KbFolder`、`KbItem`（v1，波次 1 `12503d0`）；`TimelineRow`（v2，波次 2 `a4141e8`） |
| 使用方式 | 数据库层、AI／导入模块、渲染层一律 `import type` 引入，禁止在数据层或渲染工具层复制声明 |
| 依赖限制 | 共享契约不得引入数据库、Node 或 Electron 运行时依赖 |
| 禁止行为 | 渲染层不得为复用类型而导入主进程数据库运行时模块；不得新建 DTO 副本 |

复检命令（`rg` 非本机必备依赖，统一用 `git grep`）：

```bash
git grep -n -E '^export interface (KbFolder|KbItem|TimelineRow)\b' -- electron src
# 期望结果：恰好三行，且全部位于 electron/types.ts
```

## 2. 渲染层纯逻辑：`src/utils/`

| 模块 | 只放什么 | 禁止放什么 |
|---|---|---|
| `src/utils/timeline.ts` | 时间线行转换（`toEntryRow`、`toKnowledgeRow`）、卡片分组（`buildTimelineGroups`）及其展示模型。当前导出 9 项：3 个运行时函数 + `EntryRow`、`KnowledgeRow`、`SleepDayItem`、`ChatItem`、`TimelineItem`、`ChatSessionRow` 6 个页面所需类型；`SleepSegment`、`EntryItem`、`KnowledgeItem`、`TimelineGroupingInput`、`chatDisplayDate`、`makeSleepDay` 保持内部 | Vue 响应式状态、IO、`window.api`、DOM、IPC、数据库、时钟 |
| `src/utils/sleep.ts` | 睡眠内容**解析**（唯一实现）。注意与主进程侧 `electron/analysis/sleep.ts` 区分：后者负责睡眠段**聚合统计**（`summarizeSleepDay`、`sleepContext`），两者职责不同，不要合并 | 数据库读写的编排逻辑 |
| 页面（如 `TimelineView.vue`） | 响应式状态、请求／分页／搜索、详情／编辑、导航、展示文案 | 可独立测试的纯转换 |

约束：

1. 纯模块禁止反向 import 页面，禁止 import Vue／Electron。
2. 运行时命名导出只保留页面真实用到的入口；内部类型与辅助函数不额外导出。
3. 页面内 `computed` 的 `.value` 读取必须留在 `computed` 回调内，不能提前取值（否则筛选／分页切换不刷新）。
4. 纯转换回归放 `tests/timeline-view.test.ts`；数据库契约沿用 `tests/db/timeline*.test.ts`；睡眠解析沿用 `tests/analysis/sleep.test.ts`。

历史行为边界（不得在结构波次顺手修改）：睡眠累计优先取第一条 `daily_total`、隐藏视图以原行恢复、同刻按字符串 key 排序、分组不替代上游过滤。

## 3. 主进程 IPC：按域拆分，`handlers.ts` 只做注册

| 规则 | 内容 |
|---|---|
| 总入口 | `electron/ipc/handlers.ts` 保留 `registerIpcHandlers()`，只做注册与接线 |
| 按域拆分 | 具体域拆到同目录模块，如 `electron/ipc/skills.ts` 导出 `registerSkillHandlers()`，在原注册位置同步调用 |
| 注册时机 | 不在模块顶层或导入期注册；不按目录扫描自动注册 |
| 上下文 | 模块层不得获取 `getContext()`；获取时机与 `try` 边界沿现有回调 |
| 落盘语义 | 仅在操作成功返回 `ok` 后调用一次 `repo.save()`；不新增事务或内存回滚 |
| 错误契约 | 读取类失败继续 reject（不改成 `{ok:false}`）；写类 catch 只返回 `ok:false`／`error`／`skills:[]` |
| 外部契约 | IPC 通道名、preload API 名称、注册数量与顺序不变 |

已落地实例：4A 波次 `b8a1dd3`，`handlers.ts` 技能四回调迁入 `electron/ipc/skills.ts`；**主入口 85 个注册（84 `handle` + 1 `on`）+ 技能模块 4 个 `handle` = 合计 89**，顺序不变。

复检命令：

```bash
git grep -c 'ipcMain.handle(' -- electron/ipc/handlers.ts   # 期望 84
git grep -c 'ipcMain.on(' -- electron/ipc/handlers.ts       # 期望 1
git grep -c 'ipcMain.handle(' -- electron/ipc/skills.ts     # 期望 4
```

## 3.5 渲染层不得导入主进程运行时模块

渲染层（`src/`）只能 `import type` 引入主进程的**类型**，不得引入主进程运行时模块（数据库、分析、适配器等），否则会把 Node／Electron 依赖打进渲染包。

```bash
git grep -n -E "from '\.\./electron/" -- src
# 期望结果：只允许 type-only 导入；当前唯一例外是 src/App.vue 的
#   import type { UpdateState } from '../electron/updater'（纯类型，合规）
```

新增任何 `src/` 对 `electron/` 的引用前，先确认它是 `import type` 且不引入运行时依赖。

## 4. 导出准入规则

**允许 `export`：**

- 存在真实的跨文件运行时或类型消费者；
- 明确的测试钩子（如 `resetContext`，源码已注明）；
- 明确的共享契约（跨进程边界类型）。

**不导出：**

- 仅定义文件内部使用的辅助函数、参数类型、返回类型、常量；
- 未出现真实消费者、仅"将来可能用到"的抽象。

**判定纪律：**

- 扫描器报"无引用"**不构成删除依据**，必须另做动态入口核查（字符串 `require`／`import`、包入口、测试钩子）。
- 词频低不等于无用；公开函数签名里使用的本地类型仍参与类型关系。
- 不得为把扫描候选数量归零而删除实现或契约。

## 5. 删除准入规则

删除任何声明，必须同时具备以下材料，并取得**单独批准**：

1. 精确到行号的声明清单；
2. 静态（符号搜索）与动态（字符串引用、包入口、测试）核查结果；
3. 引入历史与当时的真实用途；
4. 前后验证命令与结果（类型检查、相关测试、构建产物哈希）；
5. 限定的恢复方式（基线 SHA + 精确 `git restore` 路径）。

不允许"批量删除""顺手清理""为通过扫描而删"。

## 6. 四项明确保留例外

以下声明**明确保留**，任何波次都不得以"无引用"为由删除：

| 声明 | 位置 | 保留理由 |
|---|---|---|
| `resetContext` | `electron/context.ts:100` | 源码注明的测试钩子 |
| `AccountSummary` | `electron/types.ts:105` | 未接入的共享契约，结构仍对应真实业务 |
| `GenerateReportResult` | `electron/types.ts:262` | 同上 |
| `SleepContent` | `electron/types.ts:41` | 组合类型，其子类型被业务流程实际使用 |

复检命令：

```bash
git grep -n -E 'export (function|interface|type) (resetContext|AccountSummary|GenerateReportResult|SleepContent)\b' -- electron
# 期望结果：恰好四行，位置为 context.ts:100、types.ts:41/105/262
```

## 7. 基线演进表

| 版本 | 日期 | 对应提交 | 本版新增／收紧的规则 | 实测指标（当时口径） |
|---|---|---|---|---|
| v1 | 2026-10-14 | `12503d0` | `KbFolder`／`KbItem` 唯一落位 `electron/types.ts`，使用方一律 `import type` | 两类型各只剩 1 处声明，7／15 个字段与原声明一致；源码 18,566 → 18,545 行，重复片段候选 14 → 9（未排除 AGENT，含测试与脚本） |
| v2 | 2026-10-15 | `f386598` | 3A-1：11 文件／20 项收窄，确立"无跨模块消费者不默认导出" | 候选 64 → 44；43 文件／273 项测试通过 |
| v3 | 2026-10-15 | `2768c5b` | 3A-2：常量取消 export 后的编译变化属预期，不套用"仅减导出赋值"口径 | 候选 44 → 22，78 个构建文件一致 |
| v4 | 2026-10-15 | `40be752` | 3A-3：公开签名间接使用的类型不能按未导出判为无用；组合关系保持完整 | 候选 22 → 5，12 类型／5 函数，128 文件／18,527 行 |
| v5 | 2026-10-19 | `b8a1dd3` | 4A：`handlers.ts` 只注册，技能域拆 `ipc/skills.ts`；不按目录扫描注册 | 主入口 1,225 → 1,187 行，新模块 48 行，89 注册不变 |
| v6 | 2026-10-19 | `82a8028` | 4B：时间线纯转换／分组落 `src/utils/timeline.ts`；睡眠解析唯一实现留 `src/utils/sleep.ts`；纯模块禁止 import Vue／Electron | 页面 1,101 → 944 行，新模块 183 行，77 项新测试 |
| v7 | 2026-10-19 | `5f04e79` | 3B-1：删除未接入的 `ValidateResult<T>`；不得为统一风格重建无消费者泛型；四项例外保留 | 候选 5 → 4，132 文件／18,994 行（已排除 AGENT 本地证据），重复 0、无警告 |

> 波次 2（`a4141e8`）统一了时间线 DTO，但当时未产生独立的基线版本号，其规则并入 v2 的共享类型前提；此处不虚设版本。

**口径警示**：v1 的 18,566／18,545 行未排除 `AGENT/`；v4、v7 的统计已显式排除 `AGENT/` 本地证据。三种数字使用同一扫描脚本的"含测试与脚本"范围，但排除项不同，**不可直接相减**。

## 8. 新代码落位速查表

| 我要新增…… | 放这里 | 关键约束 |
|---|---|---|
| 跨主／渲染进程共享的数据结构 | `electron/types.ts` | 唯一声明；使用方 `import type`；不引入运行时依赖 |
| 渲染层可独立测试的纯转换 | `src/utils/<领域>.ts` | 不 import Vue／Electron／`window.api`／DOM；不反向依赖页面 |
| 一个新的 IPC 能力域 | `electron/ipc/<域>.ts` + 在 `handlers.ts` 调用 `registerXxxHandlers()` | 不改注册顺序与数量；不在导入期注册；不在模块层取 `getContext()` |
| 页面内的交互／状态／导航 | 对应 `src/views/*.vue` | 只留 Vue 响应式与 IO 编排；纯逻辑下沉 `src/utils/` |
| 睡眠相关解析 | `src/utils/sleep.ts` | 唯一实现，禁止第二份副本 |
| 面向某文件的单元测试 | 优先 `tests/<镜像目录>/<模块>.test.ts`；测 `src/utils/` 纯模块的放 `tests/` 根目录（先例：`tests/timeline-view.test.ts`、`tests/timeline-moment.test.ts`） | 不改既有测试期待值来迁就实现 |
| 一个新的导出 | 先证明有跨文件消费者 | 仅内部使用就不要 `export`；测试钩子／共享契约需注明理由 |
| 一次结构删除 | 先出工单 | 五要素齐全 + 单独批准；不得因扫描无引用而删 |

## 9. 权威性与边界

- 本基线由仓库的架构治理波次逐步固化，每条规则都对应一次已提交的改动与验收记录。
- 规则冲突时优先级：用户当前明确指令 > 语义等价与安全 > 本基线 > 目录习惯。
- 若实际代码与本基线不一致，**以代码事实为准**，先向用户报告差异，再通过单独批准的波次更新本文件；AI 不得自行放宽规则。
- 未验证边界：仓库外消费者、第三方服务、安装包／更新流程均未纳入本基线的验收范围；扫描结果不证明"仓库外无引用"。

## 10. 数据来源与未确认清单

**数据来源**（均为当时的治理文档记录，非本轮重新扫描）：

- v1：`AGENT/context.md`「波次 1 执行结果与结构基线 v1」「结构基线与后续落位规则」
- v2：`AGENT/context.md`「3A-1 导出结构基线 v2」
- v3：`AGENT/context.md`「3A-2 导出结构基线 v3」
- v4：`AGENT/context.md`「3A-3 执行结果与结构基线 v4」
- v5：`AGENT/context.md`「结构基线 v5：技能 IPC 落位与功能清单」
- v6：`AGENT/context.md`「结构基线 v6：时间线纯转换与页面边界」
- v7：`AGENT/context.md`「结构基线 v7：删除与类型准入」
- 四项保留例外：`AGENT/plan.md`「波次 3B」、`AGENT/context.md` v7 第 3 条

**未确认与证据边界：**

### 边界 1：行数口径不可比，复测必须用统一命令

演进表里的文件数／行数来自 `scan_structure.py`，不是 `git ls-files`。两者范围不同（脚本会扫 `scripts/` 与根级配置，且是否排除 `AGENT/` 前后不一致），因此：

- **禁止**把不同版本的行数直接相减得出"治理让代码增多／减少 N 行"的结论。
- v1 的 18,566／18,545 行**未**排除 `AGENT/`；v4、v7 的统计**已**排除。详见 §7 下方的口径警示。

**复测统一用这条命令**（脚本位置因环境而异，先确认路径存在）：

```powershell
# 先确认脚本存在；不存在则说明本机未安装该治理技能，复测需改用其他口径并重新记录基线
Test-Path "$HOME\.codex\skills\jiagou-skill\scripts\scan_structure.py"

# 统一口径：排除本地证据、依赖与构建产物，导出候选上限 100
$env:PYTHONIOENCODING = 'utf-8'
python "$HOME\.codex\skills\jiagou-skill\scripts\scan_structure.py" . --json `
  --max-export-results 100 `
  --exclude-dir .pnpm-store --exclude-dir dist --exclude-dir dist-electron `
  --exclude-dir release --exclude-dir .freebuff --exclude-dir .workbuddy `
  --exclude-dir AGENT
```

**2026-10-20 实测基准**（本轮已运行验证，退出码 0）：

| 指标 | 期望值 |
|---|---|
| `file_count` | 132 |
| `total_source_lines` | 18,994 |
| `unreferenced_exports` | 4 项：`resetContext`、`AccountSummary`、`GenerateReportResult`、`SleepContent` |
| `duplicate_blocks` | 0 |
| `warnings` | 0（空数组，无截断） |

复测结果若与上表不符，先确认是否漏了 `--exclude-dir AGENT`，再判断代码是否真的变化。**不要**把新数字直接和 v1–v6 的旧数字相减。

### 边界 2：扫描候选数不等于死代码数

演进表中的"候选 64 → 44 → 22 → 5 → 4"指**词频近似扫描的报警数量**，不是死代码数量。该扫描看不见：

- 动态加载（如 `handlers.ts` 用 `await import('../knowledge/ai.js')`，扫描器找不到符号引用）；
- 测试钩子（`resetContext` 专供测试，生产代码本就不引用）；
- 字符串属性访问与反射；
- 仓库外消费者（`package.json` 为 `private`，但无法证明无人使用）。

**因此**：候选数下降只能说明"报警减少"，不能说明"删掉了 N 个死代码"。任何删除仍须按 §5「删除准入规则」逐项核查并单独批准。实际案例：3B-1 只删了 `ValidateResult<T>` 一项，是人工确认无消费者后才执行的。

### 边界 3：桌面 UI 与安装包的验收覆盖情况（2026-10-20 更新）

| 范围 | 状态 |
|---|---|
| 波次 1、2、3A-1/2/3、3B-1 | **不含桌面验收**。当时仅跑类型检查、单元／集成测试与生产构建 |
| 波次 4A | 已完成真实 Electron 桌面验收：技能 CRUD、五次临时数据重开与六次原生窗口实测 |
| 波次 4B | 已完成 19 组真实页面快照比对 |
| **2026-10-20 补充实机验收** | **已完成两级实机验证**：①最小冒烟（1 进程、7 路由渲染、IPC 正常、退出码 0）；②完整回归（技能新增／修改／停用／启用／删除 + 5 次进程重启持久化、6 进程退出码全 0、7 张截图）。证据：`AGENT/validation-final/README.md` |
| 安装包与自动更新 | **仍未验收**。`package.json` 的 `dist` 脚本（`electron-builder --win`）从未在本轮执行；`release/` 内的安装包为早期旧产物 |
| 真实第三方 AI 服务 | **仍未验收**。全部测试与实机验收使用 Mock LLM 或空 model，未调用真实 API |

结论：**不要把"架构治理验收通过"理解为"产品全部功能已验证"**。治理波次只保证结构改动不破坏既有行为，桌面与外部服务各有独立的验收边界。

### 边界 4：仓库外消费者未验证

- `package.json` 标记为 `private: true` 且无 `exports` 字段，仓库内未发现跨模块或字符串形式的消费者。
- 但**无法证明**仓库外不存在任何引用（例如其他本地项目直接 import 本仓文件）。
- 因此：任何"某导出无人使用"的结论，其适用范围**仅限本仓库源码**，不覆盖仓库外。
- 相应推论：删除导出前的核查必须包含动态入口与测试钩子检查（见 §5），不能只依赖 `git grep` 结果。
