---
title: 设计编译与对抗验证
status: stable
domain: design-calculus
---

# 设计编译与对抗验证

本文拥有Design Compiler的输入输出、候选合成、Pareto裁决、fault/concern生成、可执行模型与反例吸收算法。它不拥有任何Product/Domain答案，也不执行实现、测试、迁移或Effect。

## 1. Purpose-specific compilation

```text
DesignCompilationRequest =
  | TargetDesignRequest {
      accepted product/domain roots,
      owner-adopted target/profile/future-obligation refs
    }
  | ObservedInventoryAuditRequest {
      exact observation universe + coverage refs
    }
  | TargetRelativeAuditRequest {
      closed target design ref,
      exact observation universe + coverage refs
    }
  | TransitionDesignRequest {
      closed target-relative audit ref,
      current/target evolution roots
    }
```

四种purpose共享meta-model和typed refs，但不共享可选payload。Target Design不能读取当前实现以决定目标；Observed Audit不能产生业务adoption；Transition只能消费closed target-relative input。

```text
DesignCompilationResult =
  | InvalidDesignInput {
      purpose,
      exactInputDigest,
      violations
    }
  | ValidDesignCompilation {
      exactInputAndUniverseDigests,
      normalizedModelRef,
      completion: Closed | OpenFrontier,
      output:
        | CompiledTargetDesign {
          purpose: target-design,
          logical/target/conformance artifact refs,
          generated obligation/candidate/coverage refs,
          targetDesignManifestRef
        }
        | CompiledObservedInventoryAudit {
          purpose: observed-inventory-audit,
          observation generation/coverage refs,
          intrinsic classification/finding refs,
          observedInventoryAuditManifestRef
        }
        | CompiledTargetRelativeAudit {
          purpose: target-relative-audit,
          target/observed generation refs,
          reconciliation refs,
          targetRelativeAuditManifestRef
        }
        | CompiledTransitionDesign {
          purpose: transition-design,
          targetRelativeAuditRef,
          preservation/evolution/conformance obligation refs,
          transitionDesignManifestRef
        },
      compilationDigest
    }
```

每个success variant只携带其purpose可合法产生的refs；不存在以`null`、空数组或generic artifact字段伪装not-applicable。`Closed`与`OpenFrontier`使用不同variant；invalid result不能携带看似可用的design artifact或manifest。

## 2. Pipeline

```mermaid
flowchart LR
  I[Exact admitted inputs] --> N[Normalize typed model]
  N --> U[Compile purpose universe]
  U --> O[Generate obligations]
  O --> K[Generate competing candidates]
  K --> C[Constraint + trace checks]
  C --> P[Pareto reduction]
  P --> F[Fault / interaction closure]
  F --> M[Executable model + properties]
  M --> R[Counterexamples / bounded frontier]
  R --> S[Design artifacts + closure result]
```

所有阶段pure、deterministic、side-read-free；外部资料、Source Program、runtime observation与cost measurement必须先成为exact input records。Input order和parallel evaluation不能改变canonical output。

```text
compile(request):
  validate exact variants, issuers, revisions and authority ceilings
  model := normalize(request inputs)
  universe := leastFixedPoint(request roots, purpose relation policy)
  obligations := generateApplicableConcernFaultRealizationCoordinates(universe)
  candidates := synthesizeCompetingModels(obligations)
  admissible := rejectHardViolationsAndUnpreservedTraces(candidates)
  frontier := paretoReduce(admissible, lifecycleCostVector)
  conformance := compilePropertiesAndExecutableModels(frontier)
  return closed design artifacts or exact bounded frontier
```

## 3. Candidate synthesis

Compiler必须比较结构不同的候选，而不是验证作者先给出的单一方案：

| axis | candidate families |
| --- | --- |
| existence | delete、derive、project、active realization、bounded future obligation |
| ownership | same Domain、shared upstream primitive、independent Domain、external owner |
| composition | direct pure call、typed port、compiled workflow、microkernel、external protocol |
| state | stateless、ephemeral attempt、durable state、external authoritative state |
| execution | in-process、retained process、durable local worker、remote provider |
| topology | co-located、partitioned、distributed、central mechanism/decentralized policy |
| reuse | algorithm、contract、fact、port、provider、workflow pattern、none |
| production | governed-authored、deterministic-generated、mature external mechanism |
| evolution | atomic replacement、bounded migration、retirement、typed unavailable |

