---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-08
---

# SEC 滚动近期计划

本窗口从合并后的 `main@37c8609d5d54b5fb74292cffc83bd7dfcc362988` 重新计算。

## 当前事实与反转原因

- Issue #178 causal TCB / trusted bootstrap 已完成并经 new-main readback，保持 CLOSED。
- Issue #311 过去只完成 registry projection、FreezeSession、Candidate Tree parity 的
  minimal foundation，却被整体关闭；Completion Definition 的 Unified VerificationSession、
  MainHealth、Action reuse 与 throughput 尚未完成，因此已重新 OPEN。
- Issue #279 Integration Transaction Kernel 的统一事务与 legacy
  `sec-merge-bootstrap` retirement 尚未完成，因此已重新 OPEN。
- PR #333 的 #327 candidate 从 focused repository-data ownership 扩大到 38 paths，
  混入 Compiler、Semantic Mutation、CI Evidence、TCB、Test Impact、dev-runner、
  baseline imports 与 fixtures，形成 scope avalanche；已关闭、未合并。
- PR #334 是明确 `MUST NOT MERGE` 的 validation transport/payload PR；正式 candidate
  已可在 GitHub 表达后即失去使命，已关闭、未合并。其远端 ref 仍需 branch lifecycle
  owner 在工具具备 delete-ref 时物理删除/readback。
- #327 执行记录证明当前真实 critical-path blocker 是 Verification/Development
  Throughput：约 23 fast + 5 risk 的初始 closure 扩张为 80+ fast + 11 risk，
  出现约 924 秒 Semantic Mutation test、多轮 proof reset 与环境型重复执行。

因此旧顺序 `#327 → #314 → #312/TS7 → product` 被新 Evidence 反转。
在不降低 Verification truth 的前提下，先消灭重复 Action、粗粒度失效、scope avalanche
与慢测试误选；达到首轮可消费收益后立即恢复产品 Semantic Compiler 并允许后继性能
切片按真实 authority/resource 冲突并行。

## 当前唯一 Work Package

### verification-action-trusted-cutover-v9

Owners：#311/#179/#178/#176/#217/#316。

V8 exact-head Review 与 old-main bootstrap 已证明最后两类同一 trust epoch 阻断：
integration rerun/timeout identity 仍有缺口；dev-runner authority proof 把全仓
`platform/scripts` executable census 误作 canonical authority closure，使 unrelated source/data
进入唯一 Program 并把完整 contract 放大到既有 180 秒预算之外。V9 对全部旧证明做一次 reset，
保留 V8 已完成的产品边界，只关闭这两个已有 exact witness 的根因。

- integration 每次 attempt 独立 live-authorize original actor 与 triggering actor，恢复 artifact
  保留 first-effect publication attempt，不被后续 rerun restamp；
- SUT job timeout 严格大于 3,600 秒 sandbox 上限并保留 terminalization reserve，MainHealth join
  严格覆盖 producer 上限与完整 poll interval；
- dev-runner proof 从 live scenario 已声明的 authority roots 构建 tracked、identity-bound transitive
  executable/data resource closure，不扫描或硬编码 unrelated repository paths；
- 完整 live closure 与 41 个 adversarial scenarios 继续共享 one Program/TypeChecker/resolver/index/
  topology/solve，phase counters 证明 canonical parity、exact-once work 与 non-amplification；
- 不增加 timeout、不删除 scenario、不增加 second analyzer/cache/solver，不修改产品 Compiler、
  package/toolchain 或 unrelated verifier surface；
- 最终仍由 old main 把单父 V9 candidate 当 SUT 独立验证，fresh Review、bootstrap、merge 与
  new-main readback 不得复用任何 V8 receipt。

## 候选 Work Package

### 1. semantic-impact-failure-routing-v1

Owners：#188/#177/#205/#176/#314。

- selection 收敛为
  `Source/Contract/Responsibility → Requirement → Test Capability → Concrete Test` witness；
- `required | not-applicable | unresolved` 明确且 unknown 只扩大/阻断；
- expensive test 必须有 causal witness 与 duration/resource projection；
- stable FailureRecord/fingerprint、owner/invariant、minimal repro、retry precondition、
  typed next action；
