---
title: 系统架构与权威流
status: stable
domain: system-architecture
---

# 系统架构与权威流

本文是 SEC 逻辑架构入口，只拥有**跨 Domain layering** 与 **public cross-domain reference laws**。所有可独立演进的 algebra 都由下列 child owner 唯一维护：

| owner | sole responsibility |
| --- | --- |
| [Scope and Domain Topology](system-architecture/scope-and-domain-topology.md) | recursive semantic scope、DomainBoundaryProof、purpose slice |
| [Operations and Resources](system-architecture/operations-and-resources.md) | Operation variants、Responsibility/Owner flow、Requirement/Provision/Binding/Allocation joins、Workflow |
| [Authority Roots](system-architecture/authority-roots.md) | universal/project/product/domain/repository/external/compound authority root kinds |
| [Resource Accounting](system-architecture/resource-accounting.md) | ResourceDimension、accounting mode、reserve/measure/release/settle |
| [Derivation Locality](system-architecture/derivation-locality.md) | exact computation input closure、ActionKey、reverse invalidation |
| [Lifecycle, Proof and Evolution](system-architecture/lifecycle-proof-and-evolution.md) | State/Lifecycle/identity/provenance/Evidence/Evolution/reduction |

通用 relation/Constraint/decision semantics由 Design Calculus拥有；logical→implementation refinement由 Implementation Architecture拥有。Root 不复制 child 的字段、公式或状态机。

## 1. 架构核

SEC 把 accepted purpose、owner Definitions 与 exact world observations连接成可验证、可执行、可恢复、可演进的 typed relation graph：

```text
accepted outcome / law adoption
→ semantic Definitions + Constraints
→ Responsibility / Requirement
→ Provision + Grant + Allocation
→ AdmittedExecution
→ Effect / Settlement / Readback
→ Claim / Evidence / Verdict
→ Evolution / Publication / Retirement
```

这是 relation overview，不是新的对象 owner。每个箭头必须解析到其 canonical relation/operation owner；图不能用相邻节点顺序替代真实 admission。

## 2. Layering law

```text
Universal laws
  ↓ constrain
Product outcomes / Domain definitions
  ↓ refine
Logical design
  ↓ refine
Target implementation design
  ↓ admit
Runtime operation / physical effects
  ↓ observe
Evidence / Verdict
  ↓ may trigger owner-authorized evolution
```

下层不能通过当前实现、测试、路径或 Provider 反向改写上层 meaning。上层也不能因为“设计已存在”伪造下层 implementation/runtime/Evidence truth。

合法反馈只有：

```text
observation/counterexample
→ invalidates a premise or opens a frontier
→ authorized owner adopts new revision
→ reverse-reachable downstream recomputes
```

不是 runtime 直接写回 Definition。

## 3. Cross-domain reference law

跨 Domain consumer只能依赖 target Domain 的 public contract/operation/result/ref：

```text
CrossDomainEdge = exact {
  sourceScopeRef,
  targetPublicRef,
  relationKind,
  semantic revision refs,
  authority/disclosure ceiling refs,
  failure/unknown/evolution refs
}
```

禁止：

- 读取 foreign private state/journal/cache/internal module；
- 通过路径、package barrel、callback 或 shared mutable DTO隐藏反向依赖；
- 把多个 Domain 的同名字段合并成一个“shared truth”；
- 用 projection/adapter 获得 target owner authority。

若两个 Domain 必须共享一个真正不可分 meaning，将该 meaning 提升到唯一更低/上游 ResponsibilityScope；两侧只引用它，而不是复制 type 或建立 `common` owner。

## 4. 一个 semantic graph，多种 purpose slice

系统不存在分别手写的“总架构”“领域架构”“Agent架构”“测试架构”真值。所有视图都来自同一 identity/relation generation：

```text
ArchitectureSlice = compile(
  root scope/subject refs,
  purpose relation policy,
  exact semantic shards,
  disclosure ceiling,
  bounded unknown frontier
)
```

局部 consumer只看到改变其决策的最小完整 closure；whole-system audit递归展开同一图。Presentation budget可以折叠细节，不能删除 blocker/unknown/required edge 后仍称 complete。

## 5. Target / Current / Reconciliation 分离

```text
TargetDesignGeneration
CurrentObservationGeneration
ReconciliationGeneration(targetRef, currentRef)
```

三者不同 identity：

- Target不能从 current path/sunk cost反推应该设计什么；
- Current observation不能按 target期望删掉“多余”现实；
- Reconciliation只建立 preserves/drifts/required-unmaterialized/surplus/unknown relations，不能回写任一输入。

因此设计可以领先于实现，但必须明确 target/current gap；当前代码存在也不能提升设计成熟度。

## 6. Unknown / open world

未知不是“模型不完美所以全仓重算”的理由。每个 unknown必须绑定：

```text
subject/frontier ref
+ affected relation closure
+ closure predicate
+ observation/decision owner
```

新信息 x 到来时：

```text
x
→ close/replace its typed frontier
→ invalidate reverseReachable(x)
→ preserve unrelated SubjectRefs / ActionKeys / projections
```

只有 x 证明现有 root algebra 无法表达新的独立 admission/authority/lifecycle/failure semantics，才演进 root model。

## 7. 新实例不改 root architecture

新语言、Provider、runtime、database、OS、filesystem、cloud、Agent model默认只产生：

```text
new Subject/Observation
+ Requirement/Provision/Binding
+ Target/Profile facts
+ optional new ResourceDimension instance
+ owner-issued Claims/Evidence
```

不得给 System Architecture 加品牌分支。只有真正新的 semantic relation/state/authority/resource algebra才修改对应 child owner，并通过 migration 保留旧 expressible subset。

## 8. Architecture completion

```text
ArchitectureClosed =
  recursive scope/boundary proofs closed or bounded frontier explicit
  and every cross-domain edge terminates at public contract/ref
  and every Operation/Authority/Resource relation resolves to its sole owner
  and computation identity uses exact reachable inputs
  and lifecycle/provenance/evidence/evolution chains are non-amplifying
  and target/current/reconciliation are disjoint generations
  and new instances extend bindings rather than root switches
```

`ArchitectureClosed` 只证明一个设计 generation；不证明 implementation 已迁移、Effect已执行、Verification通过或产品已发布。

<!-- sec-clause {"id":"system-architecture-root","blocker":null,"kind":"stable-decision"} -->
## 规范片段

System Architecture root只拥有layering与cross-domain public-reference laws；Scope/Domain、Operation、Authority Roots、Resource Accounting、Derivation Locality、Lifecycle/Proof/Evolution分别由独立owner维护。Target/Current/Reconciliation分代，unknown绑定局部affected closure；新增语言/Provider/运行环境只增加typed facts/bindings并局部失效，不修改root品牌switch。
