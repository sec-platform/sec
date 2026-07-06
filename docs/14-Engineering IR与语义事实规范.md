---
title: Engineering IR 与语义事实规范
status: active
last-reviewed: 2026-07-06
---

# Engineering IR 与语义事实规范

本文是 SEC Engineering IR、Semantic Entity、Semantic Fact、Fact Provenance、Revision 和 Fact Delta 的实现级权威。

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

IR 表达被平台接受的工程实体和工程事实，并保留事实 authority/provenance/evidence。

## 2. 数学模型

IR 是 **Directed Typed Property Multigraph** 的工程实现。

使用 Multigraph，因为同一对 Entity 之间可以同时存在多个独立 Predicate：

```text
TicketQuery DEPENDS_ON TenantContext
TicketQuery REQUIRES TenantContext
TicketQuery READS TenantContext
```

IR 不是 DAG。State Loop、Retry、Recursive Dependency Evidence、Workflow Cycle 都可能形成环。具体 Pass 可对某种 Predicate 子图要求 acyclic，但不能把整个 IR 定义为 DAG。

## 3. 顶层结构 v1

第一版正式目标类型：

```ts
interface EngineeringIR {
  formatVersion: '1';
  graphId: string;
  revision: string;
  appId: SemanticEntityId;
  entities: SemanticEntity[];
  facts: SemanticFact[];
  scenarios: ScenarioDefinition[];
}
```

`scenarios` 是 canonical IR 的组成部分，不另建第二事实容器。

## 4. Semantic Entity

```ts
interface SemanticEntity {
  id: SemanticEntityId;
  kind: SemanticEntityKind;
  label: string;
  attributes: SemanticAttribute[];
}
```

v1 Kernel kind：

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

## 5. Semantic Fact

```ts
interface SemanticFact {
  id: SemanticFactId;
  subject: SemanticEntityId;
  predicate: SemanticPredicate;
  object: SemanticFactObject;
  authority: SemanticAuthority;
  confidence: number;
  provenance: FactProvenance[];
  evidence: EvidenceReference[];
  validFrom: string;
  validTo?: string;
}
```

### Fact Object

```ts
type SemanticFactObject =
  | { kind: 'entity'; entityId: SemanticEntityId }
  | { kind: 'value'; value: SemanticValue };
```

不要把 primitive/entity 混成单一字符串，否则无法稳定校验引用完整性。

### Fact ID

Fact ID 从规范化的：

```text
subject + predicate + normalized object
```

确定性派生。

第一版可以使用稳定可读 key；后续可附加 digest，但 digest 不替代 canonical key 语义。

## 6. Predicate 分类

Predicate 使用大写 snake case。v1 类型集合按职责分组：

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

第一版 Builder 只实现已有事实需要的子集。**类型允许存在不等于 Builder 必须伪造数据。**

## 7. Authority

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

运行时在特定 revision/环境中观察到；说明“发生过”，不自动证明所有可能路径。

### inferred

AI、heuristic、外部 provider 或低确定性分析推断。

Authority 是权力层级，不是概率。

```text
inferred confidence=1.0
```

也不能覆盖 conflicting authoritative fact。

## 8. Confidence

`confidence` 范围 `[0, 1]`。

规则：

- authoritative/derived 默认 1；若推导本身可能不完备，不应伪装为 derived，应使用 inferred。
- observed 表示 observation completeness/association certainty，不表示全路径真实性。
- inferred 表示推断可信度。
- 冲突解决首先看 authority，再看 source policy/evidence；不能简单取最高 confidence。

## 9. Fact Provenance

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

Fact 必须至少有一条 provenance。

示例：

```text
TicketQuery REQUIRES TenantContext

authority: authoritative
provenance:
  contract ticket/basic/contracts/ticket.yaml
```

```text
normalizeCustomerInput TRANSFORMS_TO NormalizedCustomerInput

authority: derived
provenance:
  static-analysis TypeChecker signature
```

```text
TicketService role Ticket orchestration

authority: inferred
provenance:
  ai semantic-cluster-v1
confidence: 0.87
```

## 10. Evidence Reference

Evidence 是可回看引用，不把 Raw Payload 全塞进 IR：

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

## 11. Revision

IR 是版本化事实集。

`revision` 表示 canonical semantic revision identity，不使用 `generatedAt`。

第一版 revision 由规范化 entities/facts/scenarios 的 digest 构造。规范化规则必须按字段语义区分 **集合** 与 **序列**：

