---
title: AI Runtime、任务信封与治理规范
status: active
last-reviewed: 2026-07-04
---

# AI Runtime、Task Envelope 与治理规范

本文定义产品内 AI 的角色、权限、Context Packet、Task Envelope 和审计边界。

## 1. 权力关系

平台是 authority，AI 是 bounded operator。

```text
Platform owns canonical state and policy
  → selects task
  → projects context
  → grants bounded operations
  → AI proposes result
  → platform validates
  → compiler rebuilds canonical state
  → verification accepts or rejects
```

AI 不能：

- 直接修改 Engineering IR。
- 直接修改 `control/**` 治理产物。
- 根据 provider related files 扩大 allowed paths。
- 自行取消 must-preserve contract。
- 把自身推断写成 authoritative fact。
- 默认整仓搜索和整仓重写。

## 2. 当前已实现能力

当前真实 Task Envelope 主要服务 Slot Synthesis：

- task kind 来自 Slot kind。
- phase 当前是 adapt。
- target block/file。
- allowed paths。
- required symbols。
- forbidden operations。
- input/output type。
- tests to pass。
- budget。
- expected TypeScript source file。

这是 Bounded Code Filler，不应在文档中描述为完整 Semantic Operator。

## 3. Task Envelope v2 目标

```ts
interface TaskEnvelopeV2 {
  taskId: string;
  taskKind: TaskKind;
  phase: CompilationPhase;
  targets: SemanticTarget[];
  allowedOperations: SemanticOperationKind[];
  allowedPaths: string[];
  forbiddenEffects: EffectKind[];
  requiredFacts: FactId[];
  mustPreserve: FactId[];
  verificationPlan: VerificationSelector[];
  budget: TaskBudget;
  expectedOutput: ExpectedTaskOutput;
}
```

计划 task kind：

```text
slot-synthesis
semantic-alignment
contract-edit
repair
migration
review
```

计划输出：

```text
source-patch
semantic-mutation
repair-proposal
review-decision
```

字段只有在 TypeScript 类型、builder、validator 和 contract test 落地后才成为正式协议。

## 4. Context Packet

Context Packet 是 Task 的只读投影，不是新事实源。

目标结构：

```text
task
writeBounds
semanticContext
affectedFacts
blocks/ports/policies
writableAnchors
readonlyAnchors
mustPreserve
verification
provenance
runtimeEvidence
```

上下文装载顺序：

1. Task Envelope。
2. Target Entity/Fact/Scenario projection。
3. 相关 Block/Contract/Policy。
4. Verification/Provenance/Impact。
5. 必要类型签名和测试。
6. 必要源码骨架。

只有结构化 Context 不足时才下钻源码。源码范围从 target、required symbols、verification selector 和 impact boundary 推导。

## 5. Authority 与 Confidence

AI 输出的语义判断默认：

```text
authority = inferred
```

即使 `confidence = 1.0`，也不能覆盖 authoritative Contract。

当 AI 发现冲突：

```text
inferred fact conflicts authoritative fact
  → diagnostic
  → evidence attached
  → request explicit contract mutation or human decision
```

不允许静默“修正”平台事实。

## 6. Semantic Operation

AI 不执行 `setFact()`。

AI 提交 Semantic Mutation，例如：

```yaml
kind: add-state-transition
target: state:ticket-status
from: OPEN
to: IN_PROGRESS
preconditions:
  - fact: ticket-status-owned-by-state-machine
mustPreserve:
  - fact: closed-ticket-cannot-reopen
expectedFactDelta:
  add:
    - Ticket.status ALLOWS_TRANSITION OPEN->IN_PROGRESS
```

平台处理：

```text
validate envelope
→ validate mutation schema
→ check preconditions and authority
→ write authoring source through mutation adapter
→ rebuild IR
→ compare actual Fact Delta
→ run selected verification
→ accept / rollback / reject
```

## 7. 物理与语义权限

权限是交集，不是并集：

```text
allowedPaths
∩ allowedOperations
∩ phase
∩ task kind
∩ semantic target
∩ artifact ownership
∩ policy
∩ must-preserve facts
```

Context Packet 和 Evidence 永远不能扩大权限。

## 8. Runtime Evidence

Graph-It-Live、GitNexus、Graphify、trace、IDE graph 等结果归一成 provider-neutral Evidence。

用途：

- code context。
- impact hint。
- review risk。
- navigation hint。

Evidence 必须包含 provider/source、时间或 revision 线索、confidence 和 diagnostics。Stale/partial provider 不能阻塞 compiler canonical pass，除非某个显式 verification contract 要求该 provider。

## 9. Budget 与失败

Task Budget 至少控制：

- max attempts。
- timeout。
- token budget。
- 可选 tool/IO budget。

失败后：

- 不自动扩大 allowed paths。
- 不自动移除 forbidden effect。
- 不自动降低 must-preserve。
- 不自动从单文件升级为整仓任务。

需要扩权时生成新的 Task/Decision，由平台或人类明确批准。

## 10. 审计

每次 AI Task 至少记录：

- task/revision/model identity。
- context digest。
- allowed operations/paths。
- proposed output digest。
- actual source/Fact delta。
- tests/verification。
- result/rejection reason。

审计记录属于治理 Evidence；模型的自然语言 chain-of-thought 不属于平台所需审计合同。
