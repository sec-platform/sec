---
title: Engineering IR 与语义事实规范
status: active
last-reviewed: 2026-07-11
---

# Engineering IR 与语义事实规范

本文是 SEC Engineering IR、Semantic Entity、Semantic Fact、Fact Assertion、Fact Provenance、Revision 和 Fact Delta 的实现级权威。

## 1. 定位

Engineering IR 是 SEC 的 canonical semantic representation。

它不是：

- LLVM IR 的复制。
- AST。
- 文件依赖图。
- Call Graph。
- ExplainGraph。
- Workbench View Model。
- AI Knowledge Graph。

IR 表达平台接受的工程实体、工程事实，以及不同来源对事实的独立声明。Fact 负责 triple identity；Assertion 负责 authority、confidence、provenance、evidence 与 semantic revision validity。

## 2. 数学模型

IR 是 **Directed Typed Property Multigraph** 的工程实现。

使用 Multigraph，因为同一对 Entity 之间可以同时存在多个独立 Predicate：

```text
TicketQuery DEPENDS_ON TenantContext
TicketQuery REQUIRES TenantContext
TicketQuery READS TenantContext
```

IR 不是 DAG。State Loop、Retry、Recursive Dependency Evidence、Workflow Cycle 都可能形成环。具体 Pass 可以对某种 Predicate 子图要求 acyclic，但不能把整个 IR 定义为 DAG。

同一个规范化 triple 在 canonical IR 中只有一个 `SemanticFact`。多个来源声明同一 triple 时，不复制 Fact，也不把来源元数据熔成一个“最强 Fact”；它们作为独立 `FactAssertion` 嵌套在该 Fact 下。

## 3. 顶层结构 v2

```ts
interface EngineeringIR {
  formatVersion: '2';
  graphId: string;
  inputRevision: string;
  semanticRevision: string;
  appId: SemanticEntityId;
  entities: SemanticEntity[];
  facts: SemanticFact[];
  scenarios: ScenarioDefinition[];
}
```

`inputRevision` 标识规范化声明输入域；`semanticRevision` 标识最终 canonical semantic graph。v2 不存在兼容性的 root `revision` 字段，也不得把二者重新折叠为单一 revision。

`scenarios` 是 canonical IR 的组成部分，不另建第二事实容器。

Fact Assertion 也不建立 root-level `assertions[]`。Canonical ownership 是：

```text
EngineeringIR
  └─ facts[]
       └─ assertions[]
```

禁止同时维护 `fact.assertionIds + root.assertions[]` 两套 canonical 索引。

## 4. Semantic Entity

```ts
interface SemanticEntity {
  id: SemanticEntityId;
  kind: SemanticEntityKind;
  label: string;
  attributes: SemanticAttribute[];
}
```

当前 Kernel kind：

```text
app
block
capability
port
slot
entity
field
responsibility
operation
scenario
state
event
policy
permission
effect
boundary
generator
artifact
acceptance
```

当前 Builder 已真实产生：

```text
app
block
capability
port
slot
entity
field
responsibility
operation
scenario
state
event
policy
permission
effect
artifact
acceptance
```

`boundary`、`generator` 仍为类型层预留，必须通过真实 Contract/Builder 才能进入 IR；不允许仅为了 UI Demo 制造伪节点。

### Entity ID

ID 必须稳定、确定性、与 label 分离。

推荐：

```text
app:<app-id>
block:<block-id>
capability:<capability-id>
port:<block-id>:input:<port-id>
slot:<block-id>:<slot-id>
entity:<namespace>:<entity-id>
operation:<namespace>:<operation-id>
responsibility:<namespace>:<id>
artifact:<workspace-relative-path>
acceptance:<acceptance-id>
policy:<policy-id>
```

禁止：

- 随机 UUID 作为可重建 canonical entity identity。
- 使用数组位置。
- 使用 UI 坐标。
- 仅使用显示 label。

## 5. Semantic Fact 与 Fact Assertion

### Semantic Fact

```ts
interface SemanticFact {
  id: SemanticFactId;
  subject: SemanticEntityId;
  predicate: SemanticPredicate;
  object: SemanticFactObject;
  assertions: FactAssertion[];
}
```

