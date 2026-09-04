---
title: Agent Delegation Modes
status: stable
domain: agent-constitution
---

# Agent Delegation Modes

本文拥有 Agent delegation 的封闭 mode algebra、各 mode 的 independence/authority/write requirements 与 join contract。主动对抗、恢复、Skill 边界仍由 `execution-and-recovery.md` 拥有。

## 1. Delegation 不是一个 `independentOwnerBoundary` iff

只读研究、独立 Review、实现写入和外部 observation 的冲突条件不同。把它们压成一个 predicate会错误拒绝安全并行，或为了兼容只读场景把 writer independence定义得过宽。

```text
DelegationMode =
  | ReadOnlyAnalysis
  | Implementation
  | IndependentReview
  | ExternalObservation
```

## 2. 共同不变量

每种 delegation 都必须满足：

```text
childAuthority ⊆ parentDelegableAuthority
explicit input/output contract
bounded resources/deadline
stable subject/epoch refs
parent integration owner exists
expected benefit > coordination/stale cost
```

child报告永远不是 parent completion/authority。

## 3. ReadOnlyAnalysis

用于独立读取、搜索、证明候选、性能/架构分析：

```text
ReadOnlyAnalysisAdmitted =
  zero authorized mutation/effect on target state
  and read scopes can overlap safely
  and outputs are evidence/proposal/frontier only
```

不要求不同 semantic owner；多个审计者可以读取同一 owner，但不能各自写 canonical finding truth。Parent按 provenance保留不同 observations并统一 reconcile。

## 4. Implementation

```text
ImplementationDelegationAdmitted =
  independently owned change boundary
  and write/effect sets are disjoint or explicitly serialized
  and no shared indivisible state/authority/resource writer
  and task dependencies form a deterministic integration DAG
```

同一 file path不同不充分；同一 semantic owner/state/preimage即使路径不同也可能冲突。

## 5. IndependentReview

Review必须与被审 candidate producer保持所需独立性：

```text
IndependentReviewAdmitted =
  reviewer has read-only subject capability
  and cannot mutate candidate/oracle/merge authority
  and review Claim/coverage contract exact
  and producer cannot issue reviewer receipt
```

多个 reviewer是否需要并行由 Claim coverage与成本决定，不因为“独立”就机械占满并发槽。

## 6. ExternalObservation

Provider/API/filesystem/live environment observation可以并发，只要：

- provider contract允许并发；
- aggregate resource/credential/request budget共享 parent ledger；
- observations有独立 exact subject/method identity；
- current world mutation风险不被误当只读。

对同一 non-reentrant session 必须 serial/join。

## 7. Join 与 stale

```text
DelegatedResult = {
  mode,
  exact inputs/epoch,
  output refs,
  evidence/frontier,
  observed effects = none or declared implementation effects,
  resource settlement,
  stale predicates
}
```

Parent只重新读取/计算共享且可能变化的边界；无关 sibling结果不因另一个 child完成而 stale。

## 8. 新 mode 的局部演进

未来出现真正不同的 delegation kind 时，只有它具有新的 authority/write/independence/settlement语义才扩 mode algebra。新工具、模型、Provider或Agent角色只绑定已有 mode，不能给通用 Delegate 加品牌分支。

## 9. 完成

```text
DelegationClosed =
  every child has one explicit mode
  and common authority/resource/contract invariants hold
  and mode-specific write/independence rules hold
  and read-only parallelism is not blocked by writer-only conditions
  and implementation/review cannot exploit read-only relaxations
```

<!-- sec-clause {"id":"agent-delegation-modes","blocker":null,"kind":"stable-decision"} -->
## 规范片段

Agent delegation分型为ReadOnlyAnalysis、Implementation、IndependentReview与ExternalObservation；共同保证权限不扩大、输入输出有界、parent负责集成，具体owner/write/independence约束按mode判定。新增模型/Provider只绑定已有mode，不能修改中央Delegate predicate。
