---
title: Engineering IR 与语义事实规范
status: active
last-reviewed: 2026-07-13
---

# Engineering IR 与语义事实规范

本文是 SEC Engineering IR、Semantic Entity、Semantic Fact、Fact Assertion、Fact Provenance、Revision、Fact Delta、Impact Propagation 和 Semantic Mutation 的实现级权威。

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
  formatVersion: "2";
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

`appId` 是 App Entity 的稳定 identity，来源于 Plan 的 `app.id`。Resolver 必须把它持久化为 `LockFile.app.id`；任何 Lock consumer 都不得从 `app.name` 反推 identity。`app.name` 在 IR、Lock 和 ExplainGraph 中都只承担显示 label，不参与 canonical ID、revision 或图边端点计算。ExplainGraph 的 App 节点必须使用 `app:<lock.app.id>`，并仅把 `lock.app.name` 写入节点 `label`。

`facts` 是 Scenario 执行语义的唯一 canonical ownership。`scenarios` 保留在 IR root 中，但它只能由最终 Entities/Facts 确定性重建，是只读 derived cache；Contract producer、Projector 和其他 consumer 不得把它当成第二声明入口。

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
scenario-step
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
scenario-step
state
event
policy
permission
effect
generator
artifact
acceptance
```

`boundary` 当前只保留类型能力。Generator/Artifact 由 Manifest generator declaration 在 canonical Builder 中引入；Builder 不从下游 Artifact Provenance 反馈创建 Entity，也不允许仅为了 UI Demo 制造伪节点。

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
scenario:<namespace>:<scenario-id>
scenario:<namespace>:<scenario-id>#step:<semantic-step-id>
generator:<block-id>:<generator-id>
artifact:<workspace-relative-path>
acceptance:<acceptance-id>
policy:<policy-id>
```

禁止：

- 随机 UUID 作为可重建 canonical entity identity。
- 使用数组位置。
- 使用 UI 坐标。
- 仅使用显示 label。

因此 App 改名只能改变显示文本，不能改变 `app:<app-id>` 节点 identity、依赖边或 provenance 归属。Plan → Lock → Engineering IR / ExplainGraph 必须连续保留同一个 `app.id`。

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
  | { kind: "entity"; entityId: SemanticEntityId }
  | { kind: "value"; value: SemanticValue };
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

### Predicate Signature Registry

`platform/compiler/ir/predicate-signatures.ts` 是 Predicate shape 的唯一 canonical authority。每个 `SemanticPredicate` 必须在 registry 中恰好拥有一种状态：

- `active`：至少一个明确、互不歧义的 signature variant。
- `reserved`：类型预留但当前没有权威 producer；任何 canonical Fact 使用它都 hard fail。

每个 variant 明确约束：

```text
subject entity kinds
object kind: entity | value
entity object kinds，或 exact value schema
```

当前 active predicates：

```text
AWAITS CONSUMES CONTAINS DECLARES DEPENDS_ON EMITS GENERATES GUARANTEES HANDLES
IMPLEMENTS INVOKES LOWERS_TO MUTATES OWNS PERFORMS_EFFECT PRECEDES PROVIDES
READS REQUIRES REQUIRES_PERMISSION RETRIES TRANSITIONS_TO VERIFIED_BY WRITES
```

当前 reserved predicates：

```text
ASSUMES CONNECTS_TO CROSSES_BOUNDARY DERIVES_FROM
DESERIALIZES_FROM DISPOSES ENFORCES ESCAPES FLOWS_TO FORKS_TO
INITIALIZES JOINS ORIGINATES_FROM PERSISTS_AS
SANITIZES SERIALIZES_AS TRANSFORMS_TO VALIDATES VIOLATES
```

Canonical validation order固定为：

```text
Entity/Fact reference + Assertion validation
→ Predicate Signature validation
→ semanticRevision digest
```

Generator lowering semantics 固定使用以下方向和 shapes：

```text
DECLARES:    block -> generator
CONSUMES:    generator -> state
LOWERS_TO:   state -> artifact
GENERATES:   generator -> artifact
VERIFIED_BY: artifact -> acceptance
VERIFIED_BY: artifact -> value { selector: string }，用于 typecheck 等非 Acceptance selector
```

Artifact ID 的 target 在进入 identity、collision check 与 plan 前统一规范化为 POSIX project-relative path。Manifest assertion 对 `DECLARES/CONSUMES/GENERATES/VERIFIED_BY` 为 authoritative；`LOWERS_TO` 是 compiler 从同一 declaration 推导的 relation。

Builder、Fact store、Projector 与 consumer 不得各自维护另一套 predicate-shape switch。

### Scenario canonical Fact signatures

Scenario execution semantics 固定使用以下方向和 shapes：

```text
CONTAINS:   scenario -> scenario-step
INVOKES:    scenario-step -> operation
PRECEDES:   predecessor scenario-step -> current scenario-step
AWAITS:     scenario-step -> its invoked operation，仅 awaits=true 时存在
RETRIES:    scenario-step -> value { maxAttempts: positive integer }
HANDLES:    handler scenario-step -> failing scenario-step
VERIFIED_BY scenario -> acceptance
INVOKES:    scenario -> entry operation
```

`HANDLES` 的 canonical 方向是 handler → failing。Scenario View 可以为阅读目的显示 failing → handler，但必须引用原始 `HANDLES` Fact，不得创造第二条 authoritative relation。

## 7. Authority

Authority 属于 `FactAssertion`，不属于 `SemanticFact`。

```ts
type SemanticAuthority = "authoritative" | "derived" | "observed" | "inferred";
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
summarizeFactAssertions(fact);
```

返回：

```ts
{
  status,
  authorities,
  hasConflict,
  hasInferred,
  assertionCount,
  confidence: { min, max }
}
```

这是只读 summary，不是新的 canonical fact shape，也不得回写 IR。

`status` 取 `uniform / mixed / inferred / conflict`：多个 authority 必须显示为 `mixed`，只有 inferred 时显示为 `inferred`，predicate-specific validator 确认矛盾后才允许显示 `conflict`。Projection 不输出 target-level `highestAuthority`，也不只从最高 authority assertions 取 confidence。

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
    | "contract"
    | "compiler"
    | "static-analysis"
    | "runtime"
    | "ai"
    | "user"
    | "external-provider";
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

`scenarios` 虽在 semantic payload 中稳定编码，但其全部字段必须由同一 payload 内的 Entities/Facts 重建；它不能接收独立输入。因此这不是第二个 Scenario authority，也不得通过直接修改 cache 来改变 Builder 或 Projection 语义。

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

`EngineeringIRManifestInput.manifest` 包含 `generators?`；generator declaration 的 kind-specific config 进入 `inputRevision`，不得在 snapshot 签发后用另一份未校验 declaration 替换。

Builder 当前产生：

- App Entity。
- Block Entity。
- Capability Entity + `DEPENDS_ON/PROVIDES` Fact。
- Port Entity + `REQUIRES/PROVIDES` Fact。
- Slot Entity + `CONTAINS` Fact。
- Generator/Artifact Entity + `DECLARES/CONSUMES/LOWERS_TO/GENERATES/VERIFIED_BY` Fact。
- Semantic Contract 的 Entity/Field/Responsibility/Operation/State/Event/Policy/Permission/Effect/Scenario/Scenario-step Entity。
- Contract authoritative `DECLARES/IMPLEMENTS/OWNS/READS/WRITES/MUTATES/REQUIRES/REQUIRES_PERMISSION/PERFORMS_EFFECT/EMITS/INVOKES/PRECEDES/AWAITS/RETRIES/HANDLES/TRANSITIONS_TO/VERIFIED_BY` 等 Fact Assertions。
- 由最终 Entities/Facts 重建的 derived `ScenarioDefinition` cache。
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

### Scenario derived cache boundary

Semantic Contract lowering 对每个 step 先建立稳定 `scenario-step` Entity，再只通过 `BuildSink.addFact` 发出执行语义。Step identity 规则：

```text
scenarioStepEntityId(scenarioId, semanticStepId)
= scenarioId#step:semanticStepId
```

禁止使用数组位置、Projector node position 或 UI coordinate。

所有 Entities/Facts 组装完成后，Builder 调用 `deriveScenarioDefinitions()` 生成 cache。不存在 `BuildSink.addScenario` 或可与 Facts 竞争的 Scenario store writer。派生过程必须验证唯一 entry、唯一 step invocation、AWAITS 与 invocation 一致、RETRIES exact schema、PRECEDES/HANDLES containment boundary 以及单一 error handler。

`projectScenarioView()` 只接受 `ValidatedEngineeringIRSnapshot`，并直接查询 canonical `CONTAINS / INVOKES / PRECEDES / AWAITS / RETRIES / HANDLES` Facts。篡改 `ir.scenarios[].steps` 的 raw IR 必须由 validator 拒绝，不能进入 Projection。声明数组重排而关系不变时 IR/revision 稳定；PRECEDES、AWAITS、RETRIES 或 HANDLES 关系变化必须改变 canonical Fact/revision。

### Workspace Semantic Link 与 Namespace Ownership

Semantic Frontend 在 local Contract normalization 与 IR build 之间执行唯一 Workspace Semantic Link phase。Contract import schema：

```yaml
imports:
  - alias: tenant
    namespace: tenant
    contractId: tenant-core
```

跨 Contract 引用使用 `alias::localId`，例如 `tenant::TenantScopeGuard`。Linker 建立 namespace/contract identity registry，按 symbol kind 验证 entity/field、responsibility、operation、policy、permission、effect 与 event，并 canonicalize 为 `namespace::id` 后直接交给现有 IR builder；不产生或持久化第二 authoritative graph。

规则：

- unqualified reference 只解析 owner Contract；不得隐式搜索 imports。
- exact duplicate Loaded Contract input 允许幂等去重。
- distinct Contract identity/content 共享 namespace：`SEMANTIC-LINK-001` hard fail。
- duplicate alias、unresolved import/reference、self import/cross-contract conflict、unknown Verification Policy 分别使用 `SEMANTIC-LINK-002` 至 `SEMANTIC-LINK-006` 稳定 diagnostics。
- Semantic Policy 的 `verifiedBy` 显式引用 Verification Policy ID，生成 `verification policy ENFORCES semantic policy` 与反向 `VERIFIED_BY` Facts；同名字符串不建立 identity mapping。
- Contract/file enumeration 与 import declaration 顺序不改变 linked IR 或 revision。

## 13. Validated IR Boundary

`EngineeringIR` 是 canonical calculation result，但仍是未受信输入。只有以下函数可以签发 validated boundary：

```ts
validateEngineeringIR(ir, sourceInput): ValidatedEngineeringIRSnapshot
buildValidatedEngineeringIR(sourceInput): ValidatedEngineeringIRSnapshot
```

Validator 必须按确定性顺序统一检查：

1. formatVersion、`appId`、`graphId` 与声明输入域一致。
2. Entity / Fact / Assertion / Scenario collection 唯一且 canonical ordering。
3. Entity kind/ID、Fact triple/ID、Assertion authority+provenance/ID 与 validity binding。
4. Referential integrity 与 total Predicate Signature Registry。
5. `ScenarioDefinition` 精确等于 canonical Entities/Facts 的重建结果。
6. `inputRevision` 与 source input domain digest 一致。
7. `semanticRevision` 与 canonical semantic graph digest 一致。

成功结果包含 deep-frozen IR，防止 validation 后原地修改。`ValidatedEngineeringIRSnapshot` 是 branded type；普通 `EngineeringIR` 不能传给 IR-native consumer。Projector、Inspector 与 Projection bundle 统一使用 `indexValidatedEngineeringIR(snapshot)`；`indexEngineeringIR(ir)` 只保留为 Builder/Validator 内部与显式 raw compatibility 工具，不是 Projection 入口。