Fact 只定义一个规范化 triple 的 canonical identity：

```text
subject --predicate--> object
```

Fact 不直接拥有 `authority`、`confidence`、`provenance`、`evidence` 或 validity 字段。

### Fact Assertion

```ts
interface FactAssertion {
  id: FactAssertionId;
  authority: SemanticAuthority;
  confidence: number;
  provenance: FactProvenance[];
  evidence: EvidenceReference[];
  validFromRevision: string;
  validToRevision?: string;
}
```

Assertion 表示“某来源以某 authority 对这个 exact triple 作出声明”。

例如：

```text
Fact:
TicketService OWNS TicketState

Assertions:
1. Contract authoritative claim
2. AI inferred claim
```

结果必须是：

```text
facts.length = 1
fact.assertions.length = 2
```

禁止把它压缩为一个 authoritative Fact 后混合 Contract 与 AI provenance。

### Fact Object

```ts
type SemanticFactObject =
  | { kind: 'entity'; entityId: SemanticEntityId }
  | { kind: 'value'; value: SemanticValue };
```

不要把 primitive/entity 混成单一字符串，否则无法稳定校验引用完整性。

### Fact ID

Fact ID 只从规范化的：

```text
subject + predicate + normalized object
```

确定性派生。

Authority、confidence、provenance、evidence 和 assertion 数量均不得进入 Fact identity。

因此同一 triple 的 authoritative 与 inferred 声明必须得到同一个 Fact ID。

### Assertion ID

Assertion ID 从：

```text
factId
+ authority
+ normalized provenance identity
```

确定性 digest 派生。

禁止随机 UUID。

规则：

- provenance 顺序差异经过 normalization 后不得产生不同 Assertion ID。
- same triple + same normalized assertion identity：幂等去重。
- same triple + distinct provenance identity：同一 Fact 下保留多个 Assertions。
- same triple + distinct authority：同一 Fact 下保留多个 Assertions。
- evidence 不参与 Assertion ID；同一 assertion identity 的 evidence 可稳定去重合并。
- 同一 assertion identity 出现不同 confidence：hard fail，不静默取最大值或最后值。

## 6. Predicate 分类

Predicate 使用大写 snake case。当前类型集合按职责分组。

### Structure / Responsibility

```text
CONTAINS
DECLARES
IMPLEMENTS
DEPENDS_ON
PROVIDES
ASSUMES
REQUIRES
GUARANTEES
```

### Port / Execution

```text
CONNECTS_TO
INVOKES
PRECEDES
AWAITS
FORKS_TO
JOINS
RETRIES
HANDLES
EMITS
CONSUMES
```

### Data

```text
FLOWS_TO
DERIVES_FROM
TRANSFORMS_TO
VALIDATES
SANITIZES
SERIALIZES_AS
DESERIALIZES_FROM
PERSISTS_AS
```

### State / Lifecycle

```text
OWNS
READS
WRITES
MUTATES
INITIALIZES
DISPOSES
ESCAPES
TRANSITIONS_TO
```

### Governance / Effect

```text
PERFORMS_EFFECT
REQUIRES_PERMISSION
CROSSES_BOUNDARY
ENFORCES
VERIFIED_BY
ORIGINATES_FROM
LOWERS_TO
GENERATES
VIOLATES
```

当前 Builder 只实现已有事实需要的子集。**类型允许存在不等于 Builder 必须伪造数据。**

## 7. Authority

Authority 属于 `FactAssertion`，不属于 `SemanticFact`。

```ts
type SemanticAuthority =
  | 'authoritative'
  | 'derived'
  | 'observed'
  | 'inferred';
```

### authoritative

来自开发者/Block Semantic Contract、明确 Policy 或平台受信任声明。

### derived

由确定性 compiler rule 从 authoritative/derived input 推导。

### observed

运行时在特定 `semanticRevision` / 环境中观察到；说明“发生过”，不自动证明所有可能路径。

### inferred

AI、heuristic、外部 provider 或低确定性分析推断。

Authority 是权力层级，不是概率。

```text
inferred confidence=1.0
```

