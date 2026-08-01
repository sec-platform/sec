---
title: Context Compiler、Run Kernel 与增量反馈
status: draft
domain: proposal
last-reviewed: 2026-08-01
---

# Context Compiler、Run Kernel 与增量反馈

## 1. 目标

把当前“新会话先重新理解工程”的流程改为：

```text
exact external state
→ Task Capsule
→ Operation Envelope
→ Context Capsule
→ one primary Skill / Role
→ work
→ Reconciliation Delta
→ immutable Run event
```

Agent只处理真正需要语义判断的内容；仓库、权限、scope、impact、tests、failure、Evidence和next transition尽量由结构化对象给出。

## 2. Task Capsule

Task Capsule由#205拥有。本提案只规定它在端到端吞吐链中的位置。

### 2.1 必要输入

- exact main/default identity；
- selected Issue和用户目标；
- frozen Work Package；
- authority owner/revision；
- root cause、reproduction和failure fingerprint；
- sibling/consumer census；
- Impact/Closure plan；
- owned/permitted/forbidden paths；
- exclusive/shared resources；
- required Verification和physical gates；
- parallel classification；
- reusable/invalidated Evidence；
- blocker和next action。

关键输入unresolved时Capsule输出unresolved，不允许模型自动补全。

### 2.2 稳定性

同一exact输入必须产生byte-stable Capsule。禁止进入identity的字段：

-生成时间；
-聊天message ID；
-Agent名称；
-临时文件绝对路径；
-wall-clock duration；
-PR描述性正文。

### 2.3 Reconciliation Delta

当main、authority、Review、Evidence、failure或用户scope变化时，不重新发送完整工程上下文，生成：

```ts
interface ReconciliationDeltaV1 {
  previousCapsuleDigest: Digest;
  newInputDigest: Digest;
  changedFacts: FactDelta[];
  invalidatedAssumptions: AssumptionRef[];
  invalidatedEvidence: EvidenceRef[];
  retainedEvidence: EvidenceRef[];
  requiredReloads: ContextRef[];
  nextTransition: TransitionRef | null;
  blocker?: Blocker;
}
```

## 3. Operation Envelope

Task Capsule描述任务闭包；Operation Envelope描述本次执行授权。

```ts
interface OperationEnvelopeV1 {
  schema: 'sec-operation-envelope-v1';
  operationId: string;
  taskCapsuleDigest: Digest;
  role: AgentRole;
  primarySkill: SkillId;
  phase: OperationPhase;
  readSet: ResourceRef[];
  writeSet: ResourceRef[];
  forbiddenSet: ResourceRef[];
  tools: ToolGrant[];
  sideEffects: SideEffectClass[];
  preconditions: PredicateRef[];
  expectedOutputs: ArtifactContractRef[];
  stopConditions: PredicateRef[];
  transitionOnSuccess: TransitionRef;
  transitionOnFailure: TransitionRef;
}
```

最终权限：

```text
Role maximum
∩ Operation Envelope
∩ repository policy
∩ provider capability
∩ current legal transition
```

Skill和Agent均不能自授权。

## 4. Context Capsule

### 4.1 不是摘要

Context Capsule是结构化引用，不是复制全部正文：

```yaml
schema: sec-context-capsule-v1
identity:
  taskCapsuleDigest:
  operationEnvelopeDigest:
  repositoryTree:
references:
  - ref: platform/shared/example.ts
    reason: write-target
    mode: read-write
    symbols: [example]
    digest:
    load: eager
  - ref: docs/verification-governance.md
    reason: authority
    mode: read-only
    sections: [Result truth]
    digest:
    load: eager
  - ref: tests/unit/example.test.ts
    reason: focused-sentinel
    mode: read-only
    digest:
    load: eager
  - ref: docs/archive/...
    reason: historical-counterexample
    mode: read-only
    digest:
    load: on-demand
facts: []
unknowns: []
```

### 4.2 Progressive disclosure

| 层级 | 默认内容 |
|---|---|
| L0 | objective、operation、permissions、next transition |
| L1 | exact authority sections和public contracts |
| L2 | write targets、direct consumers、focused tests |
| L3 | failure neighborhood、sibling class和historical replay |
| L4 | full repository audit，只在架构/unknown触发 |

普通叶节点任务不得默认进入L4。

### 4.3 加载规则

每个引用必须有：

- why needed；
-mode；
-digest/revision；
-symbol/section selector；
-load policy；
-reload condition；
-consumer operation。

Agent读取新文件时应记录reason；未登记的探索可以作为diagnostic observation，但不得自动扩大write set。

