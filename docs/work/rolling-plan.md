---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-08
---

# SEC 滚动近期计划

本窗口从 `main@49fdb7cd3be991742061621e3add982107e50367` 重新计算。

Issue #178 `trusted-verifier-causal-closure-v1` 已完成 old-trusted candidate-as-SUT、
独立 Review、squash merge 和 new-main readback并关闭。当前 main 已拥有唯一
`sec-trusted-bootstrap-registry-v1`、78-module exact causal TCB closure、18 个 reviewed
process dispatchers 与 credential-scrubbed candidate-as-SUT workflow；
`scripts/codex/repository-audit.ts` 是 ordinary SUT，不再因位于 `scripts/codex/` 自动进入 TCB。
旧 validation-only PR #331 已关闭且不合并。

当前 #327 首包在实现中发现一个新的真实 trust boundary：Nexus canonical machine ledger
`docs/governance/nexus-absorption-ledger.yaml` 的 strict schema validator
`docs/scripts/docs-doctor-ledgers.ts` 属于 causal TCB。因此 Nexus 29 EPR detailed records
不能与普通 repository-audit 数据拆分机械捆绑；当前包只迁移 #282 records，Nexus 迁移必须
作为单独 trust-aware slice 走 trusted bootstrap。

## 当前唯一 Work Package

### repository-information-data-ownership-v1

- Issue #327。
- 把 Issue #282 的 146 条 deleted/renamed blob exact records 与 16 个 durable claim families
  从 generic `scripts/codex/repository-audit.ts` 迁到
  `scripts/sec-dev/repository-analysis/repository-information-lifecycle.json` 与严格 data contract。
- `repository-audit.ts` 保持唯一 CLI/orchestrator，继续拥有 disposition/classification/detectors
  和 Git physical cross-check，只消费 validated machine data。
- data JSON 不参与 heuristic instruction extraction，避免 prose-shaped records 变成第二 Agent 指令面。
- 本包禁止修改 Nexus ledger/docs-doctor TCB、TCB registry/lock/workflows/merge-gate、package/lock、
  产品 Compiler/IR；不重做 #282 的 47,287 行历史语义审计。

## 候选 Work Package

### 1. nexus-epr-ledger-ownership-migration-v1

- Issue #327 + #178/#311 trust boundary。
- 把 29 个 EPR detailed binding records 从 `repository-audit.ts` 迁入唯一 canonical Nexus
  machine-state owner，同时升级 `sec-nexus-corpus-ledger-v2` strict validator。
- 因 `docs/scripts/docs-doctor-ledgers.ts` 属于 causal TCB，必须由 old/current trusted bootstrap
  对 candidate-as-SUT 验证，更新 exact TCB lock，独立 Review 后才能合并。
- 不借此重写整个 docs-doctor 或 Nexus corpus。

### 2. repository-structural-convergence-next-slice

- Issue #327。
- 从本包与 Nexus migration merge/new-main readback 后的真实 structural census 选择一个 seam：
  `scripts/codex` provider leakage、重复 Git/process/parser primitive、dead compatibility 或 thin-entrypoint。
- 只有 consumer/reachability/trust/ownership Evidence 明确后才 MOVE/MERGE/DELETE；LOC/churn 只作触发信号。

### 3. architecture-decision-enforcement-registry-v1

- Issue #314。
- 首批登记 branch lifecycle、Verification Control Plane、TypeScript 7、Implementation Resolution、
  information lifecycle 与 canonical digest。
- `specified / implemented / verified / enforced / adopted / retired` 由 current-main machine refs、
  physical Evidence、entrypoint/bypass/consumer/retirement closure 决定。

### 4. typescript-7-dual-provider-phase-0-1

- Issue #312、Issue #193。
- Phase 0：TS6 与 TS7 exact diagnostics、exit、NodeNext、platform、determinism、cold/warm CPU/memory parity。
- Phase 1：只有 parity 成立并取得 package/lock single-writer 后，采用 TS7 CLI checker + TS6 Program API 双 Provider。

## 产品 Semantic Compiler 后继序列

repository meta-system 必须快速收口，随后按真实 consumer 纵切片推进：

1. #291 canonical ordinary-data；
2. #294 Registry/Manifest logical identity 与 binding；
3. #296 exact Physical Workspace Observation；
4. #306 Semantic Contract strict authority；
5. #293 Engineering IR raw→validated；
6. #224 TypeScript Source Program / Responsibility；
7. #299 Block Capability Resolution；
8. #317 bounded recursive Engineering Composition；
9. #300 Composition transaction；
10. #290 首个 IR-owned Backend；
11. Issue #307 最小 Implementation Resolution Kernel。

## 已路由但不自动抢占近期顺序的任务

- #176/#177/#179/#188/#190/#191/#194：Verification Result、failure、Journal、Impact、Hermetic、Queue 与 incremental；
- #192/#193/#216：Host/Toolchain/Dependency/Release；
- #316：Performance Truth / Resource Budget / Throughput；
- #318：Semantic Engineering Benchmark；
- #321：Development Operation Effect Purity；
- #325：Architecture Learning Projection；
- #207：只在真实并行 writer/resource 需求成立时恢复 integration semantics。

Issue 存在不是排队授权。只有成为当前真实阻塞、满足进入条件并与 formal writer 无冲突时，
才从 then-latest `main` 冻结新的 focused Work Package。

## 已完成 Work Package

- `branch-ref-lifecycle-enforcement-v1`（Issue #313）。
- `verification-control-plane-foundation-v1`（Issue #311）。
- `repository-information-lifecycle-v1`（Issue #282）。
- `trusted-verifier-causal-closure-v1`（Issue #178）。

## 可并行只读工作

- #327 current-main structural census；
- #192 Node/Bun × Windows/Linux capability Evidence；
- #193 dependency/provider consumer census；
- #194 compiler cold/warm benchmark 与 pass/artifact census；
- #312 TS7 Phase 0 isolated parity；
- #316 performance census 与 #318 benchmark design。

只读 Evidence 不自动取得 writer 或 merge authority。任一正式 candidate 进入 main 后，
其他候选必须从新主干重新计算 base、scope、trust relation 与 Verification。
