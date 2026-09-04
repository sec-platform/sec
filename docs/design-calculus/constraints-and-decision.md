---
title: Constraint、Claim Lowering 与多目标裁决
status: stable
domain: design-calculus
---

# Constraint、Claim Lowering 与多目标裁决

本文拥有 Constraint 的可判定边界、richer Claim 到 proof obligation 的 lowering，以及 lifecycle cost vector / Pareto / explicit scalarization 语义。基础 relation algebra仍由 `docs/design-calculus.md` 拥有，candidate synthesis与model exploration由 `compilation.md` 拥有。

## 1. Canonical kernel 不是逻辑“不可约证明”

Design Calculus 当前选择的 root grammar 是一个**canonical minimal engineering kernel**。除非存在形式独立性证明，不把“当前没有更优无损合并”表述成数学意义的不可约性。

```text
CanonicalKernelPrimitive =
  | Subject
  | Statement
  | Relation
  | Constraint
  | Transition
```

它的准入标准是：每种 primitive拥有独立 identity/admission/invalidation/consumer semantics；删除或合并会使当前工程模型丢失可观察区别。未来如果发现等价的更小 algebra，可以通过 meta-model evolution替换。

## 2. Constraint 的精确边界

```text
Constraint := decidable predicate over one explicitly bounded typed input universe
```

“decidable”只对其声明的 finite/bounded representation与 algorithm成立，不宣称任意现实性质都可判定。

```text
ConstraintEvaluation =
  | satisfied
  | violated { witness }
  | unresolved { missingInput/capability/budget frontier }
```

超预算、未观察外部世界、不可判定或尚无 decision procedure 不能伪装成 false/true。

## 3. ClaimSemantics 不等于 Constraint

```text
ClaimSemantics =
  | ExactPredicate
  | BoundedPredicate
  | TemporalProperty
  | QuantitativeMetric
  | StatisticalClaim
  | RobustnessClaim
  | RelationalHyperproperty
```

每个 Claim 必须先 lowering：

```text
ClaimProofObligation =
  | DecidableConstraintObligation
  | DeductiveProofObligation
  | BoundedModelCheckObligation
  | StatisticalEvidenceObligation
  | QuantitativeMeasurementObligation
  | RelationalTraceObligation
  | RobustnessEnvelopeObligation
  | BoundedUnknownFrontier
```

只有第一个可以直接交给 Constraint evaluator。其他 obligation由 Verification/Proof owner产生 Evidence/Verdict；不能因为工程需要自动化就谎称它们都可判定。

## 4. Cost 必须是有量纲向量

不同成本不能无定义直接相加：

```text
LifecycleCostVector = {
  machine: {
    wallTime,
    cpuTime,
    peakMemory,
    ioBytes,
    networkBytesOrRequests,
    storageBytes,
    processOrRemoteStarts
  },
  change: {
    authoredChangePoints,
    reverseImpactSize,
    crossBoundaryEdges,
    migrationSteps,
    retirementSteps
  },
  operations: {
    failureSurfaces,
    recoverySteps,
    trustBoundaries,
    externalDependencies
  },
  human: {
    reviewSurface,
    cognitiveContext,
    coordinationBoundaries
  },
  uncertainty: {
    unresolvedFrontierRefs
  }
}
```

每一维必须有 unit、measurement/estimation source、scope、uncertainty。不存在 `50ms + 3 files + 2 owners` 这种未经 scalarization 的标量。

## 5. Pareto 是默认多目标裁决

```text
Dominates(a,b) =
  a hard-valid
  and for every comparable cost dimension a <= b
  and at least one comparable dimension a < b
  and no stronger accepted outcome/guarantee is lost
```

不可比较/未知维度保留 frontier，不用任意 zero/default补齐。

```text
frontier = Pareto(admissible candidates)
```

若 frontier只剩一个候选，可以 derived select；若多个非支配候选仍在，交给对应 ResponsibilityAssignment 或 accepted policy。

## 6. Scalarization 只能是显式有权 policy

某 consumer确实需要一个标量排序时：

```text
ScalarizationPolicy = exact {
  decisionDimensionRef,
  normalizedDimensionRefs,
  unitConversionRefs,
  weightsOrLexicographicOrder,
  missing/unknown semantics,
  issuer,
  validity/reversal
}
```

它是有 scope 的 DesignDecision/Policy，不是 CostVector 本身。改变权重只使消费该 policy 的 decision closure stale，不改变原始 measurement facts。

## 7. Boundary / Placement / Fragmentation 统一复用

System boundary、Implementation placement、Documentation fragmentation 不再各自发明一个异量纲加法式。它们只声明该决策适用的 cost dimensions 与 hard constraints：

```text
candidate
→ hard validity
→ measure/estimate shared LifecycleCostVector dimensions
→ Pareto reduce
→ explicit tradeoff policy only if needed
```

领域可以新增专有 dimension，但不能重新定义 Pareto/dominance。

## 8. 新信息与新评价维度的局部演进

未来发现新的成本维度 x：

```text
register typed dimension x
→ only candidates/decisions whose objective set references x become stale
→ old measurements remain valid for their dimensions
```

不能给所有历史决策的全局 `costModelVersion` 加一并强制全仓重算，除非 x 被有权 root policy声明为所有决策新的 mandatory hard dimension。

## 9. 完成

```text
ConstraintDecisionClosed =
  every Constraint has a bounded decidable input universe or is not called Constraint
  and every richer Claim lowers to an explicit proof obligation/frontier
  and all heterogeneous costs remain typed vectors with units/provenance
  and Pareto precedes optional scalarization
  and scalarization is explicit owner-issued policy
  and new dimensions only invalidate actual consumers
```

<!-- sec-clause {"id":"constraint-decision-semantics","blocker":null,"kind":"stable-decision"} -->
## 规范片段

Constraint只表示在声明bounded universe上的可判定predicate；Temporal/Statistical/Robustness/Relational等Claim必须lower为对应proof obligation或frontier。跨量纲成本统一为带unit/provenance的LifecycleCostVector，默认Pareto裁决；任何标量化都必须是显式有权policy，新维度只局部失效实际消费者。
