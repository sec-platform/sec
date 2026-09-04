---
title: 生命周期、证明与演进
status: stable
domain: system-architecture
---

# 生命周期、证明与演进

本文只拥有通用 State/Lifecycle/Failure、identity/provenance、derivation reuse、Evidence/Verdict 和 evolution 关系。领域状态、物理 journal、具体测试与迁移实现由各自 owner refinement。

## 1. State、Lifecycle 与 Failure

状态按 semantic owner和linearization point划分，不按Git、数据库、目录、host或进程划分：

```text
StateTransition = exact {
  subjectRef,
  priorStateAndRevision,
  transitionDefinitionRef,
  authorityAndPreconditionRefs,
  effectSettlementAndReadbackRefs,
  nextStateOrFailure,
  transitionDigest
}
```

```text
LifecycleState =
  | proposed | accepted | active
  | superseding | draining | terminal
  | residue | retired
```

每个 Subject family可收窄这些状态并定义合法边，但不得把 `null`、文件存在、进程退出码、branch名或human status当状态。一个状态变化只在owner linearization point提交；projection、cache和event只引用已提交revision。

```text
Failure =
  | rejected       // 输入或约束明确不成立
  | unresolved     // 信息/能力不足
  | stale          // 输入generation已变化
  | expired        // authority/deadline/freshness失效
  | partial        // Effect已发生一部分
  | lost-handle    // attempt存在但直接句柄丢失
  | residue        // terminal cleanup/retirement未闭合
  | internal-defect
```

failure kind必须保留到public result；catch-all false/null/generic error不得改变语义。retry只适用于合同声明可重试、仍在同一operation budget且readback排除重复Effect的failure。

## 2. Identity 与 Address

```text
SemanticIdentity = stable SubjectRef issued once by the identity-namespace authority
SubjectRevision  = SubjectRef + exact accepted Definition generation/digest
ContentIdentity  = digest(exact canonical bytes + grammar/interpreter closure)
OperationIdentity = operation definition revision + normalized input + exact immutable dependencies
PhysicalBinding = address + retained physical identity + provider/host epoch
```

`SemanticIdentity`、active owner、scope membership、lifecycle、revision、serialization namespace、Address 与 presentation label 是正交关系；active owner 可以接管或移交 Subject，但不能重签、拼接或改写 `SubjectRef`。Definition 改变产生新的 `SubjectRevision`，不默认产生新 Subject；split、merge 或 replacement 才通过显式 identity-evolution relation 改变 referent。path、name、version suffix、PID、mtime、branch、cache key和display label均不能单独产生semantic identity。Address变化可保持语义；同一Address的ABA替换必须改变PhysicalBinding。

## 3. Provenance DAG

```text
ProvenanceNode =
  | authored-decision | accepted-definition | observation
  | compiled-artifact | effect-settlement | readback | evidence | verdict

ProvenanceEdge =
  | derived-from | observed-by | authorized-by | bound-to
  | settled-by | supports | invalidated-by | supersedes
```

图必须有限、无环并保留issuer/producer/interpreter/environment/generation。self-digest只证明bytes一致，不证明owner、authority、truth或completion。所有 claim 可追到独立事实；所有事实的使用可反查claim/consumer和失效条件。

## 4. Derivation 与 reuse

```text
ActionKey = digest(
  algorithm/compiler identity,
  exact semantic/content input refs,
  dependency/provider/environment generations,
  applicable policy/profile refs
)

RequiredExecutionClosure = reverseReachable(
  accepted delta/operation/Claim roots,
  semantic/source/public/state/Effect/fixture/Evidence relations
)

ExecutionSet = RequiredExecutionClosure ∩ MissingOrStaleActionKeys

ReuseResult =
  | reusable { exactKey, resultRef, coverageAndFreshnessRefs }
  | missing | stale | foreign | invalid | unresolved
```

reuse不能扩大Claim、Authority或Coverage。只有同一 exact key且strict readback成立才复用；其他结果回到同一clean derivation或typed block。clean、warm、delta和cache-disabled必须字节/语义等价。cache、index、pointer和fact shard是实现策略，不是truth。

## 5. Claim、Evidence 与 Verdict

```text
ClaimDefinition = owner-issued proposition + subject universe + required observations
Evidence        = immutable observation result bound to exact inputs/environment
Verdict         = independent evaluation of Evidence against ClaimDefinition
```

producer、executor、evidence collector、verifier和publisher的权限分别证明；任何一方不能闭合自己产生的Claim。Evidence缺失、过期、环境漂移、Coverage不足或unknown只产生non-pass结果。测试、CI、日志、review和命令输出只是Evidence providers，不等于Verdict或完成。

## 6. Reduction 与存在证明

每个候选对象运行删除反事实：

```text
Disposition =
  | required | derivable | duplicate-owner | dominated | orphan | unknown

Required(x) iff removing x worsens an accepted outcome,
  violates an invariant/public/durable/external contract,
  removes the sole recovery/evidence boundary,
  or increases correct-change lifecycle cost without a dominating replacement.
```