不能覆盖 authoritative assertion，也不能让 authoritative assertion 删除 inferred assertion。两者作为独立 claims 保留，冲突由 predicate-specific validator、source policy 和 diagnostic 处理。

### Assertion Summary

Projection 需要聚合展示时统一调用：

```ts
summarizeFactAssertions(fact)
```

返回：

```ts
{
  highestAuthority,
  authorities,
  hasConflict,
  hasInferred,
  assertionCount
}
```

这是只读 summary，不是新的 canonical fact shape，也不得回写 IR。

当前一个 Fact 内的 Assertions 都声明同一个 exact triple，因此 fact-local `hasConflict` 为 `false`。Predicate-specific contradiction 通常存在于不同 Fact 之间，需要 graph-context validator 才能判定；Projection 不得凭 authority 混合自行制造 conflict 结论。

## 8. Confidence

`confidence` 属于 `FactAssertion`，范围 `[0, 1]`。

规则：

- authoritative/derived 默认 1；若推导本身可能不完备，不应伪装为 derived，应使用 inferred。
- observed 表示 observation completeness/association certainty，不表示全路径真实性。
- inferred 表示推断可信度。
- 冲突解决首先看 authority、source policy 与 evidence；不能简单取最高 confidence。
- inferred confidence=1 不能覆盖 authoritative assertion。
- 同一 assertion identity 的 confidence 不一致说明输入对同一 claim 自相矛盾，当前 Builder hard fail，不静默 strongest-wins。

## 9. Fact Provenance

Provenance 属于 `FactAssertion`。

```ts
interface FactProvenance {
  kind:
    | 'contract'
    | 'compiler'
    | 'static-analysis'
    | 'runtime'
    | 'ai'
    | 'user'
    | 'external-provider';
  sourceId: string;
  sourcePath?: string;
  revision?: string;
}
```

每个 Fact Assertion 必须至少有一条 provenance。Fact 本身不维护 provenance 汇总。

示例：

```text
TicketQuery REQUIRES TenantContext

Assertion:
authority: authoritative
provenance:
  contract ticket/basic/contracts/ticket.yaml
```

```text
normalizeCustomerInput TRANSFORMS_TO NormalizedCustomerInput

Assertion:
authority: derived
provenance:
  static-analysis TypeChecker signature
```

```text
TicketService role Ticket orchestration

Assertion:
authority: inferred
provenance:
  ai semantic-cluster-v1
confidence: 0.87
```

## 10. Evidence Reference

Evidence 属于 `FactAssertion`。它是可回看引用，不把 Raw Payload 全塞进 IR：

```ts
interface EvidenceReference {
  kind: string;
  ref: string;
  digest?: string;
}
```

例如：

```text
contract:ticket/basic/contracts/ticket.yaml#operations.create
source:source/code/server/ticket.ts#L20-L48
runtime:trace/<trace-id>/<span-id>
tool:gitnexus/<query-id>
verification:acceptance/ticket_can_be_created
```

Projection 可以汇总多个 Assertions 的 evidence refs 用于展示，但不得把该汇总写回 Fact。

## 11. Revision

IR 是版本化事实集。

v2 明确分离两个 revision domain：

- `inputRevision`：由 `app.id/name`、resolved blocks、manifest declarations、semantic contracts、slot tasks、acceptance ids 与纯 `policyDeclarations` 的规范化 payload 计算。Artifact Provenance、ExplainGraph 和已物化的 PolicyReport 不属于声明输入，禁止反馈进入该 domain。
- `semanticRevision`：由 `formatVersion`、`graphId`、`appId` 与最终规范化的 entities/facts/scenarios 计算，表示 canonical semantic graph identity。

规范化规则必须按字段语义区分 **集合** 与 **序列**：无序集合在各自 normalization boundary 去重并稳定排序；有序序列保留顺序与重复项；通用 IR Attribute 层不得假设“数组就是集合”。Entity、Fact 与 Fact 内 Assertions 使用确定性 identity 和稳定排序。

Assertion validity 不能参与产生其自身 `validFromRevision` 的 revision digest，否则形成自引用。

