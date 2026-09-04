---
title: 生命周期、身份、证明与演进
status: stable
domain: system-architecture
---

# 生命周期、身份、证明与演进

本文拥有通用 State/Lifecycle/Failure、semantic/content/physical identity、provenance、Evidence/Verdict relation、reduction disposition 与 generation evolution。**ActionKey / computation-input locality / reverse invalidation算法由 [Derivation Locality](derivation-locality.md) 唯一拥有**；本文只引用其 exact derivation receipts，不再复制 ActionKey公式。领域 state machine、physical journal、Verification execution、Migration effect由各自 owner refinement。

## 1. State / Lifecycle / Failure

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
  proposed | accepted | active
  | superseding | draining | terminal
  | residue | retired
```

Subject family可以收窄/专门化状态与合法边，但不能用 `null`、文件存在、PID、branch、human status、process exit替代 state。状态变化只在 canonical owner linearization point提交；projection/cache/event只引用已提交 revision。

```text
Failure =
  | rejected
  | unresolved
  | stale
  | expired
  | partial
  | lost-handle
  | residue
  | internal-defect
```

failure kind必须保留到 public result。retry需要：合同允许 + operation budget仍合法 + readback排除重复 Effect + 新 admission/因果变化；catch-all false/null/generic error不能改变语义。

## 2. Identity coordinates

```text
SemanticIdentity = stable SubjectRef issued by identity namespace authority
SubjectRevision  = SubjectRef + exact accepted Definition revision
ContentIdentity  = digest(exact canonical bytes + grammar/interpreter closure)
OperationIdentity = definition revision + normalized input + exact immutable semantic dependencies
PhysicalBinding = Address + retained physical identity + provider/host epoch
```

这些坐标正交：SemanticIdentity、active owner、scope membership、lifecycle、revision、serialization grammar、Address、presentation label、operation attempt都不能互相替代。

- Definition变化通常产生新 SubjectRevision，不产生新 Subject；
- split/merge/replacement通过显式 identity evolution改变 referent；
- move/relabel保持 semantic identity；
- same-address ABA replacement必须改变 PhysicalBinding；
- `version` suffix、mtime、branch、cache key不能单独产生 identity。

Documentation Clause等 specialization由其 domain owner定义，但必须保持上述 non-alias law。

## 3. Provenance DAG

```text
ProvenanceNode =
  authored-decision | accepted-definition | observation
  | derivation-receipt | compiled-artifact
  | effect-settlement | readback | evidence | verdict

ProvenanceEdge =
  derived-from | observed-by | authorized-by | bound-to
  | settled-by | supports | invalidated-by | supersedes
```

图必须有限、无环，并保留 issuer/producer/interpreter/environment/generation。self-digest只证明 bytes identity，不证明 owner/authority/truth/completion。

Derivation node必须引用 `DerivationReceipt`，其中 ActionKey 与 exact reachable input closure由 Derivation Locality owner计算；本文件不把 whole publication generation重新加入 derivation identity。

## 4. Derivation reuse 只引用 owner result

```text
ReuseRelation =
  exact DerivationReceiptRef
  + current required computation input closure ref
  + strict result readback/freshness ref
```

Reuse可以输出 `reusable | missing | stale | foreign | invalid | unresolved`，但 classification算法/ActionKey定义属于 Derivation Locality。本文只规定：reuse不能扩大 Claim、Authority、Coverage；cache/index/pointer/fact shard本身都不签发 truth。

一个 publication generation变化，如果不改变某 computation actual input closure，不得由本 Lifecycle owner自行宣布该 computation stale。

## 5. Claim / Evidence / Verdict

```text
ClaimDefinition = owner-issued proposition + subject universe + proof-obligation refs
Evidence        = immutable observation result bound to exact inputs/environment
Verdict         = independent evaluation of Evidence against ClaimDefinition
```

Claim semantics的 proof-obligation lowering由 Design Calculus child拥有，Verification负责具体 Gate/Result/Aggregate。本文只拥有通用 provenance relation：producer/executor/collector/verifier/publisher 权限分离；Evidence缺失、stale、environment drift、coverage gap、unknown都是 non-pass input，不能变 PASS。

## 6. Reduction / object existence

```text
Disposition =
  required | derivable | duplicate-owner | dominated | orphan | unknown
```

删除反事实：

```text
Required(x) if removing x would
  worsen an accepted outcome
  or violate a hard invariant/public/durable/external contract
  or remove the sole recovery/evidence boundary
  or make lifecycle cost Pareto-worse without a dominating replacement
