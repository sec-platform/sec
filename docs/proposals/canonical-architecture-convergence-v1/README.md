---
title: SEC Converged Architecture Baseline V1
status: proposal
domain: proposal
tracking: issue-232
exact-main: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
authority: none
merge-policy: extract-focused-canonical-deltas
---

# SEC Converged Architecture Baseline V1

本目录是非权威设计收敛记录，不是当前产品事实，也不应整体合并。

它只保留两个文件：

- `README.md`：人类入口；
- `canonical-plan.yaml`：全部约束、裁决、owner、依赖、测试/Skill/文档策略、迁移和退役的唯一机器记录。

任何重复的 constraints、decision ledger、assembly、DAG、migration 或 execution-policy 文件都必须删除，避免同一未来设计被多处维护。

## 产品裁决

SEC 是确定性的、多领域工程语义编译器，以及建立在同一 canonical state、查询面和 Mutation facade 上的受治理工程变更平台。

```text
Authority and observations
→ typed domain snapshots
→ rebuildable Fact / Assertion projection
→ validated Workspace references
→ Impact and controlled Mutation
→ Verification and Evidence
→ artifacts, operations and product projections
```

拒绝万能 IR、万能图、property-bag Core、候选自证、Skill 拥有权限或状态、cache 冒充 Evidence，以及多个并列“最终设计”。

## 唯一实施主线

```text
PR #227
→ Issue #215 Verification truth
→ select one real SEC subsystem
→ TypeScript Source Program
→ Responsibility self-observation
→ Delta / Impact / Explain
→ minimal Effect / Resource / Capability
→ one governed Mutation with rollback
→ minimal Target / Type / IR
→ three unrelated TypeScript models
→ Compatibility
→ Brownfield Adopt / Normalize
```

Release credential closure、Candidate Closure、Evidence/Run、feedback、Query acceleration、Integration Epoch 和 Web 可以按 `canonical-plan.yaml` 的真实依赖并行或后置，但不得阻塞首个产品闭环。

## 归一化规则

1. `main` 和已登记 canonical owners 始终是现实事实。
2. 本计划中的每项设计只能迁入一个 owner。
3. 每次正式迁移只处理一个不可分割 decision family。
4. 迁移必须同时说明 consumer、兼容、证据和旧表述退役。
5. 所有状态改变节点只有 merge 并完成 new-main readback 后才算完成。
6. 未解决 P1/P2 会阻止本计划冻结。
7. 本目录在所有决策迁移完成后必须归档或删除。

## 当前边界

本分支不得修改：

- `docs/authority.json`；
- canonical domain documents；
- `docs/work/**`；
- product code or tests；
- workflows, package or lock；
- current formal PR #227。

正式采用必须从届时最新 `main` 重新建立聚焦 Work Package，并经过独立 Review、实际测试/Gate、squash merge 和 new-main readback。