因此 `semanticRevisionPayload` 对 canonical graph 唯一执行的字段级排除是 nested validity self-reference：

```text
assertion.validFromRevision
assertion.validToRevision
```

Builder 先计算最终 `semanticRevision`，再把每个 Assertion 的 `validFromRevision` 精确绑定到该值。`validFromRevision` / `validToRevision` 的运行时变化不得改变 `semanticRevision`，也不属于 `inputRevision` domain；Assertion 的 identity、authority、confidence、provenance 或 evidence 变化仍会改变 `semanticRevision`。

Runtime Observation 绑定所观察的 `semanticRevision`。

## 12. Builder v2

`buildEngineeringIR(input)` 当前输入对象：

```ts
interface BuildEngineeringIRInput {
  app: { id: string; name: string };
  resolvedBlocks: ResolvedBlock[];
  manifests: EngineeringIRManifestInput[];
  slotTasks: SlotTask[];
  acceptanceIds: string[];
  policyDeclarations: PolicyRule[];
  semanticContracts?: LoadedSemanticContract[];
}
```

Builder 当前产生：

- App Entity。
- Block Entity。
- Capability Entity + `DEPENDS_ON/PROVIDES` Fact。
- Port Entity + `REQUIRES/PROVIDES` Fact。
- Slot Entity + `CONTAINS` Fact。
- Semantic Contract 的 Entity/Field/Responsibility/Operation/State/Event/Policy/Permission/Effect/Scenario Entity。
- Contract authoritative `DECLARES/IMPLEMENTS/OWNS/READS/WRITES/MUTATES/REQUIRES/REQUIRES_PERMISSION/PERFORMS_EFFECT/EMITS/INVOKES/AWAITS/TRANSITIONS_TO/VERIFIED_BY` 等 Fact Assertions。
- canonical `ScenarioDefinition`。
- Acceptance Entity。
- Policy Entity。

Builder 不读取 Artifact Provenance、ExplainGraph 或 PolicyReport；policy input 来自纯 declaration loader。它们不得作为 canonical IR 或 revision 的下游反馈。

Builder 必须：

- 纯函数。
- 不读写文件。
- 去重。
- 稳定排序。
- 校验 Entity 引用。
- 每个 Fact 至少保留一个 Assertion。
- 校验每个 Assertion 的 provenance 与 confidence。
- 产生稳定 Fact ID 和 Assertion ID。
- 同 triple 聚合到同一个 Fact。
- distinct Assertion 不丢失。
- 不执行 authority strongest-wins merge。
- 保持字段自己的集合/序列语义，不在通用 Attribute 层篡改数组。
- 在 Workspace Semantic Linker 未实现前禁止 distinct Contract 隐式共享 namespace。

### Semantic Namespace Ownership

当前没有 Workspace Semantic Linker、Contract import 或 qualified external reference。因此 namespace 只是单个 Loaded Contract 的 canonical identity scope，不是隐式跨 Contract merge channel。

规则：

- exact duplicate Loaded Contract input 允许幂等去重。
- distinct Contract identity/content 共享 namespace：`IR-IDENTITY-006` hard fail。
- 在 Semantic Linker 正式实现前，不允许通过复用 namespace 达成跨 Contract Responsibility/Operation/Entity linkage。
- 未来 Linker 必须显式定义 import、qualified reference、ownership、冲突与版本规则；不得删除 hard fail 后直接恢复隐式合并。

## 13. IR Index

`indexEngineeringIR(ir)` 返回只读索引：

```text
entityById
entitiesByKind
factById
factsByPredicate
outgoingFactsBySubject
incomingFactsByEntityObject
```

Index 是内存派生对象，不持久化为第二份 canonical artifact。

当前不建立独立 assertion index。查询 Fact 后直接读取 `fact.assertions`，避免 `fact.assertionIds + root.assertions[]` 或第二份 assertion store 的一致性负担。只有出现有证据的跨 Fact assertion 查询性能需求时，才允许增加派生 read-only index；该 index 也不得成为 canonical ownership。

## 14. Conflict

当前冲突处理：