### 4.4 上下文预算

预算按信息价值，而不是固定文件数：

```text
priority =
  authority criticality
+ write proximity
+ consumer relevance
+ failure explanatory power
+ transition necessity
- duplication
- staleness risk
- historical distance
```

Context Compiler输出被排除内容和原因，避免“没加载所以假定不存在”。

## 5. Development Run Kernel

Run Kernel proposal已经规定stable runId、event/capsule chain、resume、cancel和supersede。本提案补充其与Task/Context/Candidate Closure的组合。

### 5.1 Run identity

```ts
interface DevelopmentRunIdentityV1 {
  runId: string;
  repositoryId: string;
  workPackageId: string;
  taskCapsuleDigest: Digest;
}
```

`sessionId`、`worktreeId`和Agent role是binding，不是runId。

### 5.2 Run event

```ts
interface DevelopmentRunEventV1 {
  schema: 'sec-development-run-event-v1';
  runId: string;
  sequence: number;
  previousEventDigest: Digest | null;
  transition: TransitionRef;
  inputDigest: Digest;
  outputRefs: ArtifactRef[];
  failureRef?: FailureRef;
  repositoryFingerprint: Digest;
  authorityDigest: Digest;
  instructionDigest: Digest;
  skillDigest: Digest;
  eventDigest: Digest;
}
```

事件append-only。隐藏思维、自由文本推理和临时进程对象不进入event chain。

### 5.3 Locks

Run phase和locks正交：

- recoveryRequired；
- pendingPrompt；
- instructionFenceChanged；
- candidateInvalidated；
- proofResetRequired；
- resourceCleanupRequired；
- integrationEpochInvalidated。

不能通过增加phase枚举把所有正交状态压成一个不可维护大状态机。

### 5.4 Resume算法

```text
resolve repository/common-dir/workspace
→ read last valid event generation
→ verify chain integrity
→ recompute repo/head/tree/index/worktree
→ verify manifest/authority/instructions/skills/tools
→ load Failure/Evidence/Integration refs
→ invalidate stale refs
→ compute one legal next transition
```

若没有合法transition，输出typed blocker；不得通过聊天猜测继续。

### 5.5 Prompt intake

用户新指令先进入prompt intake：

```text
raw prompt bytes/digest
→ classify goal/scope/priority delta
→ compare current Task Capsule
→ continue | reconcile | invalidate | supersede | new-selection
```

普通“继续”不改变scope；它请求执行当前唯一next transition。

## 6. Repository Semantic Index

### 6.1 责任

用于：

- Context selection；
- Impact路径；
- consumer census；
- Review omission search；
- parallel authority/resource conflict evidence；
- incremental diagnostics。

它不是Engineering IR或产品authority。

### 6.2 基础节点

```text
Git blob
file
module
export/import
public type/schema
function/class
runtime entry
state owner
artifact producer/consumer
authority owner
test owner
workflow/command
provider/capability
resource owner
```

### 6.3 边

```text
imports
calls
constructs
implements
serializes/deserializes
produces/consumes
reads/writes-state
lowers/projects
validates
owns-authority
selected-by-test
requires-provider
uses-resource
migrates/retires
```

### 6.4 Identity

稳定层按Git blob digest缓存parser输出：

```text
blob digest + parser revision + language profile
```

组合层按tree和registry revision生成：

```text
repository tree
+ owner registry digest
+ authority registry digest
+ index schema revision
```

dirty workspace作为candidate delta，不覆盖base snapshot。

### 6.5 Delta

```text
Base Semantic Snapshot
+ changed blob analyses
+ rename/copy/delete records
+ registry deltas
= Candidate Semantic Snapshot
```

必须支持删除、rename、case-only change、生成文件、unknown parser和partial index fail-closed。

### 6.6 完整性

- index missing不能推导not-affected；
-parser失败形成unknown frontier；
- clean rebuild与incremental snapshot结果一致；
-同一tree产生byte-stable semantic snapshot；
-索引可删除并从Git tree重建；
-外部图工具输出只能作为线索或Provider Evidence。

## 7. TypeScript增量层

TypeScript官方支持：

- incremental program；
- `.tsbuildinfo`；
- project references；
- `tsc --build` up-to-date detection；
- watch mode与builder APIs。

SEC采用顺序：

1. 先复用当前单项目incremental build info并验证clean parity；
2. 使用Compiler API建立warm diagnostics，不立即重构目录；
3. 只有profile证明类型检查的逻辑边界和耗时值得时，才引入Project References；
4. Project References必须服务真实模块ownership，不能为追求缓存命中制造任意分片；
5. `.tsbuildinfo`是derived state，可删除，不作为Evidence authority；
6. Node/Bun、TS version、compiler options、declaration outputs全部进入identity。

