# Graph-It-Live Runtime Evidence 设计记录（历史）

> 状态：historical。本文保留 2026-05-08 的 Evidence 边界决策，不维护当前字段。

## 当时的问题

需要让 AI/开发者使用外部 Repo Graph 获得代码上下文和 Impact Hint，同时避免外部工具污染 SEC 的治理事实与写权限。

## 决策

外部 Graph Provider 只产生 provider-neutral Evidence/Context Overlay：

```text
external provider raw result
→ adapter
→ evidence
→ Context Packet / Review Overlay
```

Evidence：

- 不进入 canonical graph/IR。
- 不成为稳定 Artifact 的默认前置。
- 不扩大 `allowedPaths`。
- 不驱动 Mutation Apply。
- Provider 不分别建立互不兼容的核心 Schema。

## 当前权威

- Evidence/Explain：`docs/08-Verification、Provenance与Graph规范.md`
- AI Context/Permission：`docs/09-AI Runtime、任务信封与治理规范.md`
- Projection/Provider：`docs/11-Workbench与可视化规范.md`
- Fact Authority：`docs/14-Engineering IR与语义事实规范.md`
