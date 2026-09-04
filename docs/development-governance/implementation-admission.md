---
title: Implementation Work Admission
status: stable
domain: development-governance
---

# Implementation Work Admission

本文拥有“何时允许从设计/观察进入实现写入”的项目行为 gate。Design Calculus只证明 design artifact 在其声明 universe 内闭合；Implementation Architecture只提供 target realization/placement/conformance obligations；Effect/Resource/Scope 各由自己的 owner签发。本文只组合这些 refs，不重算它们。

## 1. 为什么 gate 不属于单独的 Design Calculus

`TargetDesignClosed` 可以在完全没有 current repository writer、ScopeGrant、resource capability 或 writable implementation carrier时成立。因此：

```text
DesignClosed ≠ ImplementationWorkAdmitted
```

Roadmap/Agent/Work Package 必须引用本文的唯一 gate，不得各自复制一组 conjunction。

## 2. DesignImplementationAdmissible

Design owner只提供：

```text
DesignImplementationAdmissible(targetSlice) =
  exact target design generation
  and applicable design obligations classified
  and adversarial closure within declared coverage
  and unresolved frontier does not cross the target slice implementation boundary
  and target/profile/owner decision refs frozen
```

它不看 live Grant、branch、worktree、Provider instance、current scope或current resource。

## 3. ImplementationWorkAdmitted

```text
ImplementationWorkAdmitted(targetSlice, currentEpoch) =
  DesignImplementationAdmissible(targetSlice)
  ∧ target ImplementationPackage/Placement refs closed
  ∧ current Source/ObservedImplementation preconditions fresh enough for the intended change
  ∧ exact owner/change-locality/write-set mapping closed
  ∧ ScopeGrant permits the intended mutation/effects
  ∧ required capability bindings are eligible or explicitly deferred before Effect
  ∧ required ResourceDimensions can be allocated under the parent ledger
  ∧ migration/compatibility/retirement obligations are represented
  ∧ Verification Claim/Impact roots are known or bounded frontier blocks only the unresolved slice
  ∧ current integrity/MainHealth route admits ordinary implementation
```

结果：

```text
ImplementationAdmissionResult =
  | admitted { targetSliceRef, epoch, obligationRefs, admissionDigest }
  | design-unbound { frontierRefs }
  | current-unresolved { frontierRefs }
  | scope-blocked { refs }
  | capability-blocked { refs }
  | resource-blocked { refs }
  | integrity-blocked { refs }
```

## 4. Gate 不包含实现细节

本文不保存：paths、commands、test list、current SHA、Provider version、worktree name。它只引用 owner-issued refs。具体值变化只使对应 admission receipt stale。

## 5. 局部失效

```text
AdmissionDependencies(targetSlice) = exact refs actually intersecting targetSlice
```

例如新 Provider 与当前 slice无关，不使 admission stale；另一个 Domain 的 unknown 不跨当前 change/Effect/Claim closure时不阻断当前 slice。

如果新事实 x 使旧设计假设错误：

```text
x → invalidate design reverse closure → gate becomes design-unbound
```

如果 x 只改变 credential/allocation/preimage：

```text
x → invalidate current admission only
```

不重新冻结无关设计。

## 6. Roadmap / Work Package / Agent 使用方式

- Roadmap node entry只引用 `ImplementationWorkAdmitted` obligation，不复制公式；
- WorkSelection可以在未 admitted 时选择纯设计/观察工作，但不能授权 implementation writer；
- Work Package freeze必须绑定 exact admission refs；
- Agent行为层消费 typed result，不能从“文档写完”“issue active”“tests green”推导 admission。

## 7. 实验

bounded experiment 可以在 `ImplementationWorkAdmitted` 之前存在，但必须满足：

```text
zero canonical product write
+ explicit experimental scope
+ no production authority
+ disposable outputs
+ no claim that target implementation is admitted
```

实验产生的反例/Evidence回到 Design/Observation owner。

## 8. 完成

```text
ImplementationAdmissionClosed =
  one canonical gate composes design/current/scope/capability/resource/evolution/verification/integrity refs
  and no downstream consumer copies the formula
  and design closure is separate from live execution conditions
  and new facts invalidate only the reverse-reachable gate inputs
```

<!-- sec-clause {"id":"implementation-work-admission","blocker":null,"kind":"stable-decision"} -->
## 规范片段

`ImplementationWorkAdmitted`由Development Governance唯一拥有：它组合DesignImplementationAdmissible、target implementation、fresh current observation、owner/change locality、Scope、Capability、Resource、Evolution、Verification与MainHealth refs。Roadmap/WorkPackage/Agent只引用结果；live条件变化只重做admission，设计反例才回退design closure。