P0-3 将 validated boundary 接入唯一编译协调器：

```text
compileWorkspace() transaction
  → resolve
  → semantic stage / build-ir pass
  → PipelineSemanticContext { transactionId, inputRevision, semanticRevision, snapshot, generatorPlan, semanticViews }
  → compose / adapt / verify / lock / emit
```

`PipelineSemanticContext.snapshot` 只能来自本 transaction 的 `validateEngineeringIR()` 成功路径。即使 input/semantic revision 未改变，新 transaction 也重新签发自己的 snapshot object；partial compile 从 compose 或更下游开始时会自动加入 semantic stage。`build-ir` failure 通过 Pipeline Kernel 阻塞所有 downstream mutating pass，不保留旧 snapshot 或旧 downstream succeeded state。

P0-5 将 Generator/Lowerer 接到该 boundary：Semantic Frontend 从同批已校验 declarations 与 snapshot 构建 deep-frozen `GeneratorPlan`；plan 查询 State/Transition Facts，不接收 `LoadedSemanticContract`。Compose 要求 `build-ir` 成功，Lowerer 只消费 transaction-owned plan，成功写入后把 Generator Entity、Artifact Entity、semantic revision 与 compilation transaction 绑定到 lock task 和 Artifact Provenance。

P0-6 在同一 semantic stage 从 snapshot 构建 deep-frozen `SemanticViewSet`。新 execution 开始时先删除 Lock 中旧的 lowering tasks 与 semantic views；只有 snapshot、Generator Plan 和 Projection revision 全部一致时才绑定 Pipeline Context 并写回 Lock，因此 build-ir failure 不会向 emit 泄漏上一次成功 projection。

该 transaction binding 必须同时满足 execution truth 与 deterministic reference projection：普通 compile 每次签发新的 UUID；`source=reference` 使用 workspace-local 的 `tx:reference-workspace`，Pipeline Journal 在新执行开始时移除同名旧记录，并在 commit 后把它标为当前 committed transaction。因此 reference Lock/Provenance 指向的仍是实际完成的 compilation transaction，同时相同输入的 refresh 不会因随机 UUID 产生 drift。

P0-6 后不存在仍接受 raw IR 的 Architecture / Scenario / State Projector。ExplainGraph 不再加载 Manifest 重建 capability/port/ownership/effect，而是合并 Lock 中本 transaction 的 `SemanticViewSet`；ReviewSummary 汇总同一 view/fact identity，Workbench 读取 ExplainGraph 内嵌的同一 bundle。`buildWorkspaceEngineeringIR()` 只保留 raw calculation/diagnostic compatibility，不签发 validated snapshot，也不能作为 Projector 输入。

## 14. IR Index

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

## 15. Conflict

当前冲突处理：

- 同 Entity ID 不同定义：`IR-IDENTITY-001` hard fail。
- unresolved Block Manifest：`IR-IDENTITY-002` hard fail。
- Slot 引用未知 Block：`IR-IDENTITY-003` hard fail。
- Semantic Contract 引用 unresolved Block：`IR-IDENTITY-005` hard fail。
- distinct Semantic Contract 共享 namespace：`IR-IDENTITY-006` hard fail。
- 同 Fact ID 对应不同 triple：`IR-FACT-001` hard fail。
- Fact entity object 引用不存在：hard fail。
- Fact 没有 Assertion：`IR-AUTHORITY-004` hard fail。
- Assertion confidence 超出 `[0, 1]`：`IR-AUTHORITY-001` hard fail。
- Assertion provenance 为空：`IR-AUTHORITY-002` hard fail。
- 同 Assertion identity 出现不一致 identity metadata 或 confidence：`IR-AUTHORITY-003` hard fail。
- reserved Predicate 或 Predicate subject/object/value 不符合唯一 registry signature：`IR-PREDICATE-001` 至 `IR-PREDICATE-006` hard fail。
- Scenario entry/invocation/retry/containment/await/handler 派生不满足 canonical Fact model：`IR-SCENARIO-001` 至 `IR-SCENARIO-006` hard fail。
- authoritative assertions 语义互斥：需要 predicate-specific validator；未实现 validator 前输出 explicit diagnostic，不能偷偷选一个。
- inferred 与 authoritative 对同一 triple 的正向声明：两个 Assertions 都保留；inferred 不覆盖 authoritative，authoritative 也不删除 inferred evidence trail。

## 16. Fact Delta

Fact Delta v1 是两个 **transaction-referenced validated endpoints** 之间的纯内存、只读 Fact Set 差量。它只描述 canonical `SemanticFact` / `FactAssertion` 变化，不是完整 semantic graph diff，也不是 Authoring、Impact、Mutation、Lock、Projection 或 artifact authority。

### 16.1 Canonical contract

```ts
type FactDeltaContractVersion = "1";
type FactDeltaScope = "fact-set";
type FactAssertionUpdateField = "confidence" | "evidence";

interface FactDeltaEndpoint {
  readonly transactionId: string;
  readonly inputRevision: string;
  readonly semanticRevision: string;
}

interface FactDeltaEndpointContext extends FactDeltaEndpoint {
  readonly snapshot: ValidatedEngineeringIRSnapshot;
}

interface FactAssertionUpdate {
  readonly assertionId: FactAssertionId;
  readonly changedFields: readonly FactAssertionUpdateField[];
  readonly before: Readonly<Pick<FactAssertion, "confidence" | "evidence">>;
  readonly after: Readonly<Pick<FactAssertion, "confidence" | "evidence">>;
}

interface SemanticFactChange {
  readonly factId: SemanticFactId;
  readonly addedAssertions: readonly FactAssertion[];
  readonly removedAssertions: readonly FactAssertion[];
  readonly updatedAssertions: readonly FactAssertionUpdate[];
}

interface FactDelta {
  readonly contractVersion: FactDeltaContractVersion;
  readonly scope: FactDeltaScope;
  readonly formatVersion: typeof ENGINEERING_IR_FORMAT_VERSION;
  readonly graphId: string;
  readonly appId: SemanticEntityId;
  readonly from: FactDeltaEndpoint;
  readonly to: FactDeltaEndpoint;
  readonly fromFactSetDigest: string;
  readonly toFactSetDigest: string;
  readonly added: readonly SemanticFact[];
  readonly removed: readonly SemanticFact[];
  readonly changed: readonly SemanticFactChange[];
  readonly deltaRevision: string;
}
```

唯一 producer 是 Compiler / IR boundary 的纯函数：

```ts
buildFactDelta(
  from: FactDeltaEndpointContext,
  to: FactDeltaEndpointContext
): FactDelta
```

`FactDeltaEndpointContext` 是最小 execution audit reference，不引入 `GeneratorPlan`、`SemanticViewSet` 或 Pipeline orchestration ownership。`PipelineSemanticContext` 可以向它提供同 transaction 的字段；调用方负责保证 transaction 实际拥有该 context，Fact Delta kernel 只能校验 transaction label 非空及两个 revision 与 snapshot 精确相等，不能从 snapshot 反向证明 transaction ownership。kernel 不接入 Pipeline stage、不读取 Workspace、不写 Lock，也不生成 stable artifact。

`transactionId` 只记录实际 execution / audit binding，不参与 `deltaRevision`；同一 from/to canonical payload 在不同 transaction 中必须得到相同 `deltaRevision`。`inputRevision` 记录各 endpoint 的 authoring-input identity，不参与 Fact 分类。`semanticRevision` 是 endpoint 的 canonical graph identity，禁止用裸 `fromRevision` / `toRevision` 猜测 revision domain。`fromFactSetDigest` / `toFactSetDigest` 是 exact Fact Set audit identity；它们不能替代 `semanticRevision`。

Digest 使用已有 SHA-256 表达形式 `sha256:<lowercase-hex>`。`factSetDigest` 的 canonical payload 固定为：

```text
{
  domain: "engineering-ir-fact-set-v1",
  formatVersion,
  graphId,
  appId,
  facts: canonical Facts with every assertion.validFromRevision / validToRevision omitted
}
```

`deltaRevision` 的 canonical payload 固定为：

```text
{
  domain: "engineering-ir-fact-delta-v1",
  contractVersion,
  scope,
  formatVersion,
  graphId,
  appId,
  from: { semanticRevision },
  to: { semanticRevision },
  fromFactSetDigest,
  toFactSetDigest,
  added / removed / changed canonical payload
}
```

其中 `transactionId`、`inputRevision` 与所有 Assertion validity 字段均不进入 digest；`added` / `removed` 的 digest payload 也移除 validity。数组沿用下述 canonical order，不再按 JSON 文本偶然顺序重排。这样 execution / authoring-input audit 可以保留真实 endpoint metadata，而相同 semantic endpoints 的 delta identity 不因 transaction、non-semantic input 或 `validFromRevision` endpoint binding 漂移。

### 16.2 Preconditions 与 diagnostics

Producer 必须在任何分类前执行：

1. from/to 的 `transactionId`、`inputRevision`、`semanticRevision` 均非空；context 中两个 revision 必须分别精确等于 `snapshot.ir` 对应字段。该检查验证 endpoint revision binding 与 audit label，不声称验证 snapshot 内不存在的 transaction ownership。
2. 两端 snapshot 必须具有相同 `formatVersion`、`graphId` 与 `appId`。跨 format / graph / app 比较 hard fail，不伪装成全量 remove + add。
3. 保持调用方指定的 from → to 方向；不为排序稳定性交换 endpoint，也不推断 revision ancestry。
4. 输入只接受 branded `ValidatedEngineeringIRSnapshot`。不得接收 raw `EngineeringIR`、Lock、Projection、ReviewSummary 或 artifact shape，也不得在 diff 内修复/重新 normalize 输入。
5. 相同 `semanticRevision` 却出现不同 canonical semantic payload 是 digest / validated-boundary invariant violation，hard fail。
6. Fact Delta v1 不支持 `validToRevision`。任一 Assertion 含该字段时 hard fail，直到 validity lifecycle、interval validator 与独立 endpoint/digest authority 被单独冻结。

稳定 diagnostics：

| Code | 含义 |
| --- | --- |
| `FACT-DELTA-001` | endpoint transaction audit label 为空，或 context 与 snapshot revision binding 无效 |
| `FACT-DELTA-002` | formatVersion / graphId / appId lineage 不兼容 |
| `FACT-DELTA-003` | 相同 semanticRevision 对应不同 canonical payload |
| `FACT-DELTA-004` | 相同 Fact ID 对应不同 triple |
| `FACT-DELTA-005` | 相同 Assertion ID 对应不同 authority / provenance identity metadata |
| `FACT-DELTA-006` | v1 遇到 unsupported validity state（`validToRevision`） |
| `FACT-DELTA-007` | 输出集合重叠、重复或非 canonical order |

### 16.3 Canonical classification

输入已由 validated boundary 保证 canonical order。Producer 按 ID 做 deterministic merge-join，不使用 generic JSON deep-diff：

