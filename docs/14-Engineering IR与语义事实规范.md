---
title: Engineering IR 与语义事实规范
status: active
last-reviewed: 2026-07-13
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
- 本合同不新增 stable `engineering-ir.json` / Fact Delta artifact；持久化仍受第 19 节约束。

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

## 18. Projection

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

## 19. 持久化策略

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

## 20. v2 Kernel 完成条件

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
