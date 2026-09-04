---
title: Capability Relation 与交付偏序
status: stable
domain: roadmap
---

# Capability Relation 与交付偏序

本文拥有 capability 节点之间的 relation kinds、哪些 relation 可形成硬 prerequisite DAG、哪些只能表达 Evidence/校准/反馈/调度。节点 exit obligations 仍由 `docs/roadmap/capability-dag.md` 拥有；各领域内部对象关系只能引用 canonical owner，Roadmap 不复制第二份语义拓扑。

## 1. 一个 `A → B` 不足以表达关系

以下语义不能压成同一种“依赖”：

```text
CapabilityRelation =
  | RequiresSemantic
  | RequiresAdmission
  | RequiresEvidence
  | SuppliesCandidate
  | CalibratedBy
  | Revalidates
  | Enables
  | DeliveryAfter
```

### RequiresSemantic

B 的 Definition/Contract 无法在缺少 A 的正式产物时表达或验证。属于硬语义 prerequisite。

### RequiresAdmission

B 的实现写入/Effect 只有在 A 的 admission capability存在时才能合法进行。属于硬实施 prerequisite，但不等于 B 的语义定义依赖 A。

### RequiresEvidence

B 的 exit Claim需要 A 提供一种 Evidence。它阻止 exit，不自动阻止 B 的 target design/specification。

### SuppliesCandidate

A 给 B 提供 candidate input；B 可以有其他 candidate source，因此不是硬 prerequisite。

### CalibratedBy

A 的真实样本/measurement用来校准 B 的 policy、cost或coverage。关系可以发生在设计之后并反向使部分 Evidence stale。

### Revalidates

A 变化要求重新验证 B 的某些 Claim，但不改变 B 的稳定 identity。

### Enables

A 让 B 更便宜或增加实现方式；缺失 A 时 B 仍可能合法存在。

### DeliveryAfter

纯交付/吞吐排序。只属于 current scheduling input，不得写进稳定 semantic prerequisite。

## 2. 哪些图必须无环

```text
SemanticPrerequisiteDAG = RequiresSemantic
ImplementationAdmissionDAG = RequiresAdmission after SCC/state-machine lowering
```

`SuppliesCandidate / CalibratedBy / Revalidates / Enables` 允许形成反馈关系；它们不是 import/owner DAG。`DeliveryAfter` 属于 current control projection，可以随资源和优先级改变。

禁止为了强迫所有关系 DAG 化而把反馈关系伪装成 hard dependency。

## 3. Brownfield / Provider 与 Target 的正确关系

Target Profile 与 Type Algebra是 Target compilation 的 owner-issued input；它们不要求先成功导入 Brownfield。

```text
Target/Profile
→ derives ImplementationRequirement

Brownfield adoption ─SuppliesCandidate→ Implementation Resolution
Verified Provider   ─SuppliesCandidate→ Implementation Resolution
Repository Existing ─SuppliesCandidate→ Implementation Resolution
Reference/Custom    ─SuppliesCandidate→ Implementation Resolution

Target/Profile ─RequiresEvidence→ Provider Target conformance
```

因此不能写：

```text
Brownfield adoption → Target/Profile
```

作为硬 prerequisite。真实 Brownfield corpus可以 `CalibratedBy` Target/Compiler design，Provider verification可以需要 Target conformance，但这不形成语义循环。

## 4. Roadmap 节点只拥有能力级 relation

```text
CapabilityNode = exact {
  capabilityRef,
  definitionOwnerRef,
  relationRefs,
  entryObligationRefs,
  exitClaimRefs,
  reversalRefs
}
```

Roadmap 不重新定义：

- Claim/Gate/Result/Evidence 的内部方向；
- Grant/Binding/Allocation algebra；
- Design primitive；
- Resource algebra；
- Mutation state machine；
- Provider maturity state machine。

需要解释时引用对应 owner。Roadmap中的图只能画 capability node/typed capability edge；领域内部图属于 projection，必须从 owner graph生成。

## 5. Capability edge admission

```text
CapabilityEdgeAdmitted(edge) =
  source/target identities exist
  and relationKind is explicit
  and witness owner is unique
  and reversal/invalidation behavior is defined
  and hard-prerequisite edges have a proof that deleting source makes target illegal
```

“现在先做 A 再做 B”“A 有利于 B”“当前 B 的测试用了 A”都不足以生成 `RequiresSemantic`。

## 6. 新能力的局部插入

新增语言、Provider、Deployment、Verification 方法或未来 capability 时：

```text
new capability node
+ only its typed incoming/outgoing relations
+ own exit obligations
```

已有无关 capability identity/number/order保持不变。若新能力只供应 candidate或Evidence，不修改主 prerequisite DAG；只有证明目标 capability 在没有它时不可合法表达/执行，才增加 hard edge。

## 7. 当前调度与稳定 DAG 分离

Stable roadmap只保存 capability identity/relations/exit contracts。Issue、Work Package、priority、exact main、current blocker、delivery wave 都由 current WorkSelection/ExecutionWave 计算。

稳定 capability relation变化只使受影响 node closure重新计算；当前调度变化不允许反向修改稳定 relation。

## 8. 完成

```text
CapabilityRelationsClosed =
  every edge has one explicit relation kind
  and hard prerequisite DAGs contain only true illegality dependencies
  and evidence/candidate/calibration/feedback are not promoted to hard edges
  and roadmap contains no duplicated domain-internal ontology
  and new capability insertion changes only adjacent typed relations and reverse-reachable closure
```

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

Capability Roadmap的边必须分型为RequiresSemantic、RequiresAdmission、RequiresEvidence、SuppliesCandidate、CalibratedBy、Revalidates、Enables或DeliveryAfter；只有真正使目标非法的前两类形成硬prerequisite DAG。Roadmap只拥有能力级refs/exit obligations，不复制Claim、Grant、Resource、Mutation或Provider内部拓扑。