- only-to Fact ID → `added`；only-from Fact ID → `removed`。
- 同 Fact ID 必须具有完全相同的 subject / predicate / normalized object，否则 `FACT-DELTA-004`。
- 由于 Fact ID 由 subject / predicate / object 派生，任何 triple/object 变化都表现为旧 Fact `removed` + 新 Fact `added`，绝不进入 `changed`。
- retained Fact 内 only-to Assertion ID → `addedAssertions`；only-from Assertion ID → `removedAssertions`。
- authority / provenance 属于 Assertion identity；它们变化时表现为 Assertion remove + add。
- 同 Assertion ID 必须具有完全相同的 authority 与 normalized provenance，否则 `FACT-DELTA-005`。
- 同 Assertion ID 只有 `confidence` 或 `evidence` 变化时进入 `updatedAssertions`；`changedFields` 固定按 `confidence` → `evidence` 排序。
- `validFromRevision` 是每个 validated endpoint 的 semantic revision binding。正常 from → to 自动重绑不属于 assertion update，禁止因此把所有 retained Facts 误报为 changed。
- retained Fact 没有 assertion delta 时不输出到 `changed`。同一 Fact ID 只能出现在 `added`、`removed`、`changed` 之一。

输出按 `factId` 排序；内部 Assertion 集合按 `assertionId` 排序；evidence/provenance 沿用既有 normalization。Producer clone 输出并递归 deep-freeze，不修改或复用为可变状态的输入对象。相同输入重复执行必须得到 byte-stable JSON 与相同 `deltaRevision`。

### 16.4 Scope 与后续边界

`scope: "fact-set"` 是强制语义：

- `added/removed/changed` 全空，只能证明两端 Fact Set 相等，不能证明两个 snapshots 相等或“无影响”。Entity-only change 可以导致不同 `semanticRevision` 与空 Fact Delta。
- 不同 `semanticRevision` 也可能得到空 Fact Delta；相同 revision 更不能绕过 endpoint / digest invariant checks。
- Impact Propagation 必须同时读取 delta 与 validated snapshot/index；不得把 empty Fact Delta 当作 no impact，也不得把 transitive impact、unknown/dynamic region 或 verification selection 回写 Delta。
- Semantic Mutation 后续只能 exact-match base `semanticRevision` 与 preconditions，回写 Authoring Source，由 Compiler 重建新的 canonical bundle/context，再计算 actual Fact Delta。Expected delta 是受限 expectation DSL，不是 actual canonical `FactDelta`，不能授权 AI 直接写 IR。
- 现有 Engineering Semantic Diff 仍是 artifact/governance approximation；Lock、Projection、Workbench、ReviewSummary 不得各自实现 comparator 或冒充 canonical Fact Delta producer。
- 本合同不新增 stable `engineering-ir.json` / Fact Delta artifact；持久化仍受第 20 节约束。

Fact Delta v1 的最低 Contract Freeze sentinels 包括：空 delta、Fact add/remove 与方向反转、object change remove+add、Assertion add/remove、confidence/evidence update、authority/provenance remove+add、reordered canonical input stable、validFrom 自动重绑无 churn、`validToRevision` 拒绝、跨 graph/app 拒绝、entity-only change 允许空 Fact arrays、raw IR/Lock/Projection compile-time rejection、canonical ordering、输入不变、输出 deep-frozen 与 deterministic repetition。

## 17. Impact Propagation

Impact Propagation v1 是 `FactDelta` 与其两个 transaction-referenced validated endpoints 上的确定性语义影响闭包。它回答“哪些 canonical Entity 由这次变化直接或传递影响，以及有哪些可推荐的 Verification”，但不修改 Fact Delta，不执行 Verification，也不是 Mutation、Projection、Lock、Workbench 或 artifact authority。

### 17.1 Canonical contract

```ts
type ImpactContractVersion = "1";
type ImpactScope = "fact-delta+validated-graph";
type ImpactBasis = "from" | "to";
type ImpactLevel = "direct" | "transitive";

interface ImpactPropagationInput {
  readonly delta: FactDelta;
  readonly from: FactDeltaEndpointContext;
  readonly to: FactDeltaEndpointContext;
}

type ImpactSeed =
  | {
      readonly id: string;
      readonly kind: "entity-added" | "entity-removed";
      readonly basis: ImpactBasis;
      readonly entityId: SemanticEntityId;
      readonly anchorEntityId: SemanticEntityId;
    }
  | {
      readonly id: string;
      readonly kind: "entity-updated";
      readonly basis: ImpactBasis;
      readonly entityId: SemanticEntityId;
      readonly anchorEntityId: SemanticEntityId;
      readonly changedFields: readonly ("label" | "attributes")[];
    }
  | {
      readonly id: string;
      readonly kind: "fact-added" | "fact-removed";
      readonly basis: ImpactBasis;
      readonly factId: SemanticFactId;
      readonly anchorEntityId: SemanticEntityId;
    }
  | {
      readonly id: string;
      readonly kind: "assertion-added" | "assertion-removed";
      readonly basis: ImpactBasis;
      readonly factId: SemanticFactId;
      readonly assertionId: FactAssertionId;
      readonly anchorEntityId: SemanticEntityId;
    }
  | {
      readonly id: string;
      readonly kind: "assertion-updated";
      readonly basis: ImpactBasis;
      readonly factId: SemanticFactId;
      readonly assertionId: FactAssertionId;
      readonly anchorEntityId: SemanticEntityId;
      readonly changedFields: readonly FactAssertionUpdateField[];
    };

interface ImpactPathStep {
  readonly factId: SemanticFactId;
  readonly predicate: SemanticPredicate;
  readonly ruleVariantId: string;
  readonly direction: "subject-to-object" | "object-to-subject";
  readonly fromEntityId: SemanticEntityId;
  readonly toEntityId: SemanticEntityId;
}

interface ImpactOccurrence {
  readonly basis: ImpactBasis;
  readonly entityId: SemanticEntityId;
  readonly level: ImpactLevel;
  readonly distance: number;
  readonly seedIds: readonly string[];
  readonly canonicalPath: readonly ImpactPathStep[];
}

interface ImpactUncertainty {
  readonly basis: ImpactBasis;
  readonly classification: "unknown" | "dynamic";
  readonly reasonCode:
    | "unregistered-active-predicate"
    | "non-definite-authority"
    | "value-object-boundary"
    | "verification-mapping-missing"
    | "verification-mapping-non-runnable";
  readonly boundaryEntityId?: SemanticEntityId;
  readonly factId?: SemanticFactId;
  readonly predicate?: SemanticPredicate;
  readonly seedIds: readonly string[];
  readonly canonicalPath: readonly ImpactPathStep[];
}

interface VerificationReason {
  readonly basis: ImpactBasis;
  readonly sourceEntityId: SemanticEntityId;
  readonly sourceLevel: "seed" | ImpactLevel;
  readonly sourceSeedIds: readonly string[];
  readonly factId?: SemanticFactId;
}

type VerificationRecommendation =
  | {
      readonly kind: "acceptance";
      readonly acceptanceEntityId: SemanticEntityId;
      readonly reasons: readonly VerificationReason[];
    }
  | {
      readonly kind: "selector";
      readonly selector: string;
      readonly reasons: readonly VerificationReason[];
    };

interface SemanticImpactPropagation {
  readonly contractVersion: ImpactContractVersion;
  readonly scope: ImpactScope;
  readonly formatVersion: typeof ENGINEERING_IR_FORMAT_VERSION;
  readonly graphId: string;
  readonly appId: SemanticEntityId;
  readonly deltaRevision: string;
  readonly fromSemanticRevision: string;
  readonly toSemanticRevision: string;
  readonly fromFactSetDigest: string;
  readonly toFactSetDigest: string;
  readonly propagationRuleRevision: "impact-propagation-rules-v1";
  readonly seeds: readonly ImpactSeed[];
  readonly direct: readonly ImpactOccurrence[];
  readonly transitive: readonly ImpactOccurrence[];
  readonly uncertainties: readonly ImpactUncertainty[];
  readonly verification: readonly VerificationRecommendation[];
  readonly impactRevision: string;
}
```

唯一 producer 是 Compiler semantic-impact boundary 的纯函数：

```ts
buildImpactPropagation(input: ImpactPropagationInput): SemanticImpactPropagation
```

公共输入不接受 raw `EngineeringIR`、调用方提供的 `EngineeringIRIndex`、Lock、Projection、ReviewSummary、Artifact、Expected Mutation Delta 或 Verification Report。Producer 先以 `buildFactDelta(from, to)` 重算 canonical delta，并要求 supplied `delta` 与重算结果 exact match；因此不建立第二套 Fact comparator。两个只读 index 均由 kernel 内部对 branded snapshots 调用 `indexValidatedEngineeringIR()` 派生，不能由调用方注入或持久化。

### 17.2 Seed 与 endpoint basis

Impact 保留 from → to 方向，不交换 endpoints，也不把两端图先合并成一张 union graph。每个 seed 和 occurrence 都保留 `basis`：addition 只遍历 `to`，removal 只遍历 `from`，retained identity 的 update 分别在 `from` 与 `to` 上计算。这样 removed edge 仍可找到旧消费者，added edge 也不会借用只存在于旧图的路径。

Entity 使用 validated canonical order 按 ID merge-join：

- only-to → `entity-added` / `basis: "to"`。
- only-from → `entity-removed` / `basis: "from"`。
- retained ID 的 `label` 或 normalized `attributes` 改变 → 两个 `entity-updated` seeds，`changedFields` 固定按 `label` → `attributes` 排序。
- retained ID 的 `kind` 不同是 identity collision，`IMPACT-004` hard fail。
- scenarios 是由同一 Entities/Facts 重建的 cache，不产生独立 scenario-cache seed，也不建立第二 comparator。

Fact/Assertion seeds 只能来自 supplied canonical delta：

- Fact `added` / `removed` 产生对应 endpoint 的 relation seed，`anchorEntityId = fact.subject`。只有该 endpoint Fact 至少有一个 `authoritative` 或 `derived` Assertion 时可以进入语义传播；inferred-only / observed-only Fact 保留 local seed 并记录 `non-definite-authority` uncertainty，但不进入 BFS。
- `addedAssertions` / `removedAssertions` 产生对应 endpoint seed；`updatedAssertions` 在两端各产生一个 seed。
- Assertion-only 变化表示 authority/provenance/confidence/evidence 的局部治理或证据变化；它保留 exact `factId` / `assertionId`，可以触发 Verification 推荐，但 **不进入 transitive semantic traversal**。
- 不执行 strongest-wins，不把 assertion change 重写成 triple change，也不把 Entity delta 或 seed 回写 Fact Delta。

每个 seed `id` 是 `sha256:<lowercase-hex>`，payload 固定为 `{ domain: "engineering-ir-impact-seed-v1", kind, basis, entityId? | factId?, assertionId? }`；只包含该 union variant 实际拥有的 identity 字段，不包含 `anchorEntityId`、`changedFields` 或 transaction metadata。这样相同 change identity 在排序与 path tie-break 中稳定，且不依赖带冒号的 Entity/Fact ID 字符串拼接。

`seeds` 是变化根；`direct` 只包含从可传播 seed 的 `anchorEntityId` 经过恰好一条已冻结传播边到达的 Entity，`distance = 1`；`transitive` 的最短距离至少为 2。Seed anchor 本身不重复进入 direct/transitive；Assertion-only seed 没有传播 occurrence。

### 17.3 Propagation Rule Registry v1

Predicate Signature Registry 只拥有 shape，不拥有影响方向。Impact 使用独立、版本化、total checked 的 propagation registry；规则不能从 predicate 名字、label、attribute、UI edge 或 external provider 猜测。

