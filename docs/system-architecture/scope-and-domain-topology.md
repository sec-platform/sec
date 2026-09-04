---
title: 递归系统拓扑与 Domain 边界
status: stable
domain: system-architecture
---

# 递归系统拓扑与 Domain 边界

本文拥有 SEC 的递归 semantic scope、Domain boundary proof、跨 scope visibility 与 boundary partition compiler。它不枚举源码目录、package、Provider 或当前文档标签作为 Domain；Operation/Authority/Resource/Proof分别由同 domain 其他 owner拥有。Boundary tradeoff统一消费 `docs/design-calculus/constraints-and-decision.md` 的 typed LifecycleCostVector/Pareto，不另建异量纲标量公式。

## 1. 一个模型，两种正交拓扑

SEC canonical model是带递归 scope 的 typed hypergraph：

```text
ContainmentTopology
  = semantic cohesion / ownership parent-child

RelationTopology
  = requires / composes / binds / grants / allocates /
    observes / proves / projects / evolves / feedback
```

| topology | canonical structure | cannot mean |
| --- | --- | --- |
| cohesion containment | 每个非root semantic scope恰一个parent，acyclic | dependency、多归属、proof、filesystem |
| typed relation graph | DAG/hyperedge/state-machine/SCC-with-explicit-feedback | 第二 containment、service locator、目录树 |

`path`、folder、package、process、deployment、document都是后续 Address/realization。它们不能反向产生 semantic parent 或 Domain identity。

## 2. Universal kernel、Product profile、Definition generation、Runtime instance 分离

```text
Universal kernel
  + Accepted Product/Profile
→ Compiled Definition Generation
→ Runtime/Workspace instances
→ Purpose-bound views
```

| partition | contains | excludes |
| --- | --- | --- |
| universal kernel | typed identity/relation/constraint/transition laws | Git、Docker、TS、业务名、目录 |
| accepted product profile | outcome/non-goal/业务Definitions/Target/FutureObligations | current process/path/cache |
| definition generation | scopes、boundary proofs、public operations、requirements、claims | mutable runtime state |
| runtime/workspace | exact content/grant/binding/allocation/attempt/state | new Definition/hidden Domain |
| purpose view | consumer所需最小relation closure | second truth、authority widening |

未来行业/语言/Provider需求优先增加 profile fact/relation/binding；只有现有 Design Calculus 无法无损表达新的独立语义时才做 meta-model evolution。

## 3. Recursive scope algebra

```text
SemanticScope =
  | UniverseRoot {
      universeRef,
      acceptedLawAdoptionAndProductRefs,
      completionPredicateRef
    }
  | CohesionScope {
      scopeRef,
      parentScopeRef,
      scopeKind: domain | responsibility | operation | contract,
      ownedCarrierRefs,
      boundaryProofRef,
      completionPredicateRef
    }
```

| kind | creation condition | not enough |
| --- | --- | --- |
| domain | proper semantic subset + cohesive invariant/state/failure + stable public operations + independent evolution | tech stack/team/folder/topic |
| responsibility | indivisible decision/state responsibility + unique owner + public demand | class/file/consumer |
| operation | pre/post + Requirement DAG + linearization/idempotency + typed result/failure | command/function/process |
| contract | independent consumer/revision/invalidation or durable/external boundary | DTO/alias/index |

不存在“为了导航”建的空 scope。Subscope 只有在 proper subset、cohesion、independent addressable contract/completion 与 lifecycle/context benefit 共同成立时创建；行数、作者数与目录美观不参与 semantic existence。

同一现实 referent 在两个 bounded context 中若 meaning/invariant/lifecycle不同，应形成不同 context-scoped Subjects，以 typed translation/correspondence relation连接；不能强塞同一个多parent Subject/DTO。

## 4. Non-containment roles

Constitution、ProductCapability、Decision/Policy、Workflow、Requirement/Provision、Authority/Resource/Evidence/Evolution facets、Responsibility realization、Projection/Interface、Operational Control、Proposal都通过 typed relation连接 scope。它们不因“重要”“共享”或拥有一个文件夹自动成为 Domain。

外部业务域通过：

```text
ExternalScopeBinding = exact {
  externalAuthorityAndScopeRef,
  admittedPublicContractRefs,
  identityTranslationAndDisclosureRefs,
  observationCoverageAndUnknownRefs,
  supportAndEvolutionRefs
}
```

进入本Universe。本系统拥有 binding 与本侧 operation，不拥有外部 private Definition/state。

## 5. Domain boundary compiler

```text
DomainCandidateUniverse =
  accepted Subjects/Definitions/Invariants
  + StateMachines/FailureAlgebras
  + public Operations/Results
  + Authority/information boundaries
  + FutureObligations
```

Hard constraints：

```text
DomainPartitionHardValid(P) =
  every semantic fact has one owner
  and no indivisible invariant crosses independently committable domains
  and every cross-domain edge terminates at stable public contract/operation/result
  and no domain reads another domain private state/journal/primitive
  and tenant/security/consistency/authority boundaries preserved
  and every domain has non-empty responsibility + completion predicate
```