## 8. Automatic Feedback

### 8.1 Phase A：plan-only

```text
watcher hint
→ read actual bytes/digests
→ update semantic/index/program
→ compute impact and closure plan
→ publish diagnostics and required checks
```

不自动运行产品测试、browser、native或hosted Gate。

### 8.2 Phase B：thin edit feedback

编辑后只允许低成本、无重副作用节点：

- parse/syntax；
- local type diagnostics；
- import/export drift；
- forbidden path；
- authority/write owner conflict；
- public contract surface change；
- affected plan；
- micro-sentinel。

不得每次保存运行Full、browser、durable filesystem或真实worktree acceptance。

### 8.3 Phase C：candidate closure execution

候选稳定后自动运行：

- affected typecheck/contract/test closure；
- docs/import checks；
- resource-bound focused nodes；
- pre-freeze completeness；
-生成frozen verification request。

### 8.4 Supersede

新revision到来：

-取消旧revision尚未开始的节点；
-请求在安全边界取消运行节点；
-清理旧资源；
-保留input closure未变的独立结果；
-旧aggregate标记superseded；
-UI只突出最新revision。

## 9. Feedback对象

```ts
interface DevelopmentFeedbackV1 {
  revision: string;
  state: 'planning' | 'running' | 'passed' | 'failed' | 'blocked' | 'superseded';
  owner: string;
  impactPaths: ImpactPath[];
  selectedActions: ActionRef[];
  reusedActions: ActionRef[];
  runningActions: ActionRef[];
  invalidatedActions: ActionRef[];
  failure?: FailureRef;
  uniqueNextAction?: TransitionRef;
  unresolvedFrontier: UnknownRef[];
}
```

禁止只输出混合stdout迫使Agent重新解释。

## 10. 失败与学习

当候选或编辑反馈失败：

1.生成failure fingerprint；
2.定位owner/invariant；
3.查询同类历史；
4.判断`implementation-defect | known-cell-missed | closure-model-wrong | physical-unknown | infra`；
5.失效最小Evidence节点；
6.返回唯一next action；
7.`known-cell-missed`反哺Change Closure corpus；
8.相同root-cause第二次出现升级shared contract redesign。

## 11. 最小实施切片

### Context A — Reference schema

- Task/Operation/Context Capsule contracts；
-reference reason/mode/digest/load policy；
-byte-stable fixture；
-不接模型、不写产品。

### Context B — Read-only compiler

-从当前Issue/manifest/authority/changed records生成Capsule；
-与人工准备的历史任务比较；
-统计loaded bytes和遗漏。

### Run A — Kernel Shadow

-记录event/capsule但不控制执行；
-比较人工next transition；
-compact/restart回放。

### Index A — Blob analysis cache

-TS files/imports/exports/symbols；
-exact Git blob identity；
-clean/incremental parity。

### Feedback A — Warm plan-only

-实际bytes确认；
-TypeScript incremental diagnostics；
-Impact/Closure plan；
-无产品副作用。

后续自动执行必须等待Verification、Failure和Hermetic Resource owner可消费。

## 12. 必须评测

1. 同一task input产生相同Capsule bytes；
2. authority变化只重载对应context references；
3.普通叶节点不加载全仓audit；
4. missing index形成unknown而非not-affected；
5. dirty delta不污染base semantic snapshot；
6. compact后得到相同next transition；
7.新用户scope导致Reconciliation Delta而不是静默扩大；
8. session/worktree变化不改变runId；
9. instruction digest变化阻断继续；
10. watcher duplicate/rename事件以实际bytes收敛；
11.快速连续编辑只保留最新aggregate；
12.旧revision资源完成cleanup；
13. TypeScript clean/incremental diagnostics一致；
14. `.tsbuildinfo`损坏可删除重建；
15. Project References仅在真实模块边界下采用。

## 13. 指标

- orientation duration；
- context bytes loaded；
- files/symbols read before first edit；
- on-demand load count；
- full-audit escalation rate；
- resume recomputation duration；
- repeated reads after resume；
- edit-to-diagnostics P50/P95；
- revision supersede count；
- stale work executed seconds；
- index hit/miss/rebuild；
- clean/incremental parity failures；
- Task Capsule unresolved rate；
- first edit without scope violation rate。

目标值只能在telemetry建立后冻结；不得为降低context bytes省略必要authority或unknown。