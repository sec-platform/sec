---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-02
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@6cc3bf8a3b655bebf85dfca3f065c9842207c086`、已合并 PR #196、PR #199–#204、PR #210–#214、PR #218、PR #220、开放 PR #227、integrity Issues #215/#216/#217、非权威规划输入 Issue #232/#235 与当前 Review/CI 重新计算。

`main` 已具备 active documentation authority、统一 Verification Result vocabulary、claim-based product summary、affected-selection fail-closed、content-identity Test Impact cache、canonical text bytes、exact default-base repository audit、merge bootstrap、bounded-parallel fast feedback 与 V3 parallel Work Package 骨架。它们不等于完整 Verification Truth、正式多包并行、Evidence DAG、Brownfield 或 SEC-TS MVP 已完成。

稳定横切顺序：

```text
Verification Result Truth
→ Semantic Test Impact
→ Failure Epoch → Trusted Bootstrap → Evidence DAG
→ Automatic Feedback / Persistent Resume
```

产品主线继续由 `docs/roadmap.md` 拥有；横切治理不能无限替代 Self-Observation、Source Ownership、Impact 与 Controlled Mutation 的真实纵切片。

## 当前唯一 Work Package

### verification-artifact-claim-summary-v1

- Tracking：Issue #217；Draft PR #227；base `main@6cc3bf8a3b655bebf85dfca3f065c9842207c086`。
- 根因：current writer 已产生 `summary.claimSummary`，旧 artifact validator 仍接受 legacy-only 或让 artifact 自行声明证明自身完整性的 gate/claim inventory。
- 当前闭包：唯一外部 `product-verification-profile` 固定 current-writer gate/claim identity、完整 inventory、lane→gate 投影与 claim definitions；artifact validator 从 fast/runtime/policy reports 独立重建预期 summary，并拒绝缺失、重复、未知、不支持、矛盾或伪造的 Evidence。
- 控制面：`affected-selection-trust-boundary-v1` 从 live manifests 原子归档；pointer、rolling plan 与 manifest git-blob digest 必须一致。
- 退出：focused regressions、semantic-mutation adapter、typecheck、docs doctor、repository audit、exact-head hosted Quick 与独立 Review 通过；全部线程解决；single-parent candidate 合并并从新 `main` readback；随后关闭 #217。

## 候选 Work Package

### 1. verification-claim-aggregate-correctness-v1

- Tracking：Issue #215；stacked Draft PR #234，严格依赖 #227 merge/readback。
- 结果：owning environment、order-independent lattice、not-applicable policy、runtime zero-test truth、duplicate identity 与 supportedClaims 完整性。
- 激活：#227 完成后从 then-latest `main` 重建 focused manifest，不复用 moving stacked head 作为权威候选。

### 2. release-verification-credential-closure-v1

- Tracking：Issue #216。
- 结果：移除 release workflow 与 `persist-credentials: false` 冲突的 raw fetch；真实 single-parent release head 完成 end-to-end physical verification。
- 边界：contract test 不能替代物理 workflow run。

### 3. parallel-resolver-correctness-v1-1

- Tracking：Issue #207。
- 结果：修正 `requires`、`orderedAfter`、`conflictsWith`、cycle/missing-target、global writer 与 Integration Epoch。
- 边界：完成前只允许并行只读研究，不授权多个正式写入 Work Package。

### 4. sec-self-observation-slice-v1

- 结果：SEC 对自身一个受控子系统完成 Responsibility/Source Binding 观察、Impact、Controlled Mutation、actual Delta、Verification 与 rollback/accepted 闭环。
- 激活：#215 后不存在新的 P0/P1 integrity blocker；不得继续以元治理系统无限延迟产品结果。

## 已完成并在本次接管中归档

### affected-selection-trust-boundary-v1

- Issue #206 / PR #220 已进入 `main`。
- source 变化且选择闭包为空/未知时 fail-closed；Test Impact cache 绑定 source digest 与 parser/contract/schema identity。
- 本 Work Package 接管后，旧 manifest 从 `docs/work-packages/` 移至 `docs/archive/work-packages/`。

## 全项目设计与文档统一状态

- `docs/authority.json` 与 canonical domain documents 是当前唯一文档权威；README、Issue、PR body、proposal、spike 与 `docs/work/**` 不取得跨域 canonical ownership。
- Issue #232/PR #233 只保留非权威 convergence record；Issue #235 对全部 registry documents 做迁移总账，正式实现仍须逐 owner、逐 Work Package 进入主干。
- #215/#216/#207 是已证实实现缺口；#222/#224 等是等待对应 canonical owner 迁移的规划输入；关闭综合 Spike 只提供 research Evidence。
- 文档统一执行 registry census → duplicate/overlap diagnosis → existing-owner delta → consumer migration → proposal/archive retirement → docs doctor/repository audit → main readback；禁止并列“最终设计”或巨型全域 PR。

## 重算触发

`main`、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership 反证、implementation supersede、parallel conflict、物理 platform Evidence 或全仓审计的新决定性 finding，都会触发 live resolver 与本窗口整体重算。