- 对无序集合语义字段，由字段自己的 normalization boundary 去重并稳定排序；source array order 不进入 revision。
- 对有序序列语义字段，必须保留顺序与重复项；`operation.inputs` 等位置序列的原始顺序属于语义，必须进入 revision。
- 通用 IR Attribute 层不得假设“数组就是集合”，不得全局排序或去重数组。
- 排除时间戳。
- 排除 UI metadata。
- 排除 volatile runtime metric。
- 对 Entity/Fact 稳定排序。

Runtime Observation 绑定所观察的 canonical revision。

## 12. Builder v1

`buildEngineeringIR(input)` 当前输入对象：

```ts
interface BuildEngineeringIRInput {
  app: { name: string };
  resolvedBlocks: ResolvedBlock[];
  manifests: EngineeringIRManifestInput[];
  slotTasks: SlotTask[];
  acceptanceIds: string[];
  policyIds: string[];
  provenanceArtifacts: ProvenanceArtifact[];
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
- Contract authoritative `DECLARES/IMPLEMENTS/OWNS/READS/WRITES/MUTATES/REQUIRES/REQUIRES_PERMISSION/PERFORMS_EFFECT/EMITS/INVOKES/AWAITS/TRANSITIONS_TO/VERIFIED_BY` 等 Fact。
- canonical `ScenarioDefinition`。
- Artifact Entity + `ORIGINATES_FROM` Fact。
- Acceptance Entity。
- Policy Entity。

Builder 必须：

- 纯函数。
- 不读写文件。
- 去重。
- 稳定排序。
- 校验 Entity 引用。
- 产生稳定 Fact ID。
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

## 14. Conflict

v1 冲突处理：

- 同 Entity ID 不同定义：`IR-IDENTITY-001` hard fail。
- unresolved Block Manifest：`IR-IDENTITY-002` hard fail。
- Slot 引用未知 Block：`IR-IDENTITY-003` hard fail。
- 同 Scenario ID 不同定义：`IR-IDENTITY-004` hard fail。
- Semantic Contract 引用 unresolved Block：`IR-IDENTITY-005` hard fail。
- distinct Semantic Contract 共享 namespace：`IR-IDENTITY-006` hard fail。
- 同 Fact ID 内容不同：`IR-FACT-001` hard fail。
- Fact entity object 引用不存在：hard fail。
- authoritative facts 语义互斥：需要 predicate-specific validator；未实现 validator 前输出 explicit diagnostic，不能偷偷选一个。
- inferred vs authoritative conflict：保留 authoritative，记录 conflict evidence/diagnostic。

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

由于 Fact ID 由 subject/predicate/object 派生，Object 改变通常表现为 remove + add；`changed` 主要用于 identity-preserving attributes/authority/evidence changes。实现时必须明确规则，不用模糊 deep-diff。

## 16. Projection

Projection API 接受 IR/selected evidence，返回 View/Explain contract。

Projection 可以：

- 选择 Fact。
- 聚合多个 Entity 为显示节点。
- 隐藏低价值细节。
- 重新标注 label/badge。
- 添加 Evidence Overlay。

Projection 不可以：

- 创造 authoritative Fact。
- 回写 IR。
- 根据 UI state 改变 semantic identity。

## 17. 持久化策略

v1 Kernel 先以内存 IR 为主；不要立即新增 stable `engineering-ir.json` artifact。

原因：类型和 identity 仍在第一条 Ticket Semantic Contract 中验证。

满足以下条件后再稳定持久化：

1. Ticket semantic vertical 闭环。
2. 三种 Projection 共用 IR。
3. revision digest 稳定。
4. CLI inspect 可用。
5. contract freeze 和 migration policy 完成。

届时建议路径：

```text
control/semantic/engineering-ir.json
```

在此之前，IR 类型/Builder 是 canonical calculation，现有 stable artifact 列表不增加路径。

## 18. v1 Kernel 完成条件

- TypeScript 类型落地。
- Builder 归一当前 App/Block/Capability/Port/Slot/Artifact/Acceptance/Policy 与 Loaded Semantic Contract。
- Stable Entity/Fact ID。
- Authority/Provenance/Evidence 字段。
- Referential integrity。
- Stable sort/revision digest。
- Read-only Index。
- Unit tests。
- Compiler facade 导出。
- ExplainGraph 行为保持兼容。
