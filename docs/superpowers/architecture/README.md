# 架构结构基线（目录入口）

本目录保存 MindTrace 的**架构结构基线**，用于回答两个问题：

1. 新增的代码应该放在哪里？
2. 什么时候允许导出、什么时候允许删除？

## 文件导航

| 文件 | 作用 |
|---|---|
| [structure-baseline.md](structure-baseline.md) | 规则主体：共享契约落位、渲染纯逻辑边界、IPC 按域拆分、导出／删除准入、四项保留例外、新代码落位速查表 |

## 什么时候必须读

- 新增跨进程共享类型、渲染层纯工具、IPC 能力域、大型页面逻辑前；
- 准备做一次结构治理（拆分、搬迁、收窄导出、删除声明）前；
- 评审他人改动是否放错了位置时。

## 与仓库其他文档的关系

| 文档 | 关系 |
|---|---|
| `AGENTS.md` | 仓库级强制约定，指向本目录并声明本目录为结构决策的权威出处 |
| `docs/superpowers/specs/` | 早期设计规格，描述"要做什么"，不描述"代码放哪" |
| `docs/superpowers/plans/` | 历史实施计划，不描述代码落位；其中 Global Constraints（如禁用原生模块、`entries.raw_text` 永不修改或删除、API Key 用 safeStorage 加密）仍属有效约束 |
| `docs/user-guide.md` | 面向使用者的功能说明 |
| `docs/ai-content-contract.md` | AI 输出内容契约，与本基线互补 |

## 权威性边界

- 本目录是**结构决策的唯一权威出处**。与目录习惯冲突时，以本目录为准。
- 若实际代码与本基线不一致，**以代码事实为准**：先向用户报告差异，再通过单独批准的治理波次更新本文件；不得自行放宽规则。
- 修改本目录属于治理改动，须在 `architecture-governance` 分支完成并单独获批，不与业务功能混在同一提交。

## 维护方式

每完成一次结构治理波次（提交后），在 `structure-baseline.md` 的「基线演进表」追加一行，写清版本、日期、提交 SHA、新增或收紧的规则、当时的实测指标。**只清理不立规矩的治理不算完成。**

## 改完基线后如何自检

本文件中的规则都配有可执行复检命令，改完基线或代码后至少跑这两条确认没有自相矛盾：

```bash
# 1. 共享契约仍只有一处声明（期望三行且都在 electron/types.ts）
git grep -n -E '^export interface (KbFolder|KbItem|TimelineRow)\b' -- electron src

# 2. 四项保留例外仍在（期望恰好四行）
git grep -n -E 'export (function|interface|type) (resetContext|AccountSummary|GenerateReportResult|SleepContent)\b' -- electron
```

注意：本机不保证安装 `rg`（ripgrep），文档统一使用 `git grep`，避免复制后命令无法执行。