Candidate axes按实际obligations裁剪；不适用的axis不得为了“全面”进入设计。Compiler先用hard constraints、semantic equivalence、symmetry与因果独立性剪枝，再比较成本。

```text
ArchitectureSearchEnvelope = {
  decision variables,
  hard constraints,
  semantic equivalence classes,
  symmetry breakers,
  objective vector,
  checked infeasibility/dominance lower bounds,
  time/state/resource allocation,
  explored/pruned region digest
}
```

```text
search(envelope):
  normalize constraints
  if conflicted -> return minimal conflict core
  decompose causally independent variables
  canonicalize equivalent candidates
  prune only with checked infeasibility or dominance proof
  evaluate trace preservation and lifecycle cost
  return ExactParetoFrontier
      | BestKnownWithBoundedUnexploredFrontier
```

资源耗尽时不能把best-known称为最优。可声称的最强结论是：

```text
OptimalWithinCoverage =
  exact compiled universe
  + generated candidate/requirement coverage
  + no known hard violation
  + non-dominated among explored admissible candidates
  + explicit unexplored/reversal frontier
```

## 4. External mechanism survey

成熟库、compiler、LSP、orchestrator、database、protocol、formal tool和cloud service必须与自建、删除、组合方案同场比较；知名度、下载量、搜索排序和AI记忆只产生candidate。

```text
ExternalMechanismSurvey = {
  exact Requirement/Constraint slice,
  observation time/provider/source revisions,
  searched standards + official implementations + primary research
    + relevant ecosystems,
  candidate mechanism inventory,
  exact absorbed/rejected properties,
  license/platform/security/maintenance/supply-chain facts,
  integration/migration/retirement cost,
  dominated/rejected candidates,
  unresolved search frontier,
  surveyDigest
}
```

Survey只有在所有适用source strata已查询、独立query formulation不再增加non-dominated candidate、每项有adopt/absorb/combine/reject disposition时，才在声明coverage内saturated。后来出现的新机制按reversal predicate重开相关设计。

选择外部机制后，Implementation Architecture必须重新绑定actual package/binary/protocol identity、capabilities、operation envelope与settlement；survey不能签发runtime authority。

## 5. Coverage generation

```text
DesignCoverageCoordinate = applicable(
  semantic carrier/relation
  × lifecycle phase
  × actor/principal/tenant
  × environment/platform/topology/scale
  × concern family
  × fault family
  × claim/consumer/evolution state
)
```

不是物化完整Cartesian product。Reachability、closed variants、not-applicable proof、symmetry与independence先剪枝；opaque/dynamic/external项成为bounded frontier。

稳定fault axes：

```text
FaultCoordinate =
  SemanticSurface
  × LifecyclePhase
  × Stimulus
  × Multiplicity
  × OrderingAndTimeDomain
  × TrustAndTenantBoundary
  × ResourceScale
  × ObservationLossMode
```

典型stimulus包括replace/ABA、duplicate、omit、corrupt、delay、reorder、revoke、partition、crash、overload、spoof、drift与replay。实际模型没有credential、tenant、durable state或external boundary时，相应coordinates由not-applicable proof删除。

每个applicable coordinate只允许：`satisfied | not-applicable(proof) | violated(trace) | required-unmaterialized | bounded-unknown(frontier)`。

## 6. Required properties

| property | obligation |
| --- | --- |
| non-vacuity | 合法条件下至少一条accepted success trace可达；全拒绝不是实现 |
| safety | forbidden truth/identity/authority/data/Effect不可达 |
| liveness/fairness | 合法下一步与资源存在时可达terminal；无无界饥饿/等待 |
| determinism | 同semantic inputs/algorithm/unknown产生byte-equivalent pure result |
| recoverability | 每个admitted Effect到达terminal、typed residue或blocked |
| compositionality | public contracts成立时组合不新增hidden authority |
| fact uniqueness | 每项authored meaning/relation唯一owner；views只引用 |
| projection/disclosure fidelity | renderer不改变meaning/unknown/authority/visibility |
| monotonic epistemics | 新Evidence只收窄unknown或推翻Claim，不扩大Grant |
| quantitative/statistical validity | unit/population/error/confidence/tolerance匹配Claim |
| robustness | 声明environment/variation内保持性质；范围外显式frontier |
| relational fidelity | 多轨迹输入差异、principal observation与允许泄露关系成立 |
| evolution | cutover后旧writer/parser/route consumer-zero |
| economy | 全生命周期正确变更成本非支配或有accepted tradeoff |