`derivable`应生成而非手写；`duplicate-owner`合并到唯一owner；`dominated/orphan`在consumer/authority/state/evidence/unknown闭合后退役；`unknown`保持bounded frontier。未来价值只有形成Design Calculus定义的`FutureObligation`才参与；本层只消费其exact ref，不复制或缩窄该record。

未激活FutureObligation保留设计关系，不物化空type、facade、package、version、runtime或test。

## 7. Evolution 与 generation

四种变化坐标不可互换：

| coordinate | 表示 | identity / invalidation | 不能替代 |
| --- | --- | --- | --- |
| revision | 同一Subject或content carrier的一次exact变化 | 保持stable subject identity；使引用旧revision的依赖stale | 多对象原子publication、运行授权期 |
| generation | 一组compatible exact revisions/relations的immutable closed publication | generation ref绑定整组closure；只在readback后active | 单字段revision、schema compatibility |
| epoch | session/operation/provider/authority的bounded validity interval | refresh、revocation、terminal或host/provider变化使绑定失效 | durable grammar版本、semantic meaning |
| version | durable/external grammar或support protocol对真实多态可观察状态的discriminator | reader/migration必须实际分支并拒绝未知 | generation、marketing label、fixture数字 |

generation/revision/version只在真实consumer必须区分相应可观察状态时存在；epoch只在运行关系需要明确有效期时存在。单实现、原子替换、命名区别、fixture或数字测试不产生版本语义，一个`Vn`也不能同时编码四种坐标。

```text
Evolution = exact {
  oldGenerationRef,
  newGenerationRef,
  semanticAndCompatibilityDeltaRefs,
  consumerTransitionRefs,
  cutoverAndRecoveryRefs,
  oldRetirementPredicateRef
}
```

正常路径只有一个active generation。旧parser/provider/route只在bounded migration scope读取精确旧态；新generation publish/readback后切换，旧consumer-zero与residue-zero后退役。不建立永久双读、双写、V1/V2 facade或fallback。外部support window属于Product/Interface/Change owner，不由内部consumer census猜测。

Meta-model evolution先定义旧/新construct语义与conservative extension：旧有效模型在新grammar下仍有同义投影，或通过显式migration得到；旧unknown不能被新版本默认为合法。演算本身变化使依赖它的design artifacts、proofs和Evidence按反向闭包stale。

## 8. 信息分区与理由

| information | 唯一owner/output | 不得混入 |
| --- | --- | --- |
| accepted outcome/decision | Product/Domain owner | current path/provider/test/status |
| universal principle/calculus | constitution/design owner | SEC实例、临时问题 |
| target design | logical/implementation compiler | current inventory、migration状态 |
| current observation | Source/runtime/provider owner | target adoption、价值判断 |
| transition | Change owner | target redefinition、Effect authority |
| operational state | state/runtime owner | stable design prose |
| Evidence/Verdict | verification owner | producer self-claim |
| projection | interface/documentation owner | new meaning、writeback |

不可推导设计选择引用一个 typed rationale：目的、来源、候选、hard constraints、成本向量、支配结果、后果、reversal condition与proof obligations。多种自然语言、表、图、公式是同一rationale的投影，不分别拥有事实；历史争论与“显然错误”的叙事不进入稳定设计。

## 9. 系统自攻

```text
AttackRound =
  generate faults from identity/authority/state/effect/resource/
    concurrency/external/evolution/proof/unknown relations
  → simulate reachable traces
  → find missing rejection/recovery/observable/frontier
  → invalidate causal dependents
  → redesign at highest wrong premise
```

独立策略轮次包括：删除反事实、边界互换、并发交错、崩溃点、provider替换、same-path ABA、恶意/损坏输入、resource exhaustion、external consumer unknown、future obligation activation和clean/warm/delta equivalence。停止条件不是“没想到新例子”，而是多个独立生成策略连续不再产生新的 fault class，且剩余frontier均bounded、有owner和closure predicate。

## 10. LogicalDesignArtifact

```text
LogicalScopeArtifact = exact {
  scopeRef,
  acceptedProductAndDefinitionRefs,
  responsibilityAndPublicOperationRefs,
  invariantStateFailureAndRelationRefs,
  authorityCapabilityResourceRequirementRefs,
  claimAndObservableRefs,
  childScopeArtifactRefs,
  futureObligationAndFrontierRefs,
  rationaleAndReversalRefs,
  artifactDigest
}
```

artifact按递归scope组成；父只保留boundary、child refs和completion。它不含file/distribution-package/path/framework/provider instance/process/container/test list或migration command。实现编译器只refine它，不能回写以迁就当前代码。

## 11. 完成

```text
LifecycleProofEvolutionClosed =
  every state has one owner and legal transition
  and every failure is typed through public result
  and every identity/provenance edge is non-circular
  and reuse is exact-key equivalent to clean derivation
  and every Claim has independent Evidence/Verdict semantics
  and every object has a reduction disposition
  and every generation transition ends in one active generation or typed residue
  and adversarial design reaches a bounded fixed point
```

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

State、identity、provenance、reuse、Evidence与evolution分别由唯一owner管理并以typed relations组合。失败不得降级，缓存不得签发truth，版本只服务真实双态consumer，未来能力只以有owner和激活条件的obligation存在。