| Predicate | stable rule variant ID | v1 rule | 语义 |
| --- | --- | --- | --- |
| `DEPENDS_ON` | `impact.depends-on.object-to-subject.v1` | entity object → subject | dependency 改变影响 dependent |
| `REQUIRES` | `impact.requires.object-to-subject.v1` | entity object → subject | requirement 改变影响 requiring subject |
| `IMPLEMENTS` | `impact.implements.object-to-subject.v1` | entity object → subject | contract/operation 改变影响 implementation responsibility |
| `LOWERS_TO` | `impact.lowers-to.subject-to-object.v1` | subject → entity object | source semantic state 改变影响 lowered artifact |
| `GUARANTEES` | — | value-object stop | subject 可成为 seed，但 value 不是 Entity edge；记录 `value-object-boundary` |
| `VERIFIED_BY` | — | selection-only | 不进入普通闭包，只用于第 17.5 节推荐 |
| `ASSUMES`、`PERSISTS_AS`、`SERIALIZES_AS` | — | reserved / no v1 edge | 当前 validated IR 不允许出现；激活 shape 时仍须单独升级 rule revision |
| 其他 active Predicate | — | unknown frontier | 与已到达 Entity 相邻时记录 `unregistered-active-predicate`，不猜方向 |
| 其他 reserved Predicate | — | impossible in validated v1 input | 不伪造 edge 或结果 |

`ruleVariantId` 属于 Impact registry，不复用 Predicate Signature variant ID；后者只描述 subject/object shape。四个 executable IDs 与方向是 `impact-propagation-rules-v1` digest/path contract 的一部分，任何增删改都必须升级 rule revision 和 Contract Freeze vectors。

Definite seed、traversal edge 与 Verification mapping 都要求对应 Fact 至少有一个 `authoritative` 或 `derived` Assertion。inferred-only 或 observed-only relation 不能升级为 definite root、transitive edge 或 runnable recommendation；由于 v1 尚未冻结以 authority class 表示 runtime/dynamic closure 的 canonical marker，这些关系记录 `non-definite-authority` unknown frontier，不改写 Fact authority。

v1 的 `classification: "dynamic"` 是前向兼容输出类型，但 **合法 producer 集合为空**。当前没有 active canonical dynamic marker；禁止从缺边、runtime provenance、inferred authority、external Evidence、普通 `boundary` / `effect` Entity，或 `PERFORMS_EFFECT` 名字推断 dynamic region。以后只有先冻结 canonical marker 与升级 propagation rule revision，才允许产生 dynamic occurrence。

### 17.4 Closure、cycle 与 path evidence

Producer 对两个 basis 分别执行 deterministic multi-source BFS：

1. state key 是 `(basis, entityId)`；没有 caller-controlled `maxDepth`，必须达到有限图 fixpoint。
2. seed、frontier 和 candidate edge 分别按稳定 tuple 排序；candidate edge 与 `ImpactPathStep` 的唯一 tuple 固定为 `(predicate, factId, ruleVariantId, direction, fromEntityId, toEntityId)`。
3. visited 保存最短距离。cycle 正常终止，不 hard fail；seed anchor 不因回边重新进入 direct/transitive。
4. 同一 target 的较短路径胜出；等距时按完整 `(seedId, [path-step tuple...])` 字典序选择 `canonicalPath`；path array 逐 step 比较上述唯一 tuple，直到首个差异，再以较短 array 为先。
5. `seedIds` 收集所有以同一最短距离到达该 target 的原因，去重排序；`canonicalPath` 只保留其中字典序最小的单一 witness，禁止枚举所有路径造成 path explosion。
6. 同一 `(basis, entityId)` 只能进入 direct 或 transitive 之一。from/to occurrence 不合并成 `basis: "both"`，以保留删除侧和新增侧的真实证据。

Uncertainty 只在已到达闭包的 frontier 上产生，必须带 basis、reason、seed IDs 与 canonical path；它不是 Fact，也不阻断 definite closure。对 `unregistered-active-predicate`，每个已到达 Entity 同时检查 `outgoingFactsBySubject` 与 `incomingFactsByEntityObject`，但不猜传播方向；同一 self-edge 仍只记录一次。`value-object-boundary` 只检查已到达 subject 的 outgoing stop-rule Fact；`non-definite-authority` 只在已冻结方向本应从当前 Entity 出发、Fact seed 本应成为 root，或 `VERIFIED_BY` 本应产生 recommendation 时记录。reserved Predicate 在 validated input 中出现仍由既有 `IR-PREDICATE-*` boundary 拒绝，而不是降级为 uncertainty。

Uncertainty identity 固定为 `(basis, classification, reasonCode, boundaryEntityId ?? "", factId ?? "", predicate ?? "")`。同一 identity 无论由多少 seed/path 发现都聚合成一条：保留最短 boundary path，等距使用第 17.4 节完整 tuple tie-break，`seedIds` 合并所有同一最短距离的原因并排序。`verification-mapping-missing` 以被检查 Entity 为 boundary、没有 factId；其他 mapping/Fact frontier 带 exact factId/predicate。Seed anchor 上的 local uncertainty 使用空 path。

### 17.5 Verification 推荐 ownership

Impact kernel 只从 seed anchors 与 direct/transitive occurrences 读取同一 endpoint 的 canonical `VERIFIED_BY` Facts，且 mapping Fact 必须至少有一个 `authoritative` 或 `derived` Assertion，才输出 recommendation。inferred-only / observed-only mapping 只产生 `non-definite-authority` uncertainty：

- `scenario | artifact -> acceptance` 输出稳定 `acceptanceEntityId`。
- `artifact -> value { selector: string }` 输出 validated canonical Fact 中 `object.value.selector` 的 exact string；不得 trim、case-fold、路径重写或另行 normalization。
- impacted `acceptance` 自身输出该 Acceptance recommendation。
- `policy -> policy` 表示 semantic policy 与 verification policy 的治理映射，不是 runnable selector；输出 `verification-mapping-non-runnable` unknown。
- impacted scenario/artifact 缺少 runnable mapping 时输出 `verification-mapping-missing` unknown。

Recommendation 按 target identity 去重排序，并保留排序后的 reason evidence。`VerificationReason` 的唯一 tuple 固定为 `(basis, sourceLevelRank, sourceEntityId, factId ?? "", sourceSeedIds)`，其中 basis order 是 `from` → `to`，`sourceLevelRank` 是 `seed = 0`、`direct = 1`、`transitive = 2`，`sourceSeedIds` 作为已排序 string array 逐项字典序比较。Impact kernel 不解释 selector 为测试文件、不执行 pass、不写 Verification Report，也不接入仓库 `test-impact-contract.ts`；实际 runnable plan 与 fast/slow/CI mapping 仍由 `08` 的 Verification authority 和下游 adapter 拥有。Workbench 只能展示该 canonical recommendation，不能自行补选测试。

### 17.6 Diagnostics、digest 与不变性

既有 `FACT-DELTA-001` 至 `007` 从 canonical 重算路径原样冒泡。Impact 新增稳定 diagnostics：

| Code | 含义 |
| --- | --- |
| `IMPACT-001` | supplied delta endpoint audit fields 与 from/to context binding 不一致 |
| `IMPACT-002` | supplied delta 不等于 `buildFactDelta(from, to)` canonical 重算结果 |
| `IMPACT-003` | propagation registry 缺项、重复、方向或 variant 歧义 |
| `IMPACT-004` | retained Entity ID 跨 endpoints 出现不同 kind |
| `IMPACT-005` | `VERIFIED_BY` target 缺失、kind 或 selector shape 不合法 |
| `IMPACT-006` | seed/occurrence/uncertainty/recommendation 重叠、重复、路径或 canonical order invariant 失败 |

检查先后固定为：

```text
supplied delta top-level endpoint/lineage fields vs contexts  → IMPACT-001
→ buildFactDelta(from, to) canonical recomputation            → FACT-DELTA-001..007
→ supplied delta exact equality                               → IMPACT-002
→ propagation registry total/variant/direction                → IMPACT-003
→ Entity merge-join kind identity                             → IMPACT-004
→ traversal and VERIFIED_BY target validation                 → IMPACT-005
→ output overlap/order/path invariants                         → IMPACT-006
→ impactRevision digest
```

`IMPACT-001` 只比较 supplied delta 的 `formatVersion/graphId/appId`、from/to `transactionId/inputRevision/semanticRevision` 与两个 contexts 的对应字段，因此先于重算；完整 payload 的任何其余差异统一由 `IMPACT-002` 报告，不发生两码竞争。

`impactRevision` 使用既有 SHA-256 表达 `sha256:<lowercase-hex>`，canonical payload 固定为：

```text
{
  domain: "engineering-ir-impact-propagation-v1",
  contractVersion,
  scope,
  formatVersion,
  graphId,
  appId,
  deltaRevision,
  from: { semanticRevision, factSetDigest },
  to: { semanticRevision, factSetDigest },
  propagationRuleRevision,
  seeds,
  direct,
  transitive,
  uncertainties,
  verification
}
```

transaction IDs、input revisions 与 `impactRevision` 本身不进入 digest。数组固定排序：basis order 全部为 `from` → `to`；seeds 按 `(basis, kind, id)`；occurrences 按 `(basis, distance, entityId)`；uncertainties 按其 identity 后接 `(seedIds, canonicalPath)`；recommendations 按 `(kind, acceptanceEntityId | selector)`，其中 kind lexical order 为 `acceptance` → `selector`；path steps 与 reasons 分别使用第 17.4 / 17.5 节唯一 tuple；string arrays 都先去重排序再逐项 lexical compare；optional 字段缺失按空字符串参与比较。不得添加实现私有字段参与 tie-break，也不得依赖 Map/Set insertion order 或 JSON 输入偶然顺序。Producer clone 输出并递归 deep-freeze，不修改 delta、contexts、snapshots 或 indexes；相同 canonical input 重复执行必须得到 byte-stable JSON 与相同 revision。

### 17.7 Scope、实现 envelope 与 Contract Freeze

初始 kernel 只实现 shared semantic-impact types、独立 propagation policy、唯一 pure Compiler producer、additive facade、focused tests、test ownership 与 `semantic.impact-propagation` Contract Freeze target。不得修改 Fact/Assertion/Validated Snapshot shape、Builder、Validator、semantic revision algorithm、现有 IR index shape 或 Fact Delta；不得接入 Pipeline stage、Workspace、Lock、Projection、ReviewSummary、ExplainGraph、Workbench、Mutation、AI Task Envelope、stable artifact 或 CI test selection。

v1 最低 sentinels 包括：真正空变化、empty Fact Delta + entity-only change、entity add/remove/update、Entity kind collision、Fact add/remove endpoint basis、Assertion add/remove/update local-only、多跳、diamond、cycle、断开子图、from/to path 分离、四条 executable rule、value/unknown frontier、dynamic 集合为空、Verification acceptance/selector/non-runnable/missing mapping、supplied delta mismatch、raw/index/artifact compile-time rejection、canonical ordering、shortest-path tie-break、输入不变、输出 deep-frozen、deterministic repetition 与独立手写 digest/reachability expected vectors。

## 18. Semantic Mutation

Semantic Mutation v2 是把受限语义意图转换为 **Authoring Source transaction** 的唯一 canonical contract。它不允许 caller、AI、Workbench 或 adapter 直接写 Engineering IR、Validated Snapshot、Fact Delta、Impact、Projection、Lock 或治理 artifact；只有 Authoring Source 成功发布后，Compiler 才重建这些派生状态。

现有 View Mutation、graph dry-run、Repair、Upgrade、Workbench mutex 和 Pipeline journal 都不是本合同的 transaction authority：

- `applyViewMutations()` 直接重写 `source/app.yaml`，没有 transaction-referenced base、source-byte CAS、actual Fact Delta/Impact、跨进程 lease、原子 publish 或 verified rollback。
- graph dry-run 预测 ExplainGraph 节点/边，不是 canonical semantic delta，也不能声明 risk、required passes 或 rollback 成立。
- Repair/Upgrade 可以提供 allowed-path、preflight、backup 等先例，但它们的逐文件写入、impact 分类或 snapshot restore 不能冒充 Semantic Mutation 的 atomicity 与 Impact。
- Pipeline journal 只记录 Pipeline pass 生命周期；Workbench mutex 只串行当前进程。二者都不锁 workspace、不能防另一进程写入，也不能恢复 Authoring Source。

