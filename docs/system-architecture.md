---
title: 系统架构与权威流
status: stable
domain: system-architecture
last-reviewed: 2026-07-28
---

# 系统架构与权威流

本文只拥有 SEC 的总体分层、canonical/projection 边界和跨域依赖方向。领域内部字段由对应代码合同与领域文档拥有。

## 主链

```text
Product Intent / Existing Workspace
→ Authoring Source + imported Evidence
→ Canonical Workspace Inputs
→ Semantic Frontend
→ Validated Engineering IR
→ Target Profile + Type Algebra
→ Application IR
→ Behavior IR
→ Target Program IR
→ Validated Compilation Snapshot
→ Source / Test / Docs / Gate / Agent / Release Projections
→ Verification / Provenance / Workbench
→ Semantic Mutation / Rollback / Recovery
```

完整 Engineering Workspace Snapshot 是未来跨域聚合目标；在相应 domains 尚未实现前，不用空 optional object 或规划文档冒充已存在的 snapshot。

## 权威分层

1. Authoring Source 和明确 Policy 是输入 authority。
2. Builder/validator 产生版本化 canonical state。
3. Lowering 和 Generator 只消费 validated inputs。
4. Artifact、ExplainGraph、ReviewSummary、SemanticView 和报告是 projection。
5. Static/runtime/AI/外部工具输出是 Evidence 或 candidate，不自动升格。

## Workspace zones

- `source/**`：开发者或受控 Mutation 拥有的 authoring/governed source。
- `project/**`：生成目标；人工修改是 Drift/Override。
- `control/**`：Lock、Verification、Provenance、Review、Workflow 等治理投影。
- `.sec/**`：可删除、可重建的本地运行状态。

## 单写者与依赖方向

每个 canonical state、identity/revision algorithm、pipeline stage、writer 和 public facade 只有一个 owner。Adapter、Workbench、AI、Provider 与 Backend 不得反向定义上游语义。迁移必须逐个 consumer 切换并删除旧 writer，不能长期双写。