## 7. Executable design model

并发、lease、resource、retry、lost handle、recovery、migration和multi-writer protocol不能只靠图或prose：

```text
ExecutableTransitionModel = {
  exact logical design artifact ref,
  typed state variables,
  initial predicate,
  transition relations + guards + abstract Effects,
  invariants,
  terminal/residue predicates,
  fairness/liveness assumptions,
  environment actions,
  relational trace properties,
  abstraction/symmetry proof refs,
  modelDigest
}

ModelExplorationEnvelope = {
  actor/resource/state cardinalities,
  event orderings and fault schedules,
  time/state allocation,
  reduction proof refs,
  bounded unknown frontier
}
```

```text
checkModel(model, envelope):
  validate every transition lowers from logical operations
  explore every finite state/ordering/fault within envelope
  use self-composition/product construction for relational properties
  emit shortest counterexample per violated property
  run boundary/property generators outside enumerated cardinalities
  return ProvenWithinEnvelope | Violated(trace) | Unresolved(frontier)
```

Bounded exploration不证明开放世界或physical implementation。Abstraction和symmetry reduction必须证明保留目标性质；不能删失败state、environment action或resource dimension来让模型跑完。

## 8. Systemic counterexample assimilation

反例不是提示词、Skill条款、测试清单或局部`if`。先最小化为可重放property trace，再定位所有必要因果边界：

```text
DesignGap =
  | ExpressionGap
  | UniverseGap
  | ApplicabilityGap
  | RefinementGap
  | EnforcementGap
  | ProofGap
  | EvolutionGap
```

```text
assimilate(counterexample, exactGeneration):
  witness := minimizeToPropertyTrace(counterexample)
  causalCut := classifyAllNecessaryBoundaries(witness)
  candidates := synthesizeSystemInterventions(
    delete | redefine | repartition | recombine | replace | externalize
    | migrate | retire | deferAsBoundedObligation,
    causalCut, accepted outcomes, exact observed world)
  for each candidate:
    compile normative/observed reconciliation
    check trace preservation, hard constraints, recovery and lifecycle cost
  select unique accepted non-dominated candidate or preserve decision frontier
  invalidate every reverse-reachable design artifact/view/Evidence
  recompile declared affected universe
  retire local checks, mirrors and superseded generation
```

“第一处报错”只定位witness，不预先决定修复文件或owner。局部修复只有在compiler证明其余系统不变是non-dominated solution时才合法。

若反例可由现有meta-model表达但之前未生成义务，优先修Universe/Applicability/Enforcement，不扩ontology。只有反例需要新的独立admission、authority、lifecycle、invalidation、consumer visibility或用户结果区别时，才演进expression algebra。

## 9. Scenario contract

```text
DesignScenario = {
  exact model/design-artifact refs,
  purpose and initial state,
  actor/environment/resource bounds,
  event/fault schedule or property generator,
  expected legal terminal set,
  forbidden observations/effects/claims,
  coverage and unknown frontier,
  rationale/reversal refs
}
```

Scenario是Conformance Model输入，不是测试实现。实现测试、formal checker、simulation、runtime probe可分别materialize它，但任何单一provider的PASS不扩大scenario coverage。

## 10. Compilation closure

```text
DesignCompilationClosed =
  exact purpose universe compiled
  and all applicable obligations/coverage coordinates classified
  and competing realization candidates generated for every live decision
  and every selected candidate is hard-valid and non-dominated within coverage
  and required properties have executable or deductive proof obligations
  and all counterexamples are absorbed or retained as exact frontier
  and all outputs are deterministic, traceable and authority-free projections
```

此结果只产生design artifacts和frontier。它不能创建Work Package、安排执行、运行Provider、签发Grant、迁移state或宣布实现完成。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

Design Compiler必须从exact purpose universe生成适用义务、结构不同的候选、hard-constraint与trace判定、Pareto frontier、fault/interaction closure和可执行proof obligations；资源耗尽保留bounded unexplored frontier，反例触发全因果边界的系统变更合成，不能退化为局部补丁。