### 18.1 Contract、proposal 与 trusted input

版本常量固定为：

```ts
export const SEMANTIC_MUTATION_CONTRACT_VERSION = "2" as const;
export const SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION =
  "semantic-mutation-operations-v1" as const;
export const SEMANTIC_MUTATION_EXPECTATION_REVISION =
  "semantic-mutation-expectation-v1" as const;
export const SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION =
  "semantic-mutation-verification-policy-v1" as const;
```

不可信 proposal 只描述 intent；它不能携带 platform authority：

```ts
interface SemanticMutationBaseV2 {
  readonly transactionId: string;
  readonly inputRevision: string;
  readonly semanticRevision: string;
}

interface SemanticContractRefV1 {
  readonly namespace: string;
  readonly contractId: string;
}

interface AddStateTransitionOperationV1 {
  readonly operationId: string;
  readonly kind: "add-state-transition";
  readonly contract: SemanticContractRefV1;
  readonly stateId: string;
  readonly from: string;
  readonly to: string;
  readonly by: string;
}

type SemanticMutationOperationV1 = AddStateTransitionOperationV1;

interface SemanticMutationRequestV2 {
  readonly contractVersion: "2";
  readonly requestId: string;
  readonly graphId: string;
  readonly appId: SemanticEntityId;
  readonly base: SemanticMutationBaseV2;
  readonly preconditions: readonly SemanticMutationConditionV1[];
  readonly operations: readonly SemanticMutationOperationV1[];
  readonly expectation: SemanticMutationExpectationV1;
  readonly postconditions: readonly SemanticMutationConditionV1[];
  readonly additionalVerification: readonly VerificationRequirementV1[];
}
```

`base` 必须完整绑定 canonical caller 所拥有的 before transaction 和 snapshot；禁止退化成裸 `baseRevision`。`inputRevision` 表示声明输入，`semanticRevision` 表示 canonical semantic graph；两者不能互换。空白 ID/revision、未知字段、重复 ID、错误版本或非 canonical order 都 fail closed。

Proposal **禁止** 出现 filesystem path、source bytes/digest、`FactDelta`、Impact、`riskLevel`、`requiredPasses`、adapter、rollback hint、lease 或 verification reduction。`additionalVerification` 只能增加要求，不能表达 skip、override、maximum 或 negative selector。

平台以独立 trusted context 调用 planner：

```ts
interface SemanticMutationAuthorizationContextV2 {
  readonly authorizationRevision: string;
  readonly taskId?: string;
  readonly envelopeRevision?: string;
  readonly allowedOperationKinds: readonly SemanticMutationOperationV1["kind"][];
  readonly allowedTargetEntityIds: readonly SemanticEntityId[];
  readonly allowedSourceOwnerIds: readonly string[];
  readonly allowedPathPrefixes: readonly string[];
  readonly requiredPreconditions: readonly SemanticMutationConditionV1[];
  readonly requiredPostconditions: readonly SemanticMutationConditionV1[];
  readonly minimumVerification: readonly VerificationRequirementV1[];
}

type SemanticMutationPreparationV2 =
  | {
      readonly status: "prepared";
      readonly preflightRevision: string;
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly staged: FactDeltaEndpointContext;
      readonly rollbackManifestDigest: string;
    }
  | {
      readonly status: "rejected";
      readonly preflightRevision: string;
      readonly rejectedAt:
        | "source-resolution"
        | "path"
        | "transform"
        | "cas"
        | "staged-rebuild";
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    };

interface SemanticMutationVerificationCapabilityV1 {
  readonly requirement: VerificationRequirementV1;
  readonly status: "runnable" | "non-runnable";
  readonly isolated: boolean;
}

interface SemanticMutationVerificationPlanningContextV1 {
  readonly policyRevision: "semantic-mutation-verification-policy-v1";
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly impactRevision: string;
  readonly requiredVerificationDigest: string;
  readonly uncertaintyStatus: "covered" | "blocked";
  readonly capabilities: readonly SemanticMutationVerificationCapabilityV1[];
  readonly planningRevision: string;
}

interface SemanticMutationPreflightInputV2 {
  readonly request: SemanticMutationRequestV2;
  readonly base: FactDeltaEndpointContext;
  readonly authorization: SemanticMutationAuthorizationContextV2;
}

interface SemanticMutationInputV2 {
  readonly request: SemanticMutationRequestV2;
  readonly base: FactDeltaEndpointContext;
  readonly authorization: SemanticMutationAuthorizationContextV2;
  readonly preparation: SemanticMutationPreparationV2;
  readonly verificationPlanning: SemanticMutationVerificationPlanningContextV1;
}

type SemanticMutationPreflightV2 =
  | {
      readonly contractVersion: "2";
      readonly status: "rejected";
      readonly rejectedAt: "request";
      readonly requestId?: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
      readonly diagnosticRevision: string;
    }
  | {
      readonly contractVersion: "2";
      readonly status: "ready" | "rejected";
      readonly rejectedAt: "" | "base" | "precondition" | "source-resolution" | "transform";
      readonly requestId: string;
      readonly requestRevision: string;
      readonly authorizationRevision: string;
      readonly base: SemanticMutationBaseV2;
      readonly operationRegistryRevision: "semantic-mutation-operations-v1";
      readonly expectationRevision: "semantic-mutation-expectation-v1";
      readonly preflightRevision: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    };

preflightSemanticMutation(input: SemanticMutationPreflightInputV2): SemanticMutationPreflightV2
planSemanticMutation(input: SemanticMutationInputV2): SemanticMutationPlanV2

applySemanticMutation(input: {
  readonly input: SemanticMutationInputV2;
  readonly expectedPlanRevision: string;
}): Promise<SemanticMutationResultV2>
```

`SemanticMutationInputV2` 只能由 platform boundary 构造。Request 的 base/graph/app 必须与 `FactDeltaEndpointContext` exact match，Task Envelope 的 allowed operations/targets/paths、required facts、must-preserve facts 和 verification minimum 分别由平台并入 authorization 的 allowed fields、`requiredPreconditions`、`requiredPostconditions` 与 `minimumVerification`；proposal 或 Context Packet 不能扩大或删除它们。Planner 分别对 `requiredPreconditions ∪ request.preconditions` 和 `requiredPostconditions ∪ request.postconditions` 去重后要求全部满足，任何一项失败即 reject。`preflightSemanticMutation()` 先纯计算 request/base/precondition/operation registry 结果与 `preflightRevision`；SM-2/SM-3 只有在 preflight ready 后才可做 source resolution、isolated deterministic transform/rebuild，且 preparation 必须 exact 绑定该 revision，避免为一个早已失败的 request 先执行 staging。Async preparation coordinator 只形成单一 source change、staged `FactDeltaEndpointContext` 与 rollback manifest；它不构造 actual Delta/Impact。`planSemanticMutation()` 重算 preflight，并对这些只读、trusted evidence 执行 `buildFactDelta → expectation/postconditions → buildImpactPropagation → verification union/policy`；较早阶段失败不得调用后续 producer。Apply 必须在 lease 内重新生成 preflight、preparation 和 plan，不能信任旧 preparation 对 workspace freshness 的判断。

Verification planning context 是 platform Verification adapter 对 planner 已计算的 exact Impact 与完整 requirement union 的可信、可重算绑定，不是 proposal authority。`planningRevision` payload 固定为 `{ domain: "semantic-mutation-verification-planning-v1", policyRevision, adapterId, adapterRevision, impactRevision, requiredVerificationDigest, uncertaintyStatus, capabilities }`；capabilities 按 requirement canonical order 唯一排序。缺项、额外项、non-runnable、非 isolated、Impact/requirement digest stale、`uncertaintyStatus: "blocked"` 或 revision mismatch 都以 `SEMANTIC-MUTATION-010` 在 live publish 前拒绝。`uncertaintyStatus: "covered"` 只表示完整 conservative union 已由 isolated verifier capability 覆盖，不删除 Impact uncertainty，也不把 selector 解析或执行 authority 移入 Mutation。

`authorizationRevision` 由 platform builder 计算，表达为 `sha256:<lowercase-hex>`。Canonical payload 固定为 `{ domain: "semantic-mutation-authorization-v2", taskId, envelopeRevision, allowedOperationKinds, allowedTargetEntityIds, allowedSourceOwnerIds, allowedPathPrefixes, requiredPreconditions, requiredPostconditions, minimumVerification }`；optional ID 缺失按空字符串，operations/targets/owners/path prefixes lexical 去重排序，conditions 和 verification 使用第 18.5 节 canonical order。Planner 必须重算并 exact match，不能信任 caller 或 adapter 提供的 revision string；payload 或 revision 不匹配以 `SEMANTIC-MUTATION-001` 拒绝。因此任何 authority 内容变化都会改变 planRevision。

### 18.2 Restricted condition 与 expectation DSL

Condition 只允许对 canonical snapshot 做 exact existence/value 判断：

```ts
type SemanticMutationConditionV1 =
  | {
      readonly conditionId: string;
      readonly kind: "entity";
      readonly entityId: SemanticEntityId;
      readonly exists: boolean;
      readonly entityKind?: SemanticEntityKind;
      readonly canonicalEntityDigest?: string;
    }
  | {
      readonly conditionId: string;
      readonly kind: "fact";
      readonly fact: SemanticFactSelectorV1;
      readonly exists: boolean;
    }
  | {
      readonly conditionId: string;
      readonly kind: "assertion";
      readonly fact: SemanticFactSelectorV1;
      readonly assertionId: FactAssertionId;
      readonly exists: boolean;
      readonly canonicalAssertionDigest?: string;
    };

interface SemanticFactSelectorV1 {
  readonly subject: SemanticEntityId;
  readonly predicate: SemanticPredicate;
  readonly object: SemanticFactObject;
}
```

禁止 arbitrary query、regex、script、path glob、projection label、external Evidence、strongest-authority shortcut 或 caller-defined comparator。`canonicalEntityDigest` 表达为 `sha256:<lowercase-hex>`，payload 固定为 `{ domain: "semantic-mutation-entity-condition-v1", id, kind, label, attributes }`；attributes 使用 Validated IR canonical order。`canonicalAssertionDigest` 使用同一 SHA-256 表达，payload 固定为 `{ domain: "semantic-mutation-assertion-condition-v1", id, authority, confidence, provenance, evidence, validFromRevision, validToRevision }`；provenance/evidence 使用 Validated IR canonical order，optional `validToRevision` 缺失按空字符串。两种 digest 都不得包含 Fact/Entity 外的 transaction、Projection 或 implementation metadata。存在性为 false 时不得同时给 digest/kind。Preconditions 在 before snapshot 上求值；postconditions 在 staged after snapshot 上求值。Task Envelope 的 required/must-preserve facts 被编译成额外条件，不能被 request 删除。

Expectation 不是 caller 提供的 `FactDelta`，也不授权 source change：

