# 搜索质量升级实施计划（Chunking + Reranking）

> 日期：2026-09-15 ｜ 状态：执行中 ｜ 前置：混合搜索已完成（a25bee0）
> 约束：遵守 docs/ai-content-contract.md；禁原生模块；每里程碑 commit+push

## 目标

1. **Chunking（改进索引/召回）**：长条目（尤其导入的 AI 对话）拆分为重叠语义块分别向量化，消除"单条目单向量"的语义稀释——查询能精确命中长文本中的具体话题段落。
2. **Reranking（改进查询/精排）**：混合搜索 RRF 融合后的 top-20 由 LLM 精读重排，显著提升最终排序精度，同时保持成本有界。

## Plan A — Chunking（先做，影响面大）

- **A-1 分块器** `electron/analysis/chunker.ts`
  - `chunkText(text, maxLen=400, overlap=60)`：句号/问号/换行优先切分；超长单句硬切；相邻块重叠 ~60 字防语义截断
  - 返回 `[{ text, start }]`；短文本（≤maxLen）原样返回单块
- **A-2 向量表复合键迁移**：`vectors` 表改为 `(entry_id, chunk_index)` 复合主键 + `chunk_text` 列；幂等迁移（旧单向量表重建）
- **A-3 嵌入流程改造**：`embedMissing` → `embedEntryChunks`：长条目多块嵌入；向量命中返回 `{entry_id, chunk_index, chunk_text, score}`；同条目多块命中去重取最高分
- **A-4 接入与验证**：SemanticSearch/HybridSearch/引擎工具透传 chunk 信息；时间线命中条目显示匹配片段；E2E 新增分块阶段 → **commit + push（里程碑 A）**

## Plan B — Reranking

- **B-1 Reranker** `electron/analysis/reranker.ts`
  - `rerank(query, hits, llm)`：LLM 一次调用批量精读 top-20，输出 JSON `{scores: [{index, relevance}]}`（0~1）
  - 契约闸门：非法输出/失败 → **保持 RRF 原序**（绝不丢结果）；index 越界忽略；分数收敛 [0,1]
- **B-2 设置与接线**：`rerankEnabled` 设置项（默认开）；`hybrid:search` 在 topK>1 且结果≥5 时自动精排
- **B-3 UI 与验证**：时间线显示「已精排」标识；reranker 单测（合法/非法/部分越界/失败保序）+ E2E 阶段 → **commit + push（里程碑 B）**

## 成本预算

- 分块：长条目按 400 字切块，1000 条长记录 ≈ 3~5k 次嵌入调用（一次性）；增量只嵌入新/变更
- 精排：每次搜索 1 次 LLM 调用（top-20 批量打分），仅搜索时发生