```

- `derivable`：应从唯一 owner重建，不手写镜像；
- `duplicate-owner`：迁移到唯一 owner；
- `dominated/orphan`：consumer/authority/state/Evidence/unknown closure为零后退役；
- `unknown`：保留 bounded frontier，不猜删除/保留；
- 未激活 FutureObligation只保留 design relation，不物化 active empty shell。

Cost/dominance引用 `design.cost-model` owner，不在此处重新加权。

## 7. Revision / Generation / Epoch / Version

| coordinate | exact meaning | invalidates | cannot replace |
| --- | --- | --- | --- |
| revision | 同一 Subject/content carrier 的 exact变化 | 引用该 revision 的实际 consumers | multi-object publication / runtime authority interval |
| generation | 一组 compatible exact revisions/relations的 immutable publication | 观察 whole generation 或依赖 changed member 的 consumers | single-field revision / schema compatibility |
| epoch | session/operation/provider/authority bounded validity interval | live bindings/admissions | durable grammar / semantic meaning |
| version | durable/external grammar/support protocol 的真实多态 discriminator | readers/migrations that branch on it | revision/generation/epoch/marketing label |

一个 `Vn` 不能同时编码四种坐标。只有真实 consumer需要区分相应状态时才保留该 coordinate；否则删除无消费 version/generation mirrors。

## 8. Evolution

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

正常路径同一 semantic writer/parser/resolver只有一个 active generation：

```text
old active
→ candidate/shadow
→ preservation/conformance proof
→ atomic cutover + readback
→ old draining
→ consumer/residue zero
→ retired
```

旧 parser/provider/route只在 bounded migration/support scope可达；不能永久 dual read/write/fallback。外部 support window由 Product/Interface/Change owner决定，不由内部 import count猜。

## 9. Meta-model evolution / locality

新 construct x：

1. 先判断能否由 existing primitive/profile/relation无损表达；
2. 能表达：只添加 typed instance/relation/binding；
3. 不能表达且具有新的独立 admission/authority/lifecycle/failure semantics：由 owner定义新 construct；
4. 给出 old→new expressible-subset preservation / migration；
5. 只 invalidate reverse-reachable artifacts/proofs/Evidence；
6. unrelated semantic identities与 ActionKeys保持稳定。

不能靠一个 global `metaModelVersion` 迫使所有无关 object/Action 重新生成，除非所有 computation contract确实观察整个 meta-model generation。

## 10. 信息 partition

| information | owner | forbidden contamination |
| --- | --- | --- |
| accepted outcome/decision | Product/Domain | current path/provider/test/status |
| universal law/calculus | constitution/design | SEC transient implementation |
| target design | logical/implementation compiler | current inventory/migration state |
| current observation | Source/runtime/provider | target adoption/value judgment |
| derivation identity/reuse | Derivation Locality | global generation by default |
| transition/migration | Change owner | target redefinition/effect authority |
| operational state | state/runtime owner | stable prose mirror |
| Evidence/Verdict | Verification | producer self-claim |
| projection | Interface/Documentation | new meaning/writeback |

## 11. Logical design artifact boundary

```text
LogicalScopeArtifact = exact {
  scopeRef,
  acceptedProductAndDefinitionRefs,
  responsibilityAndPublicOperationRefs,
  invariantStateFailureRelationRefs,
  authorityCapabilityResourceRequirementRefs,
  claimAndObservableRefs,
  childScopeArtifactRefs,
  futureObligationAndFrontierRefs,
  rationaleAndReversalRefs,
  artifactDigest
}
```

Artifact按 recursive scope组合，不含 file/package/path/framework/provider instance/process/test list/migration command。Implementation compiler refine它；Current observation不能回写它以迁就现有代码。

## 12. Completion

```text
LifecycleProofEvolutionClosed =
  every state has one owner + legal transition
  and every failure remains typed
  and semantic/content/physical identities are non-aliased
  and provenance is finite/non-circular
  and derivations reference exact owner-issued local input receipts
  and every Claim has independent Evidence/Verdict semantics
  and every object has a reduction disposition
  and every generation transition converges to one active generation or typed residue
  and meta-model changes preserve old expressible meaning or explicitly migrate/retire it
```

<!-- sec-clause {"id":"lifecycle-proof-evolution","blocker":null,"kind":"stable-decision"} -->
## 规范片段

Lifecycle owner管理State/Failure、semantic/content/physical identity、provenance、Evidence relation、reduction与generation evolution；ActionKey/derivation locality只引用独立owner result。Revision/Generation/Epoch/Version分域，新信息只失效实际reverse consumers；cache/global generation/self-digest不能扩大truth或制造无因果的全局staleness。