```ts
interface ExpectedFactAssertionV1 {
  readonly assertionId: FactAssertionId;
  readonly assertionClaimDigest: string;
}

interface ExpectedSemanticFactV1 {
  readonly fact: SemanticFactSelectorV1;
  readonly assertions: readonly ExpectedFactAssertionV1[];
}

type ExpectedFactAssertionChangeV1 =
  | {
      readonly fact: SemanticFactSelectorV1;
      readonly assertionId: FactAssertionId;
      readonly kind: "added" | "removed";
      readonly assertionClaimDigest: string;
    }
  | {
      readonly fact: SemanticFactSelectorV1;
      readonly assertionId: FactAssertionId;
      readonly kind: "updated";
      readonly changedFields: readonly ("confidence" | "evidence")[];
      readonly beforeAssertionClaimDigest: string;
      readonly afterAssertionClaimDigest: string;
    };

interface SemanticMutationExpectationV1 {
  readonly revision: "semantic-mutation-expectation-v1";
  readonly matchMode: "exact";
  readonly addedFacts: readonly ExpectedSemanticFactV1[];
  readonly removedFacts: readonly ExpectedSemanticFactV1[];
  readonly assertionChanges: readonly ExpectedFactAssertionChangeV1[];
  readonly entityChanges: "none";
}
```

`assertionClaimDigest` 表达为 `sha256:<lowercase-hex>`，canonical payload 固定为 `{ domain: "semantic-mutation-assertion-claim-v1", assertionId, confidence, evidence }`；`assertionId` 已绑定 authority/provenance identity，digest 额外覆盖不会进入 Assertion ID 的 confidence/evidence。Endpoint-specific `validFromRevision` / `validToRevision` 不进入该 expectation digest；它们仍由 Validated IR 与 Fact Delta boundary 校验，caller 不能提供或覆盖。

v1 只有 `matchMode: "exact"`。Matcher 必须从 before/after branded snapshots 独立计算 Entity merge-join，并使用唯一 `buildFactDelta(from, to)` 得到 actual Fact/Assertion changes；每个 actual change 必须既被 operation registry 允许，又由 expectation exact 声明。新/删除 Fact 的 `assertions` 必须与 actual Fact 的 `(assertionId, assertionClaimDigest)` 完全集合相等；existing Fact 的 assertion add/remove必须匹配 claim digest，update 必须同时 exact match `changedFields` 与 before/after claim digests。任何未声明 Entity、Fact 或 Assertion drift、confidence/evidence 漂移、缺少的 expected change、重复 selector、Entity kind collision或 postcondition failure均 reject。v1 operation 不允许 Entity change，因此 `entityChanges` 固定为 `"none"`；以后开放 Entity operation 必须升级 expectation revision。

### 18.3 Operation Registry v1

`semantic-mutation-operations-v1` 是 total checked registry，唯一 operation 是：

| kind | target authority | transformation | risk floor | implicit cascade |
| --- | --- | --- | --- | --- |
| `add-state-transition` | 唯一 writable `SemanticContract` owner 中的 state | 添加 exact `{ from, to, by }` transition | `high` | none |

对应 registry descriptor 固定为 `{ kind: "add-state-transition", riskFloor: "high", minimumVerification: [{ kind: "pass", passId: "verify" }], invalidationFromStage: "resolve", maxSourceChanges: 1, implicitCascade: "none" }`。v1 final risk 是全部 operation risk floor 的 maximum，因此当前 ready/impact-verification plan 固定为 `high`；Impact uncertainty 保留在 Impact 中，并由第 18.1 节 exact-bound Verification planning context 决定 covered 或 blocked，caller 不能自行降级。

Registry validation 固定为：

1. `contract.namespace + contractId` 在 base semantic input 中只匹配一个 loaded contract，`stateId` 只匹配一个 state。
2. `from` / `to` 是该 state 已声明 value，二者不同；exact transition tuple 尚不存在。
3. `by` 匹配一个 operation；state owner 匹配一个 responsibility；该 responsibility 的 `implements` 包含 `by`，且 operation 的 `responsibility` 等于 owner。
4. 同一 request 中 operation ID 唯一；对同一 contract/state/tuple 的重复或冲突 operation 以 `SEMANTIC-MUTATION-006` 拒绝，不静默去重或当成成功 no-op。
5. Adapter 只添加 transition，按 `(from, to, by)` 排序；不得隐式添加 value、operation、responsibility、permission/effect、acceptance、Block/Slot 或 remove cascade。

Registry 同时拥有该 operation 的唯一 canonical semantic effect allowlist，caller expectation 只能声明它，不能扩大它：

1. 必须新增一个 `TRANSITIONS_TO` Fact：subject 是目标 state 的 canonical Entity ID；object 是 exact value `{ from, to, by: <canonical operation Entity ID> }`。
2. 上述 Fact 必须恰有 target loaded contract provenance 的 `authoritative` Assertion；Assertion identity/claim digest 由现有 IR builder 规则派生。
3. 若 base 已有 canonical `by operation --MUTATES--> state` Fact，则该 Fact 和 Assertions 必须完全不变；若不存在，允许且要求新增该 exact Fact及同一 contract provenance 的单一 authoritative Assertion。这个 0/1 分支只由 base snapshot 决定。
4. Entity add/remove/update、Fact removal、existing Fact Assertion add/remove/update，以及任何其他 Fact addition 全部禁止。Actual semantic effect 与该 allowlist 或 caller exact expectation任一不符都以 `SEMANTIC-MUTATION-009` 拒绝。

因此 request 不能通过在 expectation 中多列 Fact/Assertion 来授权额外 drift；operation policy allowlist 与 caller expectation 是双重 exact match，不是并集。

Block、port、Contract Entity/Operation、permission、effect、ownership、remove/cascade 和 arbitrary YAML patch 都不属于 v1；新增任何一种必须升级 operation registry revision、source adapter contract、risk/verification policy 与 Contract Freeze vectors。不得把 legacy View Mutation 的同名 operation 自动映射进该 registry。

### 18.4 Source ownership 与 path boundary

Operation 不携带 path。Platform resolver 必须从 validated loaded contract provenance 和 versioned adapter registry 返回 **唯一 owner、唯一 adapter、唯一 writable relative path**：

- `platform/registry/official/**`、安装的 Registry/Block package 与其他分发资产一律 read-only mutation target。`workspace-registry` 与 `compiler-registry` provenance 即使路径文本落在 workspace 或长得像 `source/model/**`，也不能升级为 writable owner；当前 Ticket authoritative contract 因此不能直接回写。
- Workspace Authoring Source 只通过固定索引 `source/model/semantic-contracts.yaml` 进入 canonical frontend。索引 revision 固定为 `authoring-semantic-contract-index-v1`，只允许 exact `{ formatRevision, contracts: [{ blockId, path }] }` shape；每个 `blockId` 必须已由 workspace resolve，每个 path 必须是 `source/model/**` 下 canonical POSIX `.yaml` 相对路径、不能指向索引自身且不能重复。索引不存在表示没有 authoring contract，不触发目录扫描或同名 mirror 推断。
- Canonical input loader 同时产生 Registry 与 Authoring `SemanticMutationLoadedSourceCandidateV1`，并把同一 source collection 随 validated snapshot 传出 frontend。Resolver 只接受与 base IR 中 target contract 的 authoritative `sourceId` / `sourcePath`、namespace、contract ID exact 一致的真实 loaded candidate；`sourceKind` 与 `sourceRevision` 必须由 loader 派生并由 resolver 重算。未被该 frontend 装载的 copy/mirror 没有 owner authority。
- V1 唯一 writable descriptor 是 `workspace-authoring + semantic-contract-yaml@semantic-contract-yaml-v1 + source/model/**`；adapter registry revision 固定为 `semantic-mutation-source-adapters-v1`。Owner ID 固定编码为 ``semantic-contract-owner:${encodeURIComponent(namespace)}:${encodeURIComponent(contractId)}``，禁止用未转义分隔符拼接造成 identity collision。
- 无 owner、多个 owner、adapter revision 不匹配、read-only provenance 或 target/source namespace 不一致都以 `SEMANTIC-MUTATION-004` reject。
- `allowedPathPrefixes` 只缩小 resolver 输出。Prefix 使用 segment-aware canonical POSIX 语义：可带一个尾随 `/`，授权 exact path 或其子树；空 prefix、absolute/drive/ADS、反斜杠、NUL、空/`.`/`..` segment 都非法，裸字符串前缀不得越过 segment boundary。Caller path、contract 中的任意 source-like string、Projection/Evidence path 或 symlink target都不能成为 authority。

在读取或写入前，adapter 必须对 workspace root、受控 transaction directory、parent 和 target 做 canonical realpath 与 reparse-point 检查；拒绝 symlink/junction/reparse parent/target、root escape、Windows case-fold collision、device name、ADS、重复 canonical path 和不同 textual path 指向同一 target。V1 source target 必须是 `nlink === 1` 的普通文件；stable read 在读取 bytes 前必须把 opened handle stat exact 绑定到 pre-inspection target identity，read 后再核对同一 handle identity，并重复完整 path boundary，禁止 swap-open-restore 或 hardlink alias 绕过。检查必须在 plan 和 apply lease 内各执行一次，并在 atomic rename 前再次核对；`resolvePathInside()` 的 lexical containment 只能作为第一层，不能独立证明安全。v1 transaction 最多修改一个 Authoring Source file；多文件 publish 必须另行升级 atomicity contract。

### 18.5 Plan、derived policy 与 revisions

Plan 是只读 dry-run 结果，不写 live workspace：

```ts
type SemanticMutationRisk = "low" | "medium" | "high" | "critical";

type VerificationRequirementV1 =
  | { readonly kind: "acceptance"; readonly acceptanceEntityId: SemanticEntityId }
  | { readonly kind: "selector"; readonly selector: string }
  | { readonly kind: "pass"; readonly passId: string };

interface SemanticMutationSourceChangeV2 {
  readonly ownerId: string;
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly relativePath: string;
  readonly beforeByteDigest: string;
  readonly stagedByteDigest: string;
  readonly invalidationFromStage: "resolve";
}

interface SemanticMutationPlanBaseV2 {
  readonly contractVersion: "2";
  readonly requestId: string;
  readonly requestRevision: string;
  readonly authorizationRevision: string;
  readonly operationRegistryRevision: "semantic-mutation-operations-v1";
  readonly expectationRevision: "semantic-mutation-expectation-v1";
  readonly verificationPolicyRevision: "semantic-mutation-verification-policy-v1";
  readonly verificationAdapterId: string;
  readonly verificationAdapterRevision: string;
  readonly verificationPlanningRevision: string;
  readonly base: SemanticMutationBaseV2;
  readonly planRevision: string;
}

type SemanticMutationPlanV2 =
  | {
      readonly contractVersion: "2";
      readonly status: "rejected";
      readonly rejectedAt: "request";
      readonly requestId?: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
      readonly diagnosticRevision: string;
    }
  | (SemanticMutationPlanBaseV2 & {
      readonly status: "ready";
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly staged: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly risk: SemanticMutationRisk;
      readonly requiredVerification: readonly VerificationRequirementV1[];
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly [];
    })
  | (SemanticMutationPlanBaseV2 & {
      readonly status: "rejected";
      readonly rejectedAt:
        | "base"
        | "precondition"
        | "source-resolution"
        | "path"
        | "transform"
        | "cas"
        | "staged-rebuild";
      readonly sourceChanges: readonly [];
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    })
  | (SemanticMutationPlanBaseV2 & {
      readonly status: "rejected";
      readonly rejectedAt: "fact-delta";
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly staged: SemanticMutationBaseV2;
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    })
  | (SemanticMutationPlanBaseV2 & {
      readonly status: "rejected";
      readonly rejectedAt: "expectation";
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly staged: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    })
  | (SemanticMutationPlanBaseV2 & {
      readonly status: "rejected";
      readonly rejectedAt: "impact";
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly staged: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    })
  | (SemanticMutationPlanBaseV2 & {
      readonly status: "rejected";
      readonly rejectedAt: "impact-verification";
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly staged: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly risk: SemanticMutationRisk;
      readonly requiredVerification: readonly VerificationRequirementV1[];
      readonly rollbackManifestDigest: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    });
```

