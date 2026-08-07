---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-07
---

# SEC 滚动近期计划

本窗口从 `main@38a5bf80c24ea8703e7ed9a7aff3b7a920d95aff` 重算。PR #308 已把
Implementation Resolution 的稳定架构与 owner 边界融合进 `main`，但没有实现 Resolver、Provider catalog、
TypedInvocation、Binding comparator、Compatibility evaluator 或 Workbench selector。Issue #307 保持开放。

PR #308 后 GitHub 远程 heads 已只剩 `main`，但没有可发现的逐 ref lifecycle receipts、#308 closeout receipt、
不同 principal 的独立 Review或完整 hosted Gate闭包；静态 pointer/rolling plan也仍停留在已合并candidate。
因此下一正式包不是继续扩写产品架构，而是闭合 #313 的 terminal enforcement。

近期执行遵循：

1. 先让所有 merge/close路径不能绕过 branch/ref terminal；
2. 再建立 #311 最小 Verification Session基础，消除 PR body、single-parent和多Check时序拼接；
3. #282 对 current tree及PR #284删除的47,287行做claim-level信息生命周期审计；
4. #314机器区分specified、implemented、verified、enforced、adopted和retired；
5. 随后推进TS7高收益工具链迁移并迅速回到产品Semantic Compiler纵切片。

## 当前唯一 Work Package

### branch-ref-lifecycle-enforcement-v1

- Issue #313；从 `main@bd54653` 收口（PR #315 实现 + PR #319 terminal 收口路径）。
- 原子退役 #308 manifest并结算pointer/rolling plan。
- 对post-enforcement merged、closed-superseded和completed-spike操作要求durable receipt。
- merge/bootstrap/manual closeout任一publication/readback失败不得输出clean completion。
- admin/web/connector旁路由repository health检测为degraded/locked。
- 保留dirty/worktree-bound本地分支为typed `protected-pending`；CAS drift fail closed。
- 合并后使用自身机制完成self-closeout。

## 候选 Work Package

### 1. verification-control-plane-foundation-v1

- Issue #311 Phase 0与最小foundation。
- 建立machine WorkPackage registry projection、稳定Manifest与FreezeSession分离、Candidate Tree和单一Session纵切片。
- base/candidate使用同一trusted plan；最终merge只证明merged tree等于verified candidate tree。
- 不一次实现完整Evidence DAG、Queue、Hermetic Runtime或Bootstrap平台。

### 2. repository-information-lifecycle-v1

- Issue #282。
- 对exact current tree和 `2d7187f4... → 6cbe65d8...` 全部removed/renamed blobs建立disposition。
- 不恢复47,287行旧archive；逐claim区分code/test-owned、migrated、historical-git-only、extract-required和unresolved。
- Nexus 29 EPR在ledger `bound: 0 / expected: 29` 的缺口必须逐项绑定或阻塞。
- 全量claim census已识别两个此前无owner的耐久缺口：#317受限递归Engineering Composition、#318 Semantic Engineering Benchmark；它们只作为后继owner，不把旧对话恢复成authority。
- 扩展现有repository audit，不建立第二审计系统。

### 3. architecture-decision-enforcement-registry-v1

- Issue #314。
- 首批登记branch lifecycle、Verification Control Plane、TypeScript 7、Implementation Resolution和canonical digest。
- 文档、Issue、类型或测试存在不能自动提升到implemented/enforced。
- known bypass、missing consumer、missing physical Evidence或未退役旧路径阻止成熟度升级。

### 4. typescript-7-dual-provider-phase-0-1

- Issue #312、#193。
- Phase 0先做TS6.0.3与TS7 exact diagnostics、platform、determinism、cold/warm性能只读parity。
- Phase 1只在 #311 最小可信基础和package/lock唯一writer成立后采用TS7 CLI + TS6 Program API双Provider。
- CLI checker、Program/TypeChecker、Language Service、printer与build executable保持分域。

### 5. product-semantic-compiler-foundation-sequence

按独立真实consumer纵切片推进，不合并成巨型基础设施包：

1. #291 canonical ordinary-data；
2. #294 Registry/Manifest逻辑identity与binding；
3. #296 exact Physical Workspace Observation；
4. #306 Semantic Contract strict authority；
5. #293 Engineering IR raw→validated边界；
6. #224 TypeScript Source Program / Responsibility；
7. #299 Block Capability Resolution；
8. #317 bounded recursive Engineering Composition / containment legality；
9. #300 Composition transaction；
10. #290 首个IR-owned Backend；
11. #307 最小Implementation Resolution Kernel。

#317必须复用现有Engineering IR/Capability/Contract owner，不建立第二graph或“万能Block树”；只在真实consumer上实现typed containment、identity/revision和negative legality。

## 已路由但不自动抢占近期顺序的任务

以下Issue仍由各自唯一owner保存，不复制为第二backlog；成为当前阻塞或满足进入条件时从最新 `main` 生成聚焦包：

- #176/#177/#178/#179/#188/#190/#191/#194：Verification、Epoch、TCB、Journal、Impact、Hermetic与增量；
- #237/#239/#244/#247/#248/#275/#279/#280：Evidence、外部输入、publisher、provenance、Skill和default-branch authority；
- #287/#288/#292/#295/#297/#298/#301/#302/#303/#304/#305：产品去特化、Operation、Opaque/Frontend/Policy、Migration、Release、Repair、Workspace、CLI和Slot安全；
- #167/#192/#193/#216：Host/Toolchain/Dependency/Release lane；
- #316：Performance Truth、Resource Budget和Throughput Architecture，只拥有测量/预算/回归，不与Compiler/Test/Verification owner争权；
- #318：Semantic Engineering Benchmark，拥有Intent→Spec→System→Acceptance任务/corpus/reference truth/anti-gaming；在Source Program、Contract、Workbench Operation和首个IR-owned Backend有真实consumer后启动，完整B5在#307最小纵切片后校准；
- #207：只有普通candidate Review/Gate/merge/readback连续稳定、mutating resources有唯一writer且产品纵切片已进入main后才恢复并行。

## 可并行只读工作

- #282 PR #284 deleted-blob claim census；
- #192 Node/Bun × Windows/Linux capability Evidence；
- #193 latest dependency/provider consumer census；
- #194 compiler cold/warm benchmark与pass/artifact census；
- #312 TS7 Phase 0隔离parity；
- #316 Phase 0性能Census和#318 benchmark case/reference-truth设计只能作为Evidence/设计输入，不取得当前writer。

只读结果进入对应Issue/Evidence owner，不自动取得合并资格。任一正式candidate进入main后，其他候选必须从新主干重算base、scope和Evidence。