一般 hypergraph partition可能NP-hard；compiler不能宣称无界最优。算法：must-cohere contraction → must-separate constraints → independent component decomposition → bounded cut candidate generation → hard propagation/dominance pruning → exact branch-and-bound/ILP/SAT on bounded ambiguous cuts → whole-partition validation。预算耗尽返回 bounded unexplored frontier 与已证 lower/upper bounds。

## 6. Boundary cost 是向量，不是异量纲求和

每个 hard-valid partition只声明实际适用的 cost dimensions：

```text
DomainBoundaryObjectiveDimensions = {
  protocolAndTranslation,
  consistencyAndFailureMapping,
  latency,
  authorization/trust boundaries,
  evolution/migration,
  coordination/cognitiveLoad,
  contention,
  releaseCoupling,
  blastRadius,
  futureChangeCost,
  unresolvedFrontier
}
```

每一维必须映射到 shared LifecycleCostVector 的 unit/provenance/uncertainty；不能把 latency、owner count、cognitive cost、migration step 直接相加。

裁决：

1. hard-invalid partition拒绝；
2. Pareto-dominated partition删除；
3. 唯一non-dominated且无需不可推导tradeoff时derived select；
4. 多个non-dominated候选由该 boundary decision 的ResponsibilityAssignment按显式 policy采用；
5. 未有合法 owner/policy则保留 Frontier。

新增 measured cost x 只使 objective set引用 x 的 boundary proofs stale；不能用一个 global `boundaryCostModelVersion` 使全部 Domain重算。

## 7. DomainBoundaryProof

```text
DomainBoundaryProof = exact owner-issued {
  domainRef,
  memberCarrierRefs,
  cohesionInvariantAndAtomicTransitionRefs,
  publicOperationResultRefs,
  independentStateFailureAuthorityEvolutionRefs,
  acceptedFutureObligationRefs,
  comparedObjectiveVectorRefs,
  rejectedCandidateReasonRefs,
  reversalPredicateRefs,
  exactInputClosureRefs,
  proofDigest
}
```

“当前只有一个consumer”不能证明永久合并；“未来也许有用”不能证明永久拆分。后者只有形成 owner-issued FutureObligation才进入 objective/constraints。

## 8. Current names are not Domain evidence

当前 frontmatter/registry 的 `domain` 只是 documentation owner-group/addressing observation，不能直接成为 Domain compiler input。Product 的 accepted Domain partition input由 `docs/product.md` 唯一拥有；System Architecture验证 boundary proofs并生成 `DomainMap`：

```text
DomainMap = generated {
  exactUniverseAndDefinitionInputClosureRefs,
  recursiveDomainScopeRefs,
  boundaryProofRefs,
  publicCrossDomainRelationAndWorkflowRefs,
  unresolvedBoundaryFrontierRefs,
  mapDigest
}
```

`DomainMap`是可重建编译结果，不是全局runtime registry。文档标签、实现模块、团队重组变化不自动增删 Domain。

## 9. Purpose views share one graph

```text
VisibleSlice = leastFixedPoint(
  purpose roots,
  allowed relation kinds,
  disclosure ceiling,
  canonical scoped graph
)
```

operation minimal slice、owner review、whole-system audit共享相同 identities/blockers/unknowns。展示 budget只能折叠 representation，不改变 selection/Claim/Authority/completeness。

纯 library 不生成无关 Grant/journal/distributed saga；local Effect不生成无关 external domain；Brownfield observation不自动获得 adoption/mutation authority。所谓“通用”是共享同一 laws + applicability pruning，不是每个场景展示最大模型。

## 10. Physical organization is a realization

Document fragment、ImplementationUnit、package、process/service都可从 semantic topology + realization profile 编译，但优化目标和生命周期不同：

```text
Domain != folder != package != process != document
```

同一 Domain可以有多个 realization；一个process也可承载多个domain adapter，只要semantic owner/state/failure isolation可证明。

## 11. Local evolution law

新 fact/relation/accepted obligation x：

```text
x
→ update only its cohesion/relation constraints
→ recompute containing ambiguous component
→ invalidate reverse-reachable boundary proofs/views
→ preserve unrelated DomainRefs/proofs
```

只有 x 引入新的不可分 invariant/authority/state/evolution boundary 时，Domain partition才需要结构变化。新工具、path、Provider、文档topic不能作为触发器。

## 12. 完成

```text
ScopedSystemTopologyClosed =
  every carrier belongs to exactly one recursive cohesion scope
  and every Domain has a current DomainBoundaryProof
  and every non-containment dependency is an exact typed relation
  and every cross-domain edge terminates at a public contract
  and every scope has completion + bounded unknown frontier
  and every selected partition is hard-valid and non-dominated or explicitly owner-selected
  and minimal/maximal views derive from the same graph
  and no label/path/package/facade/Provider/projection creates meaning
  and physical placement traces to admitted realization
```

<!-- sec-clause {"id":"scope-domain-topology","blocker":null,"kind":"stable-decision"} -->
## 规范片段

Domain是recursive semantic cohesion scope的可验证partition，不由文档/目录/package/Provider命名产生。Boundary候选先满足owner/invariant/public-contract/security等hard constraints，再按共享LifecycleCostVector/Pareto裁决；新增事实只重算其所在ambiguous component和reverse-reachable proofs，不能制造全局Domain重分区。