`rejected` plan 由 `rejectedAt` 再判别。Raw request 或 trusted input 还不能形成 normalized contract 时返回最小 request rejection：它没有 base/request/authorization/plan revision，只保留可安全提取的非空 request ID、至少一个 `SEMANTIC-MUTATION-001` 和 `diagnosticRevision`；该 revision 使用 domain `semantic-mutation-diagnostic-v2` 与 canonical diagnostics，不可传给 apply。在 staged rebuild 前拒绝时不得暴露不完整 source/semantic evidence；Fact Delta producer rejection 保留 source/staged/rollback evidence但没有 delta；expectation rejection再增加 actual Delta；Impact producer rejection保留 actual Delta但没有 Impact/risk；只有 Impact/Verification rejection保留完整 canonical Impact/risk。`ready` plan 必须恰有 v1 单文件 source change，具备全部 derived 字段且 diagnostics 为空。所有 rejected variant 至少有一个 diagnostic，且绝不能表示 live source 已写入。`staged.transactionId` 是 planning-owned isolated transaction，不能冒充 live apply transaction。

Risk、required passes 和 verification 都是派生结果。Required Verification 是以下四者的保守 union：

```text
Impact.verification recommendations
∪ operation registry minimum / risk policy
∪ trusted Task Envelope minimum
∪ caller additionalVerification
```

去重只按 exact `(kind, acceptanceEntityId | selector | passId)`；任何来源都不能删除另一来源。Impact uncertainty、high risk、missing runnable mapping 是否阻塞由 platform Verification policy 决定，caller 不能降级。Impact kernel 仍只拥有 recommendation，不解释 selector 或执行 pass；runnable mapping、环境、pass order、report 与 acceptance 归 `08` Verification authority。

v1 semantic contract source 的 `invalidationFromStage` 固定为 `resolve`；后续 stage 闭包由现有 Pipeline stage/pass registry 推导，Mutation 不维护第二张失效表。Plan 和 result 必须显示该 boundary。不能在 isolated workspace 安全执行、会产生不可逆外部副作用或无法绑定 staged source digest 的 verifier，以 `SEMANTIC-MUTATION-010` 在 live publish 前拒绝；不能为了运行它而先提交 source。

`requestRevision` 是 normalized request 的 `sha256:<lowercase-hex>`；payload 字段顺序固定为 `domain, contractVersion, requestId, graphId, appId, base, preconditions, operations, expectation, postconditions, additionalVerification, operationRegistryRevision, expectationRevision`。`preflightRevision` payload 固定包含 domain `semantic-mutation-preflight-v2`、request/authorization revisions、base、registry revisions、status/rejectedAt 与 diagnostics。除最小 request rejection 外，所有阶段的 `planRevision` 使用同一 payload shape：字段依次为 domain、contractVersion、status、rejectedAt、requestId、request/authorization revisions、base、operation/expectation/verification policy revisions、verification adapter/planning revisions、source changes、staged endpoint、actual delta revision、Impact revision、risk、required verification、rollback manifest digest 与 diagnostics；不包含 `planRevision` 本身或时间戳。未到达某阶段固定使用 `rejectedAt: ""`、`sourceChanges: []`、`staged: null`、revision/risk/digest 空字符串、`requiredVerification: []`，不得省略字段或把 partial union 写进早期 rejected plan。只有 ready 与 impact-verification variant 公布完整 `requiredVerification`。

条件按 `conditionId`、operation 按 `operationId`、fact selector 按 canonical `(subject, predicate, object)`、assertion change 按 `(fact selector, assertionId, kind)`、source change 按 case-folded canonical relative path、verification/capability 按 `(kind, target)` 排序。Diagnostic 先按第 18.6 节 stage precedence，再按 `(operationId ?? "", conditionId ?? "", relativePath ?? "")`，最后按 origin rank、code、message、canonical details JSON 排序。`details` 只允许 canonical JSON：plain object key 按 code-unit 排序、array 保留顺序、number 必须 finite；`undefined`、BigInt、NaN/Infinity、class/Error/Map/Set 等 non-plain object 全部拒绝。所有 ID 和 tuple 重复 hard fail；不得依赖 YAML/JSON/Map/Set insertion order。`stateId` 与 `by` 是 contract-local ID，分别解析为 canonical state/operation Entity ID；重复 operationId 在 request schema 阶段以 `SEMANTIC-MUTATION-001` 拒绝，不同 ID 指向同一或冲突 semantic tuple 则以 `SEMANTIC-MUTATION-006` 拒绝。Planner clone 输出并递归 deep-freeze，不修改 request、authorization、snapshots、source buffers、Delta 或 Impact；相同 canonical input 必须得到 byte-stable JSON 和相同 revisions。

### 18.6 Diagnostics 与 precedence

Semantic Mutation 保留 nested `FACT-DELTA-*`、`IMPACT-*`、Compiler 和 Verification diagnostic code，不折叠成普通 mutation message。新增稳定 codes：

```ts
interface SemanticMutationDiagnosticV2 {
  readonly origin: "semantic-mutation" | "fact-delta" | "impact" | "compiler" | "verification";
  readonly code: string;
  readonly stage:
    | "request"
    | "base"
    | "precondition"
    | "source-resolution"
    | "path"
    | "transform"
    | "cas"
    | "staged-rebuild"
    | "fact-delta"
    | "expectation"
    | "impact"
    | "impact-verification"
    | "publish"
    | "rollback";
  readonly message: string;
  readonly operationId?: string;
  readonly conditionId?: string;
  readonly relativePath?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
```

Top-level mutation diagnostic 的 code 必须来自下表；nested diagnostic 保留 producer 的原 code，并用 `origin` 区分。不得在 public diagnostic 暴露 absolute path、temp/backup path、source bytes、secret 或任意 Error object；`details` 只能包含 canonical、可序列化、已脱敏字段。

| Code | 含义 |
| --- | --- |
| `SEMANTIC-MUTATION-001` | contract/schema/version、空 ID、未知字段、排序或重复 identity 不合法 |
| `SEMANTIC-MUTATION-002` | graph/app/base transaction/input/semantic revision 与 trusted before context 不匹配 |
| `SEMANTIC-MUTATION-003` | precondition 或 trusted must-preserve before condition 失败 |
| `SEMANTIC-MUTATION-004` | unsupported operation、无/多 adapter、ambiguous 或 read-only authoring authority |
| `SEMANTIC-MUTATION-005` | path allowlist/containment/realpath/reparse/canonical collision 不合法 |
| `SEMANTIC-MUTATION-006` | operation conflict、source parse/transform 或 plan invariant 失败 |
| `SEMANTIC-MUTATION-007` | base/source byte digest/publish CAS stale，检测到 TOCTOU |
| `SEMANTIC-MUTATION-008` | isolated staged resolve、semantic frontend 或 validated boundary 失败 |
| `SEMANTIC-MUTATION-009` | actual exact expectation、Entity drift 或 after postcondition 不匹配 |
| `SEMANTIC-MUTATION-010` | Impact policy或 Verification planning/execution拒绝 |
| `SEMANTIC-MUTATION-011` | atomic Authoring Source publish 失败 |
| `SEMANTIC-MUTATION-012` | rollback、restore validation 或 rebuild 失败，需要人工 recovery |

检查 precedence 固定为：

```text
request/schema/order                                              → 001
→ base graph/app/transaction/input/semantic binding              → 002
→ before preconditions / trusted must-preserve                   → 003
→ operation registry / source ownership                          → 004
→ path / realpath / reparse / canonical collision                → 005
→ operation conflict / parse / transform / plan invariant        → 006
→ source byte and semantic CAS                                   → 007
→ staged resolve / frontend / validated snapshot                 → 008 (+ nested compiler codes)
→ buildFactDelta + exact expectation + after postconditions      → nested FACT-DELTA-* then 009
→ buildImpactPropagation + Verification policy/execution         → nested IMPACT-* / Verification then 010
→ atomic publish                                                 → 011
→ rollback / restored rebuild                                    → 012
```

`buildFactDelta` 自身失败使用 diagnostic stage / `rejectedAt: "fact-delta"`；producer 成功后的 expectation/postcondition失败才是 `"expectation"` / `SEMANTIC-MUTATION-009`。`buildImpactPropagation` 自身失败使用 `"impact"` 并保留 nested `IMPACT-*`；producer成功后的 policy/Verification拒绝才是 `"impact-verification"` / `SEMANTIC-MUTATION-010`。

同一步有多个 failure 时按 canonical target tuple 排序全部返回；一旦更早阶段失败，不执行后续阶段。`SEMANTIC-MUTATION-011` 之前不得改变 live Authoring Source。Nested diagnostic 保留原 code、message 和 structured details，并附 transaction/request/operation stage context；不得把 Impact unknown 当作成功或把 rollback failure 报成普通 verification reject。

### 18.7 Apply transaction、atomicity 与 recovery

Apply 接受 exact `expectedPlanRevision`，并执行：

```text
acquire cross-process exclusive workspace mutation lease
→ read trusted before snapshot and exact source bytes again
→ re-plan from the same request/authorization under the lease
→ require semantic base + before byte digest + expectedPlanRevision CAS
→ create same-volume controlled staging/backup and recovery record
→ apply deterministic edit only in isolated workspace
→ canonical resolve → semantic frontend → validated after snapshot
→ actual buildFactDelta → exact expectation/postconditions
→ buildImpactPropagation → conservative Verification union → verify
→ atomic single-file Authoring Source publish with final CAS
→ canonical live rebuild and exact staged revision/source digest check
→ mark accepted; otherwise CAS-safe rollback and rebuild
→ release lease
```

Planning/dry-run never writes live source. Before publish，所有 parse、precondition、transform、resolve/frontend、actual Delta/Impact、expectation 与可隔离 Verification 必须先在 staging 完成。Temp/backup 与 target 位于同卷受控目录；backup 保留 exact original bytes、BOM/EOL 和 file mode/attributes needed for restoration。Atomic rename 前再次验证 live digest 等于 before digest；semantic revision 相同不能替代 byte CAS，因为 formatting/comment/source bytes 可能已变。

Publish 后 live canonical rebuild 必须得到与 staged plan 相同的 input/semantic revisions；任何 post-publish failure 进入 rollback。Rollback 之前再次 CAS：只有 live digest 仍等于本 transaction committed digest 才可恢复，禁止覆盖并发用户修改；恢复后 exact byte digest 必须等于 before digest，并重新 resolve/frontend 验证 base input/semantic revision。若 CAS 已被第三方改变、restore、rebuild 或 journal finalization 失败，状态必须是 `recovery-required`，保留 backup/recovery record，禁止声称 workspace 已恢复。

Recovery record 状态机固定为：

```text
prepared → authoring-committed → verified
                         ↘ rolled-back
                         ↘ recovery-required
```

Crash restart 必须在取得 lease 后读取未终结 record，并依据 current/before/committed byte digest选择完成验证、CAS-safe rollback 或 recovery-required；不得先开始下一 mutation。Recovery journal 是 transaction governance state，不是 Engineering IR 或第二 Authoring Source；SM-3 必须冻结其存储位置、schema migration 和 retention 后才可宣称 crash recovery 完成。

`requestId` 是 `(graphId, appId)` 内的 replay identity。同一 retained journal/terminal record 中，request ID 对应不同 `requestRevision` 以 `SEMANTIC-MUTATION-001` 拒绝；exact replay 必须返回/恢复原 transaction，不能再执行一次 operation。即使 terminal record 已按 retention 清理，旧 request 仍受 exact base、source-byte 和 plan CAS 约束：已接受的 mutation 不会以新 transaction 重放为成功 no-op。V1 不承诺跨 record retention 的无限期 result cache；SM-3 必须在公开 apply 前冻结 terminal record retention 与 query contract。

