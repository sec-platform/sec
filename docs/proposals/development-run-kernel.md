---
title: Development Run Kernel 适配与退役提案
status: draft
domain: proposal
last-reviewed: 2026-08-11
---

# Development Run Kernel 适配与退役提案

本提案只记录历史 umbrella Run Kernel 如何被 canonical owners 吸收并最终退役，不拥有当前
架构、运行状态或实现顺序。正式边界分别位于 `docs/system-architecture.md`、
`docs/development-governance.md`、`docs/verification-governance.md` 与 `docs/roadmap.md`。

## 适配裁决

原目标“在上下文压缩、进程退出、会话/worktree/Agent切换后从外部事实重算同一合法 next
transition”保留；新的顶层 durable Run Kernel state machine 被拒绝。它会重复 Work、Task
Capsule、VerificationSession、Action/Evidence、Review、Provider 与 Integration owner，并形成
第二 current-state。

最终结构是：

```text
typed domain decisions
→ VerificationSession references
→ pure NextTransition composition
→ domain-owned physical Action
→ immutable receipt / readback
```

`VerificationSession` 是唯一 development run coordinator；`NextTransitionCompiler` 是 pure
composition resolver。禁止实现为新的 general Run Kernel、第二 Session、第二Evidence truth或
第二Integration owner。

## 吸收映射

| 原提案能力 | Canonical owner | 适配结果 |
| --- | --- | --- |
| selected work与优先级 | Work selector / WorkDecision | Kernel只消费typed decision |
| Task Capsule | TaskCapsuleCompiler | 独立pure output；Session只保存ref/digest/revision |
| role/path/capability | Operation Envelope / permission evaluator | 不复制权限算法 |
| run/session identity、event、transition、resume | VerificationSession | 唯一run coordinator |
| Impact与Verification obligations | Delta/Impact、Task Capsule、Verification selector | 不在Session重算 |
| Action start/terminal/reuse | Verification Action owner | 同ActionKey只允许一个physical start |
| Evidence与freshness | Evidence DAG / reuse evaluator | immutable proof + pure freshness |
| independent Review | Review external Action + ReviewReceipt | 不建立顶层Review lifecycle machine |
| provider availability | External Provider resolver/ledger | availability不改Review强度 |
| merge/readback/closeout | Promotion / Integration transaction | single-use hosted effect owner |
| unique next transition | NextTransitionCompiler | 只组合typed owner decisions |

## Identity 裁决

候选身份必须分层：

```text
ScopeGrantId
→ CandidateContentId
→ CandidateGenerationRef
→ ActionKey / Evidence
→ ReviewSubjectId
→ PromotionId
```

- content identity不含branch、PR、worktree、commit timestamp或其他transport噪声；
- generation ref绑定run、单调generation、content与exact head；
- ActionKey只绑定实际subject closure；
- Review与Promotion必须重新绑定每个exact head/tree和live facts；
- 一个run只有一个mutable implementation worktree和一个active candidate ref，finding不创建
  successor worktree。

## NextTransition 边界

NextTransitionCompiler 输入只能是owner已经形成的：

```text
WorkDecision
FailureDecision
ImpactDecision
ActionState
SessionState
ReviewFreshness
ProviderAvailability
IntegrationState
```

输出只能是：

```text
execute | join | wait | blocked | complete
```

它不能选择Issue、编译Task Capsule、分类failure、扩缩Impact、决定Review freshness或重算merge
legality。缺输入、冲突或unknown时fail closed，不能通过优先级表偷偷重建总控语义。

## Candidate / Control 适配

Candidate materialization使用isolated Git index、`write-tree`、one-parent `commit-tree`、expected-old
ref CAS与readback。Worktree只作可丢弃projection；同一worktree修finding并产生cheap generation，
不重建v2/v3/v4 worktree。

Candidate pointer/rolling/manifest是`ProspectiveControlProjection`；只有live default/main中的
byte-exact facts是`ActiveMainControlState`。candidate projection failure不能把live main标成
transition-in-progress。

## Verification / Review / Trust 适配

相对于当前dependency/Impact model：

```text
Execute = RequiredClosure ∩ MissingOrStale
```

fresh pass/failure复用，authenticated in-flight join，start-without-terminal block，unresolved扩大或
block；`physicalStartsPerActionKey <= 1`。Review可以消费previous receipt、unchanged-byte proof和
fix delta减少阅读，但必须为新ReviewSubject签发fresh full-candidate exact-head receipt。

Trust root分Tier 0 transition primitives、Tier 1 evolvable verification TCB与Tier 2 product；Tier 1
由旧trusted closure和Tier 0 transition receipt升级，只有Tier 0自身变化需要manual break-glass。

## 迁移与退役

本提案不要求一个前置umbrella architecture Work Package。canonical contract随各唯一owner的纵向
cutover切片进入main：Candidate/Control transaction、Read/Guidance fast path、Verification closure、
ExecutionWave、Review/Trust transition、Promotion cutover。每片先shadow/read-only compare，再迁移
consumer、切换唯一writer/resolver并删除legacy；不得长期dual write。

提案只有在以下Evidence全部存在后才能移动到registry声明的archive target：

- canonical owners已包含本页全部保留裁决；
- VerificationSession由ordinary candidate new-main canary激活；
- historical run replay证明resume、Action reuse和unique next transition；
- finding generation在同一worktree/ref完成且successor worktree为零；
- Review、Promotion、trust transition与projection failure paths有真实physical Evidence；
- legacy Run Kernel/current-phase projection与重复Skill guidance的consumer为零并已删除。

在此之前，本文件保持proposal-only；它不能被Skill、Issue、PR或Agent当作active authority。
