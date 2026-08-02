---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-02
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@6cc3bf8a3b655bebf85dfca3f065c9842207c086`、已合并 PR #196（active documentation corpus）、PR #199–#204、PR #210–#214、PR #218、PR #220、开放 PR #227、开放 integrity Issues #215/#216/#217 与当前 Review/CI 重新计算。

`main` 已具备 active documentation authority、统一 Verification Result vocabulary、claim-based product summary、affected-selection fail-closed、content-identity Test Impact cache、canonical text bytes、exact default-base repository audit、merge bootstrap、bounded-parallel fast feedback 与 V3 parallel Work Package 骨架。它们是已经进入主干的实现，不等于完整 Verification Truth、正式多包并行、自动选择、Evidence DAG、Brownfield 或 SEC-TS MVP 已完成。

稳定横切顺序继续保持：

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
- 根因：PR #211 的 current writer 与 `VerificationReport` 已产生 `summary.claimSummary`，旧 artifact validator 仍只接受 legacy summary；第一版候选又只逐字段检查 aggregate，可能接受 `overallStatus: passed` 但内部 claim 已失败的矛盾 Evidence。
- 当前闭包：同时修复合法 current-writer report 被误拒绝和矛盾 claim aggregate 被错误接受；复用 canonical gate validator，校验 status/reason、状态格、唯一 claim/gate identity、contributing gate 引用及 claim/gate 支撑关系。
- 控制面：`affected-selection-trust-boundary-v1` 从 live manifests 原子归档；pointer、rolling plan 与 manifest digest 必须一致。
- 退出：focused regression、existing semantic-mutation adapter regression、typecheck、docs doctor、repository audit、exact-head hosted Quick 与独立 Review 全部通过；全部 review threads 解决；single-parent exact candidate 合并并从新 `main` readback；随后关闭 #217。

## 已完成并在本次接管中归档

### affected-selection-trust-boundary-v1（Issue #206 / PR #220）

- source 变化且选择闭包为空/未知时 fail-closed，不再 exit 0。
- Test Impact V1 cache 使用 source digest 与 parser/contract/schema envelope；read/stat/parse failure 不能静默减少闭包。
- 本 Work Package 接管后，旧 manifest 从 `docs/work-packages/` 移至 `docs/archive/work-packages/`。
- Issue #206 的最终关闭还需以新主干 readback确认其完成定义与控制面收口均成立。

## #227 合并后的严格顺序

### 1. #215 Verification Claim Aggregate Correctness

优先级：integrity-critical。

必须闭合 owning environment、order-independent status lattice、not-applicable 与 runtime no-test truth。它决定现有 Verification 是否能作为后续 Impact、Evidence、并行和产品 Mutation 的可信基础。

### 2. #216 Release Verification Credential Closure

移除 release workflow 中与 `persist-credentials: false` 冲突的 raw `git fetch`，并以真实 single-parent release head 跑通 end-to-end release verification；contract test 不能替代物理 workflow。

### 3. #207 Parallel Resolver Correctness V1.1

修正 `requires`、`orderedAfter`、`conflictsWith`、cycle/missing-target、global writer 与 Integration Epoch。完成前只允许并行只读研究，不授权多个正式写入 Work Package。

### 4. 一个产品自举纵切片

在不存在新的 P0/P1 integrity blocker 时，必须恢复产品线：让 SEC 对自身一个受控子系统完成 Responsibility/Source Binding 观察、Impact、Controlled Mutation、actual Delta、Verification 与 rollback/accepted 闭环。不得继续以新的元治理系统无限延迟产品结果。

## 全项目设计与文档统一状态

- `docs/authority.json` 与 canonical domain documents 已形成单一文档权威结构；README、Issue、PR body、proposal 和 spike 不得成为第二 authority。
- 全项目最终设计尚未结束：#215/#216/#207 是已证实实现缺口；#222/#224 等仍是未迁移到 canonical authority 的架构候选；关闭的综合 Spike 只提供研究输入，不构成已采用设计。
- 最终“大一统”不是把全部内容塞进一个巨型文档或巨型 PR，而是一个极小 federation kernel、一个 authority registry、一套 identity/revision/verification truth，以及按 domain 分治的唯一 owners。跨域总装只做索引、关系和完成状态，不复制各域算法。
- 后续文档统一必须执行 census → owner 冲突消除 → canonical delta → proposal/archive retirement → docs doctor/repository audit → main readback；不得继续保留多份并列“最终设计”。

## 重算触发

`main`、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、implementation supersede、parallel conflict结果、物理 platform Evidence或全仓审计的新决定性 finding，都会触发 live resolver 与本窗口整体重算。
