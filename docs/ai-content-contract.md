# MindTrace AI 生成内容契约（通用模板 v1）

> **本文件是所有 AI 生成/解析内容与 MindTrace 软件之间的强制契约。**
> 任何未来由 AI（或 AI 辅助的代码、提示词、导入器、插件）产出的内容，必须符合本契约才能进入软件。
> 目的：保证 AI 输出永远不会破坏数据完整性、UI 渲染或存储结构。

---

## 1. 数据边界（什么能进库）

AI 生成内容只能通过以下 **4 个受控入口**进入软件，每个入口都必须经过对应校验器：

| 入口 | IPC 通道 | 校验器 | 允许的 kind |
|---|---|---|---|
| 聊天捕获解析 | `capture:commit` | `validateParsedEntry` | 六种 kind |
| 对话导入 | `import/service.ts` | 固定 `kind='conversation'` | conversation |
| 报告生成 | `reports:generate*` | `validateReportPayload` | —（写 reports 表） |
| 实验功能（v3+） | `labs:*` | `validateLabsPayload` | — |

**任何其他写入路径一律禁止。** 新功能需要新入口时，必须先在本文件登记并补配套校验器。

## 2. 条目 Schema（entries 表的 AI 产出部分）

```ts
kind ∈ 'sleep' | 'event' | 'conversation' | 'quote' | 'idea' | 'other'   // 白名单，永不新增字符串值
content: object    // 必须能 JSON.parse 且是普通对象；键值见下表
confidence: number // 0~1
```

各 kind 的 content 键约束（未知键**丢弃**并记入 `content._dropped`，不报错不崩溃）：

| kind | 允许键 | 类型 |
|---|---|---|
| sleep | `hours` | number, 0~24 |
| event | `text`, `negative?` | string ≤2000字, boolean |
| conversation | `text`, `with?`, `role?`, `conversation?` | string ≤2000字 |
| quote | `text`, `from?` | string ≤2000字 |
| idea | `text` | string ≤2000字 |
| other | `text` | string ≤2000字 |

**硬性不变量：**
- `raw_text` 永不被 AI 修改或删除（只有 content 可经 `timeline:updateContent` 修正）
- 字符串值必须是纯文本——**禁止 Markdown/HTML 标签**（UI 用纯文本渲染 content），写入前 `sanitizeText()` 剥离
- 禁止以 `_` 开头的业务键（保留给系统）

## 3. 报告 Schema（reports 表）

```ts
{ report_md: string,          // 非空，≤50000 字符，Markdown 仅限标题/列表/引用/粗体/链接
  threads: [                  // 可为空数组
    { title: string ≤60字,    // 必填，唯一键（按 title 幂等 upsert）
      description?: string ≤300字,
      status?: 'active'|'done',  // 其他值一律按 'active'
      linked_entry_ids?: number[] }  // 不存在的 id 静默忽略
  ]
}
```

## 4. 兜底原则（校验失败时怎么办）

1. **绝不崩溃**：非法输入一律降级——解析失败 → `kind='other', confidence=0`；报告载荷损坏 → `meta.degraded=true`
2. **绝不丢数据**：用户原文永远入库，哪怕无法结构化
3. **永不静默扩权**：校验器只接受本契约明示的形状；想接受新形状 → 先改本文件 + 补测试
4. **重试有界**：JSON 解析失败最多重试 1 次，之后降级

## 5. 提示词集成要求

任何新的 AI 功能编写 system prompt 时必须：
1. 引用本契约的 JSON 形状（不给自由发挥空间）
2. 声明"只输出 JSON，无代码块"或明确容错格式
3. 声明字符串长度上限与枚举范围

## 6. 新 AI 功能 checklist（合并前逐项打勾）

- [ ] 输出形状已在本文件登记
- [ ] 有 `validate*` 校验器 + 单元测试（合法/非法/越界/注入 四类用例）
- [ ] 非法输入走兜底路径且有测试覆盖
- [ ] 长度上限、枚举白名单、字符串剥离三件套齐全
- [ ] 新 IPC 通道命名符合 `域:动作` 约定

---

*版本：v1（2026-09-15）。修改本文件 = 修改契约，必须同步更新 `electron/analysis/validators.ts` 与测试。*