-同 input + 同 fingerprint 默认禁止 blind rerun / repeated full investigation；
- #205 preflight 阻止同类第二次 leaf patch 与无证明 scope expansion；
- #314 机器禁止 child delivery slice 自动关闭 parent Program。

### 2. feedback-scheduler-hermetic-runtime-v1

Owners：#189/#190/#316。

- revision-aware scheduler 只运行 invalidated Action，superseded work 可取消；
- CPU/I/O/process/browser/workspace/cache/exclusive writer 分资源预算；
- nested concurrency 统一预算，避免 oversubscription；
- Bun transpiler/cache、workspace、ports、process tree 与 browser 按 Action/environment
  隔离并 settlement/readback；
- fast/medium/slow/risk/release 由真实 duration + resource class 分层；
- independent expensive actions 并行，冲突资源有序；
- cache/environment failure typed 化，不再靠“再跑一次”恢复。

### 3. compiler-incremental-toolchain-v1

Owners：#194/#296/#312/#193/#316。

- same-process pure Compiler incremental node identity/invalidation 与 clean parity；
-共享 Physical Observation / TypeScript Program / reverse dependency producer，
  减少重复 read/parse/hash/graph build；
- unchanged Artifact bytes 不重写、不级联 mtime/Impact；
- TS7 CLI 只有 exact diagnostics/determinism/platform/cold-warm parity + critical-path
  Evidence 支持时采用；
- dependency/provider startup 与 install closure按真实 consumer 精简。

## 后续但暂不占 formal writer

- Issue #327 repository structural convergence：保留有效 core delta，吞吐 T1/T2 后从新 main
  重新建立 focused candidate；不得复用 #333 的 38-path scope。
- Issue #314 architecture maturity：其 Program/delivery-slice closure guard在候选2进入；
  其余 registry 工作随后按真实 consumer推进。
- Issue #279 hosted integration/runtime retirement：随候选1–3实际 consumer逐步接线，
  不再一次重建巨型 Integration Kernel。
- Issue #191 Integration Queue：仍只在两条真实并行产品线和 #207 conflict witness 成立时激活。
- Issue #206/#219：保持 superseded/not-planned CLOSED；其负例与验收迁入当前 canonical owners，
  不恢复第二 cache/Closure Compiler。
- Issue #209：保持完成，除非新的 physical line-ending recurrence 反证其完成门。
- TypeScript 7、dependency、产品 Semantic Compiler 的只读 benchmark/census 可并行，
  不自动取得 writer authority。

## 重新规划硬触发器

任一条件成立，立即从 then-latest `main` 重算，而不是继续旧队列：

1. 当前包发现需要写 forbidden/TCB surface；
2. candidate write set 比 frozen authorization 扩大；
3.同一 ActionKey 被第二次物理启动；
4.相同 failure fingerprint 在因果输入未变时被 blind rerun；
5.一个 unrelated baseline/verifier defect 试图进入当前 SUT scope；
6. expensive test 无 causal witness却进入开发关键路径；
7. cache/environment contamination 需要第二次相同重跑；
8.新 main / Review / CI / trust revision 使当前 frozen identity失效；
9.真实critical-path Evidence证明另一 owner 的收益显著更高；
10.产品线已可安全并行且继续全局 single writer 反而成为主要瓶颈。

## 加速验收

速度提升不得来自少测、弱化 fail-closed 或扩大 timeout 掩盖缺陷。#316 对每个真实
Work Package 记录：

- selected-work → new-main readback wall time；
- time-to-first-actionable-failure；
- unique ActionKey / physical executions / duplicate ratio；
- reused / invalidated / recomputed / cancelled；
- proof-reset count；
- scope-expansion count；
- expensive-test critical-path contribution；
- first-pass candidate yield / avoidable failure；
- cache/env contamination reruns；
- CPU/I/O/process/memory/resource wait。

稳定 distribution 存在前不手填虚假 SLO。首个目标是让 #327 类 focused refactor
不再因 unrelated baseline/verifier变化自动进入 10–15 分钟级语义集成测试，并且任何
省下的执行都必须有 exact reuse 或 not-applicable/Impact witness。