Accepted transaction 必须按 `invalidationFromStage` 重新生成或明确失效全部 downstream Lock、Projection、Artifact 和 View；stale derivative 不能与新 source 并存为 accepted canonical state。该闭包从既有 Pipeline registry 读取，Mutation 不自建 pass order。若 live canonical rebuild、derivative invalidation/publish 或 staged revision一致性未完成，则不得 accepted，必须走 rollback/recovery。

### 18.8 Result contract 与无部分成功

Terminal status 只有：

```ts
type SemanticMutationTerminalStatus =
  | "accepted"
  | "rejected"
  | "rolled-back"
  | "recovery-required";

interface SemanticMutationVerificationExecutionRefV2 {
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly reportRevision: string;
  readonly planRevision: string;
  readonly attempted: SemanticMutationBaseV2;
  readonly stagedSourceDigest: string;
  readonly requiredVerificationDigest: string;
  readonly status: "passed" | "failed" | "blocked";
  readonly verificationExecutionRevision: string;
}

interface SemanticMutationResultBaseV2 {
  readonly contractVersion: "2";
  readonly requestId: string;
  readonly requestRevision: string;
  readonly planRevision: string;
  readonly base: SemanticMutationBaseV2;
  readonly resultRevision: string;
}

type SemanticMutationResultV2 =
  | (SemanticMutationResultBaseV2 & {
      readonly status: "accepted";
      readonly transactionId: string;
      readonly attempted: SemanticMutationBaseV2;
      readonly accepted: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly verification: SemanticMutationVerificationExecutionRefV2 & { readonly status: "passed" };
      readonly diagnostics: readonly [];
    })
  | (SemanticMutationResultBaseV2 & {
      readonly status: "rejected";
      readonly transactionId?: string;
      readonly attempted?: SemanticMutationBaseV2;
      readonly actualDelta?: FactDelta;
      readonly impact?: SemanticImpactPropagation;
      readonly sourceChanges: readonly SemanticMutationSourceChangeV2[];
      readonly verification?: SemanticMutationVerificationExecutionRefV2;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    })
  | (SemanticMutationResultBaseV2 & {
      readonly status: "rolled-back";
      readonly transactionId: string;
      readonly attempted: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly verification: SemanticMutationVerificationExecutionRefV2 & { readonly status: "passed" };
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    })
  | (SemanticMutationResultBaseV2 & {
      readonly status: "recovery-required";
      readonly transactionId: string;
      readonly attempted: SemanticMutationBaseV2;
      readonly actualDelta: FactDelta;
      readonly impact: SemanticImpactPropagation;
      readonly sourceChanges: readonly [SemanticMutationSourceChangeV2];
      readonly verification: SemanticMutationVerificationExecutionRefV2 & { readonly status: "passed" };
      readonly recoveryState:
        | "rollback-failed"
        | "restore-validation-failed"
        | "rebuild-failed"
        | "concurrent-write";
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
    });
```

- `accepted`：必须有 transaction/attempted/accepted、actual Delta、Impact、source changes 和 status=`passed` 的 Verification execution binding，diagnostics 为空；accepted endpoint 与 live canonical rebuild exact match。
- `rejected`：live source 从未发布；没有 accepted endpoint。可以有 planning-stage actual Delta/Impact 作为 rejection evidence，但它们不表示 canonical state 已改变。
- `rolled-back`：source 曾发布但 exact bytes 与 canonical base 已验证恢复；有 transaction/attempted/source changes 和导致 rollback 的 diagnostics，没有 accepted endpoint。
- `recovery-required`：source publish 后无法证明安全恢复；必须有 transaction、source changes、`recoveryState`、`SEMANTIC-MUTATION-012` 和 durable recovery record，没有 accepted endpoint。

不存在 `partial-success`、`accepted-with-warning` 或把若干 operation 标成功后继续的状态；v1 request 是单 atomic unit。`resultRevision` digest domain 固定为 `semantic-mutation-result-v2`，包含除自身以外的全部 canonical result 字段，不含时间戳或日志路径。Result 同样 clone、canonical order、deep-freeze。

`requiredVerificationDigest` 使用 `sha256:<lowercase-hex>`，payload 固定为 `{ domain: "semantic-mutation-required-verification-v1", requirements }`，requirements 必须等于 plan 的完整 canonical union。`verificationExecutionRevision` 使用同一 SHA-256 表达，payload 固定为 `{ domain: "semantic-mutation-verification-execution-v1", adapterId, adapterRevision, reportRevision, planRevision, attempted, stagedSourceDigest, requiredVerificationDigest, status }`。Apply 必须重算两个 digest，并 exact 核对 execution ref 的 planRevision、attempted endpoint、`sourceChanges[0].stagedByteDigest` 和 required union；旧 plan、错误 endpoint/source digest、partial union、failed/blocked 或 digest mismatch 一律以 `SEMANTIC-MUTATION-010` 拒绝，绝不能产生 accepted。该 binding 只引用 `08` authority 的 report，不复制其 report schema或把 runnable decision ownership移入 Mutation。

### 18.9 Implementation envelope 与 Contract Freeze

SM-1 只实现 pure request normalization、condition/expectation matcher、plan/result builders/invariants、dedicated types/tests/ownership 与 `semantic.mutation` Contract Freeze；不读取 Workspace、path、YAML，不接 source adapter、live apply、Pipeline、Workbench、CLI、AI、Repair 或 Upgrade。SM-2 已实现固定 authoring index、loaded-source provenance、owner/path/adapter/edit plan/CAS/rollback manifest 与 `semantic.mutation-source-adapter` Contract Freeze。SM-3 才实现 lease/staging/rebuild/Delta/Impact/Verification/publish/rollback/recovery；SM-4 才接 Workbench，随后对齐 AI Task Envelope v2。

类型优先放在 mutation-specific module；公共 Compiler consumer 从 `platform/compiler/index.ts` additive export。除非出现独立 shared consumer，不扩张 `platform/shared/types.ts` 宽泛 barrel；mutation-specific IO/path/YAML helper 不修改通用 `fs.ts`、`paths.ts` 或 `yaml.ts`。Mutation 可以单向依赖 Validated IR、Fact Delta、Impact 与 Verification adapter；这些 kernel、Pipeline kernel、Projection、Repair 和 Upgrade不得反向依赖 Mutation。

Contract Freeze 按 package owner 分阶段落地，不能把未来 IO/apply sentinel 冒充 SM-1 已实现能力：

- SM-1 冻结版本/未知字段/空 ID、raw request 与 trusted context 类型隔离、完整 base/preflight binding、caller path/risk/rollback/FactDelta authority 拒绝、condition 三种 variant、exact expectation 的缺项/多项/Entity drift、首版唯一 operation/total registry/transition value-owner-by-duplicate-conflict、operation effect allowlist、Fact Delta/expectation/Impact/Verification planning 逐阶段 rejection shape、verification union 不可缩减、non-runnable/non-isolated/missing capability fail-closed、ready/early-rejected/staged-rejected plan invariant、result/Verification execution pure binding、canonical ordering、手写 digest vector、输入不变、输出 deep-frozen、deterministic repetition与 compile-time authority boundary。
- SM-2 冻结固定 authoring index、真实 loaded provenance、唯一 owner/adapter、Registry read-only/none/ambiguous owner、owner 编码与 segment-aware path-prefix、path containment/realpath/reparse/case/device/ADS/file-identity collision、UTF-8 YAML AST transition edit、source/path/edit-plan revisions、before-byte CAS 与 rollback manifest。
- SM-3 冻结 lease、staged rebuild、Verification report execution、publish/rollback CAS、request replay/revision collision、atomic publish、verified rollback、recovery 与四种真实 terminal lifecycle。

## 19. Projection

Projection API 只接受 `ValidatedEngineeringIRSnapshot`，返回单个 `SemanticView`；`buildSemanticViewSet(snapshot)` 按 Architecture → Scenario → State 生成确定性、deep-frozen bundle。

Projection 可以：

- 选择 Fact。
- 读取 Fact Assertions。
- 使用 `summarizeFactAssertions` 生成只读 authority summary。
- 为同一 Entity 聚合只读 badge / evidence references。
- 隐藏低价值细节。
- 重新标注 label/badge。
- 添加 Evidence Overlay。

Projection 不可以：

- 创造 authoritative Fact/Assertion。
- 回写 IR。
- 把 assertion summary 熔回 Fact。
- 根据 UI state 改变 semantic identity。

`inferred` badge 必须依据 Assertion summary 的 `hasInferred`，禁止再写 `fact.authority === 'inferred'`。

Provenance Overlay 必须保留 target 引用的全部 authority，并输出 `uniform / mixed / inferred / conflict` 与所有 assertions 的 confidence range。不得把最高 authority 选为整个 target 的颜色 authority，也不得隐藏低 authority assertion。

Architecture View 展示 canonical Entity 与 entity-object Fact 边；Boundary Entity 可以在没有 active `CROSSES_BOUNDARY` producer 时作为未连接节点出现，Projection 不得为连线而发明关系。Scenario View 的 value-object `RETRIES` 与 State View 的 value-object `TRANSITIONS_TO` 保留 exact value 和 Fact reference；ExplainGraph 只为图形呈现创建 `semantic-value` 可视节点，该节点不是 IR Entity 或新 authoritative Fact。

ExplainGraph、ReviewSummary 与 Workbench 是 `SemanticViewSet` consumers。ExplainGraph 节点/边保留 `ViewReference[]`，ReviewSummary 列出 canonical Fact IDs，Workbench 的 Semantic Views 页签真实显示 architecture/scenario/state 的 subject、node、relation 与 Fact 数；旧 governance tabs 不得反向成为业务语义 authority。

## 20. 持久化策略

当前 v2 Kernel 先以内存 IR 为主；不要立即新增 stable `engineering-ir.json` artifact。

满足以下条件后再稳定持久化：

1. Ticket semantic vertical 闭环。
2. 三种 Projection 共用 IR。（P0-6 已满足）
3. input/semantic revision digest 稳定。
4. CLI inspect 可用。
5. contract freeze 和 migration policy 完成。

届时建议路径：

```text
control/semantic/engineering-ir.json
```

在此之前，IR 类型/Builder 是 canonical calculation，现有 stable artifact 列表不增加路径。

## 21. v2 Kernel 完成条件

- TypeScript 类型落地。
- Builder 归一当前 App/Block/Capability/Port/Slot/Acceptance/Policy declaration 与 Loaded Semantic Contract。
- Stable Entity/Fact/Assertion ID。
- Fact identity 与 Assertion claim metadata 分离。
- Authority/Confidence/Provenance/Evidence 位于 Assertion。
- Same triple 的 distinct Assertions 无损保留。
- Referential integrity。
- 全部 SemanticPredicate 由唯一 Registry 标记 active/reserved，active variants 无歧义并在最终 Fact boundary 强制执行。
- Scenario-step identity、order、await、retry、error handler 与 acceptance/entry 全部由 canonical Facts 表达。
- `ScenarioDefinition` 只可由 Entities/Facts 重建，Scenario Projector 不读取被篡改 cache 作为 authority。
- Stable sort/inputRevision/semanticRevision digest。
- Read-only Index。
- Unit tests。
- Ticket P0-2A identity/assertion/signature/Scenario ownership vertical test。
- Compiler facade 导出。
- ExplainGraph 行为保持兼容。
