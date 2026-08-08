---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-08
---

# SEC 滚动近期计划

本窗口从 `main@26dcb43c77c9bdfebee35efc217113c958ed017d` 重新计算。Issue #313
branch/ref lifecycle 与 Issue #311 Verification Session foundation 已闭合；Issue #282
repository information lifecycle 的 #326 历史合并保持
`authorityAtMerge: unauthorized`，但 trusted-base、candidate-as-SUT 与
present-main readback 已物理通过，repairStatus 为 repaired，Issue #282 已关闭。

新的物理证据表明：当前 `scripts/codex/merge-gate.ts` 仍把整个
`scripts/codex/` 目录近似为 verifier trust root；与此同时 #282 replay 已证明
`scripts/codex/repository-audit.ts` 不在 `TCB_RUNTIME_ENTRYPOINTS`、不在冻结
61-module historical runtime closure，运行时 closure 也不包含它。目录位置因此正在放大
普通 repository tooling 变更的 bootstrap 成本。

近期执行遵循：

1. 先由 Issue #178 收敛 causal TCB：static privileged surfaces 与 actual runtime
   closure 分离，同时保证 trust classifier/lock/merge authority 本身不能自我降级；
2. 随即进入 Issue #327 repository structural convergence，直接拆解
   repository-audit 的 domain-data ownership、`scripts/codex` provider leakage、
   重复 process/Git/parser 机制与 dead compatibility；
3. 再由 Issue #314 机器投影 architecture decision maturity；
4. 随后推进 Issue #312 / #193 TypeScript 7 provider migration；
5. 快速回到产品 Semantic Compiler 纵切片，不让 repository meta-system 长期吞噬产品吞吐。

## 当前唯一 Work Package

### trusted-verifier-causal-closure-v1

- Issue #178：把 verifier trust-root 从目录近似收敛为
  static privileged surfaces + exact causal runtime TCB closure。
- `scripts/codex/repository-audit.ts` 不再因目录位置自动成为 bootstrap 对象；
  真实 merge-gate、selection/result/Evidence、TCB contract/lock、privileged
  workflow/config 变化仍须 bootstrap。
- 当前包自身修改 trust registry/classifier/workflows，因此必须由旧 trusted revision识别为 trust transition；物理 regression 统一由 GitHub Actions 执行，禁止使用新 classifier 自证。

## 候选 Work Package

### 1. repository-structural-convergence-v1

- Issue #327。
- 首包优先把 146-row deleted-blob data、Nexus 29 EPR records 与 generic
  repository-audit algorithm 的物理 ownership 分开，再继续 provider-neutral
  dev-control-plane 与重复机械 primitive 收敛。
- 不重做 Issue #282 已完成的 47,287-line 历史语义审计，不恢复 archive。
- LOC/churn 只作热点信号；以 semantic/ownership/trust/duplicate/compatibility
  surface 与 change amplification 为真实目标。

### 2. architecture-decision-enforcement-registry-v1

- Issue #314。
- 首批登记 branch lifecycle、Verification Control Plane、TypeScript 7、
  Implementation Resolution、information lifecycle 与 canonical digest。
- 文档、Issue、类型、测试或 PR 存在不能自动提升到 implemented/enforced；
  known bypass、missing consumer、missing physical Evidence 或未退役旧路径阻止升级。

### 3. typescript-7-dual-provider-phase-0-1

- Issue #312、Issue #193。
- Phase 0 做 TS6.0.3 与 TS7 exact diagnostics/platform/determinism/cold-warm
  物理 parity；Phase 1 只有 Evidence 支持时采用 TS7 CLI + TS6 Program API
  双 Provider。
- CLI checker、Program/TypeChecker、Language Service、printer 与 build executable
  保持分域，Provider 不取得 SEC 语义 authority。

### 4. product-semantic-compiler-foundation-sequence

按独立真实 consumer 纵切片推进，不合并成巨型基础设施包：

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

#317 必须复用现有 Engineering IR / Capability / Contract owner，不建立第二 graph
或万能 Block 树。

## 已路由但不自动抢占近期顺序的任务

- Issue #176/#177/#179/#188/#190/#191/#194：Verification Result、failure、
  Journal、Impact、Hermetic、Queue 与 incremental；
- Issue #235：两个 active proposal 的 focused retirement；
- Issue #192/#193/#216：Host/Toolchain/Dependency/Release lane；
- Issue #316：Performance Truth / Resource Budget / Throughput；
- Issue #318：Semantic Engineering Benchmark；
- Issue #321：Development Operation Effect Purity；
- Issue #325：Architecture Learning Projection；
- Issue #207：仅当普通 candidate / mutating resource / product vertical 的真实
  并行需求成立时恢复 integration semantics。

这些 owner 只在成为真实阻塞或满足进入条件时从 then-latest `main` 生成聚焦包，
不能把 Issue 存在当成排队强制。

## 已完成 Work Package

- `branch-ref-lifecycle-enforcement-v1`（Issue #313）：terminal branch/ref closeout
  与 receipt/readback 已闭合。
- `verification-control-plane-foundation-v1`（Issue #311）：registry projection、
  FreezeSession、Candidate Tree parity 已闭合。
- `repository-information-lifecycle-v1`（Issue #282）：PR #284 removed/renamed
  information lifecycle machine closure进入 main；PR #326 历史 transition 经
  post-merge trusted-base/candidate-as-SUT repair 后终结，历史未被改写为 authorized。

## 可并行只读工作

- Issue #327 current-main structural census；
- Issue #192 Node/Bun × Windows/Linux capability Evidence；
- Issue #193 dependency/provider consumer census；
- Issue #194 compiler cold/warm benchmark 与 pass/artifact census；
- Issue #312 TS7 Phase 0 isolated parity；
- Issue #316 performance census 与 Issue #318 benchmark design 只作为 Evidence 输入。

只读 Evidence 不自动取得 writer 或 merge authority。任一正式 candidate 进入 main
后，其他候选必须从新主干重新计算 base、scope、trust relation 与 Verification。