- 同 Entity ID 不同定义：`IR-IDENTITY-001` hard fail。
- unresolved Block Manifest：`IR-IDENTITY-002` hard fail。
- Slot 引用未知 Block：`IR-IDENTITY-003` hard fail。
- 同 Scenario ID 不同定义：`IR-IDENTITY-004` hard fail。
- Semantic Contract 引用 unresolved Block：`IR-IDENTITY-005` hard fail。
- distinct Semantic Contract 共享 namespace：`IR-IDENTITY-006` hard fail。
- 同 Fact ID 对应不同 triple：`IR-FACT-001` hard fail。
- Fact entity object 引用不存在：hard fail。
- Fact 没有 Assertion：`IR-AUTHORITY-004` hard fail。
- Assertion confidence 超出 `[0, 1]`：`IR-AUTHORITY-001` hard fail。
- Assertion provenance 为空：`IR-AUTHORITY-002` hard fail。
- 同 Assertion identity 出现不一致 identity metadata 或 confidence：`IR-AUTHORITY-003` hard fail。
- authoritative assertions 语义互斥：需要 predicate-specific validator；未实现 validator 前输出 explicit diagnostic，不能偷偷选一个。
- inferred 与 authoritative 对同一 triple 的正向声明：两个 Assertions 都保留；inferred 不覆盖 authoritative，authoritative 也不删除 inferred evidence trail。

## 15. Fact Delta

v0.4 目标：

```ts
interface FactDelta {
  fromRevision: string;
  toRevision: string;
  added: SemanticFact[];
  removed: SemanticFact[];
  changed: SemanticFactChange[];
}
```

由于 Fact ID 由 subject/predicate/object 派生，Object 改变通常表现为 remove + add。

`changed` 主要承载 identity-preserving assertion set 变化，例如 Assertion add/remove、evidence 变化或 validity 变化。实现时必须明确 canonical diff 规则，不使用模糊 deep-diff。

Authority 改变不是“Fact authority changed”；它通常表现为旧 Assertion 与新 Assertion 的集合变化，因为 authority 属于 Assertion identity。

## 16. Projection

Projection API 接受 IR/selected evidence，返回 View/Explain contract。

Projection 可以：

- 选择 Fact。
- 读取 Fact Assertions。
- 使用 `summarizeFactAssertions` 生成只读 authority summary。
- 聚合多个 Entity 为显示节点。
- 隐藏低价值细节。
- 重新标注 label/badge。
- 添加 Evidence Overlay。

Projection 不可以：

- 创造 authoritative Fact/Assertion。
- 回写 IR。
- 把 assertion summary 熔回 Fact。
- 根据 UI state 改变 semantic identity。

`inferred` badge 必须依据 Assertion summary 的 `hasInferred`，禁止再写 `fact.authority === 'inferred'`。

Provenance Overlay 可以选择 `highestAuthority` 作为展示摘要，并在该 authority 的 Assertions 中计算展示 confidence；这不表示低 authority Assertions 被删除或覆盖。

## 17. 持久化策略

当前 v2 Kernel 先以内存 IR 为主；不要立即新增 stable `engineering-ir.json` artifact。

满足以下条件后再稳定持久化：

1. Ticket semantic vertical 闭环。
2. 三种 Projection 共用 IR。
3. input/semantic revision digest 稳定。
4. CLI inspect 可用。
5. contract freeze 和 migration policy 完成。

届时建议路径：

```text
control/semantic/engineering-ir.json
```

在此之前，IR 类型/Builder 是 canonical calculation，现有 stable artifact 列表不增加路径。

## 18. v2 Kernel 完成条件

- TypeScript 类型落地。
- Builder 归一当前 App/Block/Capability/Port/Slot/Acceptance/Policy declaration 与 Loaded Semantic Contract。
- Stable Entity/Fact/Assertion ID。
- Fact identity 与 Assertion claim metadata 分离。
- Authority/Confidence/Provenance/Evidence 位于 Assertion。
- Same triple 的 distinct Assertions 无损保留。
- Referential integrity。
- Stable sort/inputRevision/semanticRevision digest。
- Read-only Index。
- Unit tests。
- Compiler facade 导出。
- ExplainGraph 行为保持兼容。
