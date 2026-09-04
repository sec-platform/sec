---
title: Mutation Planning、Overlay 与 Execution Admission
status: stable
domain: semantic-mutation
---

# Mutation Planning、Overlay 与 Execution Admission

本文拥有 Semantic Mutation 的 pure plan identity、planning observation、workspace overlay writeback、live execution admission 与 planning computation Effect 分型。事务 publication/journal/recovery 仍由 `docs/semantic-mutation.md` 拥有。

## 1. 四个对象必须分型

```text
MutationIntent
→ PureMutationPlan
→ AdmittedMutationExecution
→ MutationObservation/Terminal
```

```text
PureMutationPlan = exact {
  operationDefinitionRef,
  normalizedIntent,
  exact semantic/source observation refs,
  targetAndOwnerRequirementRefs,
  expectedDeltaAndPreservationRefs,
  verificationClaimRefs,
  resourceRequirementRefs,
  transform/compiler contract refs,
  unknownFrontier,
  planDigest
}
```

Pure plan**不包含** live EffectGrant、credential、Provider handle/generation、Allocation、deadline epoch、writer lease、temp path 或 execution preimage。它描述“在这些 immutable observations 下应做什么”。

```text
AdmittedMutationExecution = exact {
  pureMutationPlanRef,
  liveEffectGrantRef,
  eligibleProviderBindingRefs,
  resourceAllocationRef,
  exactWritableSourcePreimageRef,
  absoluteDeadlineRef,
  operation/attempt epoch,
  admissionDigest
}
```

Grant、Provider、Allocation 或 preimage变化只使 admission stale；如果 Pure Plan 的 semantic inputs 未变，不得重算另一份 plan。

## 2. Planning 读取权限与 Effect 权限分离

受保护源码可能需要 read authority 才能进入 planning observation，但这不是 mutation EffectGrant：

```text
PlanningObservationAdmission =
  requested observation scope
  ∩ read authority
  ∩ provider capability
  ∩ resource allocation
```

它只签发 `ObservationResult/SourceObservationGeneration`，不能授权写入。EffectGrant 只在执行前由 issuer 针对 exact plan/preimage签发。

## 3. Zero-Effect Pure Plan 的精确定义

```text
Effects(PureMutationPlanCompiler) = empty
```

Pure compiler只能消费已存在 immutable observations/receipts，使用内存中的 deterministic transform 或无 Effect 的 pure library。

如果 transform/typecheck 需要真实 filesystem、process、container、native helper 或 temp directory，则这不是 Pure Plan 内部“例外”，而是独立 execution：

```text
PlanningComputationRequirement
→ admitted bounded computation
→ PlanningComputationReceipt
→ PureMutationPlan consumes immutable receipt
```

该 computation 可以被声明为 candidate-only、zero-authoritative-write，但仍必须拥有 Provider、Allocation、settlement、cleanup/readback。它不能把 operation-owned temp root伪装成 `Effects(plan)=empty`。

## 4. Workspace overlay 与 writable layer

Source Observation 可以合成：

```text
base/index/worktree/untracked/editor/generated overlays
→ WorkspaceContentView
```

但 mutation 必须显式绑定最终 writable carrier：

```text
WritableSourceLayerBinding = exact {
  workspaceContentViewRef,
  effectiveObservedLayerRef,
  writableLayerRef,
  semanticSourceRef,
  physicalOrEditorProviderBindingRef,
  exactPreimageRef,
  reconciliationPolicyRef
}
```

### 允许

- effective layer与 writable layer相同且 preimage exact；
- editor buffer由有权 editor Provider原子写回；
- unsaved editor content先通过明确 save/reconciliation operation发布，然后重新观察并生成新 plan。

### 拒绝

```text
observed effective bytes = unsaved editor B
but admitted writer = disk A
```

若没有 owner-issued reconciliation，返回 `writable-layer-diverged`，不得直接按 B 的语义计划覆盖 A，也不得悄悄使 editor buffer stale。

## 5. Plan 与 admission 的 staleness 分离

| 变化 | Pure Plan | Admission |
| --- | --- | --- |
| intent/semantic source/target contract | stale | stale |
| owner requirement meaning | stale | stale |
| expected Delta/Claim semantics | stale | stale |
| live credential refresh | reusable | stale |
| Provider instance replacement但合同等价 | reusable | stale/rebind |
| allocation/deadline | reusable | stale |
| physical preimage drift | reusable until observation meaning changes | stale/reobserve |
| unrelated workspace change | reusable | reusable unless resource/preimage conflict |

这使高频 live facts 不污染低频 semantic planning identity。

## 6. Apply-time revalidation

执行前：

```text
reobserve writable source/owner/policy/provider
→ verify PureMutationPlan still semantically applicable
→ bind live Grant/Provider/Allocation/Preimage
→ issue AdmittedMutationExecution
→ prepared intent
→ Effect
```

若新 observation改变 plan semantic inputs，则重新编译 plan；若只改变执行条件，则只重新 admission。

## 7. 新 Provider / 新编辑器 / 新 Source carrier 的局部扩展

新增 IDE、remote workspace、generated authoring source、database-backed source 等 carrier 时，只需要：

1. Source Observation frontend产生新的 overlay binding；
2. writable carrier提供 `WritableSourceLayerBinding` 与 CAS/readback；
3. existing PureMutationPlan继续引用 semantic source/observation contract；
4. 只失效依赖新 carrier 的 admission/physical closure。

不得修改 Mutation core 加 `if editor == ...`、`if remote == ...`。

## 8. 完成

```text
MutationPlanningAdmissionClosed =
  pure plan excludes live execution authority/capability/allocation
  and any effectful planning computation is a separate admitted operation
  and effective observed layer is reconciled with the writable layer
  and apply-time live drift only invalidates the minimum necessary layer
  and new carriers/providers extend typed bindings rather than core switches
```

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

PureMutationPlan只绑定immutable semantic/source observations、requirements、expected Delta/Claims与transform contract；live Grant、Provider、Allocation、deadline和physical preimage只进入AdmittedMutationExecution。需要filesystem/process/temp-root的规划计算必须作为独立Effect operation产生receipt；overlay observation与最终writable layer不一致时先reconcile或block。
