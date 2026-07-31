---
title: SEC 全球技术谱系综合与目标架构校准 v1
status: research-evidence
domain: proposal
last-reviewed: 2026-08-01
exact-main: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
tracking: issue-225
source-ledger: docs/proposals/research/sec-global-primary-source-ledger-v1.yaml
merge-policy: spike-default-no-merge
---

# SEC 全球技术谱系综合与目标架构校准 v1

> 本文不是“列出更多知名项目”，而是以 110 项规范、官方设计、原始论文和参考手册为输入，对 SEC 完整目标架构做机制级校准。它仍是 Spike Evidence，不是 canonical authority，不表示所述能力已经实现。所有结论必须经过后续聚焦文档变更、代码合同、测试、形式模型和物理 Evidence 才能进入 `main`。

## 0. 关于“搜全世界所有信息”的准确边界

不存在可证明穷尽全球全部论文、闭源系统、内部设计、历史经验和未来研究的搜索。工程上可验证的替代目标是：

1. 建立公开、可重复、按技术家族分层的一手资料检索方法；
2. 优先规范、官方设计和原始论文，而不是营销、榜单和二手总结；
3. 每项来源必须回答“改变 SEC 哪个设计、为何”；
4. 对已覆盖家族、未覆盖家族、来源成熟度和冲突观点建立账本；
5. 新资料只在提供新机制、新反例、新不变量或推翻旧假设时改变设计；
6. 不用引用数量冒充架构正确性。

当前 110 项来源覆盖编译器、语言服务、静态分析、增量系统、形式方法、授权、安全沙箱、事务恢复、分布式一致性、测试、Web、组件 ABI、配置收敛、供应链、API/事件、可观测性、依赖解析和 AI 工具协议。仍需真实 benchmark、模型检查、平台测试和用户语料的部分在本文末尾列出。

## 1. 全球技术谱系带来的十二项总校准

上一版“多领域工程语义编译器 + 受治理变更平台”的总方向成立，但全球机制审计要求进一步冻结以下十二项设计。

### 1.1 从“模型联邦”提升为 Model Federation Kernel

不能只说“有六张图”。必须有一个极小、稳定、语言无关的联邦内核，统一拥有：

```text
DomainDescriptor
SchemaRevision
ObjectIdentity
ObjectRevision
Reference
AuthorityClass
ValidationResult
Coverage
UnknownFrontier
ProjectionBinding
MigrationBinding
```

联邦内核只规定跨 domain 的共同协议，不规定每个 domain 的对象字段。它对应 MLIR dialect/interface 的结构性优点，但比 MLIR 更严格地区分 authority、Evidence 和 projection（SRC-002～SRC-005）。

永久禁止：

- 一个 `Node { type: string; properties: Record<string, unknown> }` 充当所有模型；
- 一个全局 edge kind registry 同时表达 source reference、semantic dependency、Impact、Evidence 和 workflow order；
- domain 在 consumer 中通过字符串 switch 重新解释其他 domain；
- 跨域引用复制整个目标对象而不是稳定 identity/revision。

### 1.2 每项合同必须是“三元合同”

普通 schema 只约束 shape，无法表达工程语义。SEC 的任何公共能力至少包含三部分：

```text
Structural Contract
  字段、类型、identity、reference、ordering

Semantic Contract
  precondition、postcondition、invariant、state transition、compatibility

Operational Contract
  Effect、permission、resource、failure、timeout、cleanup、recovery
```

JSON Schema、OpenAPI、AsyncAPI 等适合结构和互操作，但不能取代状态、Effect 和事务语义（SRC-074、SRC-087～SRC-089）。WebAssembly 的“声明式规范 + sound/complete 验证算法”证明了稳定语义规范和可执行 validator 应当并存（SRC-010、SRC-011、SRC-101）。

### 1.3 Source 必须同时保留 bytes、lossless tree 和 semantic model

源码操作不能只选 AST 或文本 patch。最终分层：

```text
Source Bytes / Encoding / Mode
→ Lossless Syntax Tree
→ Language Semantic Model
→ Source Program Model
→ Responsibility Candidates
→ Canonical Engineering Semantics
```

- bytes 层拥有精确内容、编码、换行、mode；
- LST 层拥有 token、trivia、格式、错误恢复和局部重写；
- language semantic model 拥有 symbol、type、module resolution、CFG/dataflow；
- Source Program Model 归一化多个 Provider 输出；
- Responsibility 层建立工程 obligation；
- Engineering IR 只接受被 Reconcile 的 canonical semantics。

Roslyn、Tree-sitter、OpenRewrite 和 Clang 分别证明这些层不能由一个结构替代（SRC-012～SRC-016）。

### 1.4 Effect 必须成为一等代数，而不是字符串标签

SEC 已有 Effect 概念，但最终需要可组合的 Effect Algebra：

```text
EffectKind
ResourceType
CapabilityRequirement
ReadWriteMode
DeterminismClass
IdempotencyClass
CompensationClass
IsolationRequirement
FailureSet
ObservabilityRequirement
```

Effect relation至少支持：

```text
subeffect
requires-capability
conflicts-with
commutes-with
must-precede
compensated-by
observed-by
verified-by
```

Koka 的 effect row/handler 证明“函数结果类型以外的作用”可以静态组合；WASI capabilities 证明能力应以显式 import/handle 传递，而不是 ambient authority（SRC-045、SRC-047、SRC-100）。SEC 不实现一门新 effect language，但必须把这些性质作为工程合同。

### 1.5 增量计算需要“查询契约审计”，不仅是缓存 key

最终 Compiler Query Contract：

```yaml
queryId:
implementationRevision:
inputKeySchema:
declaredInputs:
discoveredDependencies:
outputSchema:
outputFingerprint:
determinismClass:
resourceClass:
cancellationBoundary:
validationOwner:
invalidationOwner:
cleanOracle:
```

每个 query 必须证明：

1. 所有读取都经 query context 或显式 Provider；
2. 不读取 ambient cwd、clock、locale、environment、network；
3. 动态依赖被记录；
4. 输入改变只扩大 dirty set；
5. 重算后输出未变可阻止下游传播；
6. clean 与 incremental bytes/diagnostics 等价；
7. cache 可删除、损坏可检测、不能成为 authority。

Skyframe、DICE、Salsa、Pluto、Nix 和 Build Systems à la Carte 共同支持这一校准（SRC-025～SRC-031）。

### 1.6 Lowering 正确性必须增加 Translation Validation 层

测试与 deterministic bytes 仍不足以证明复杂 lowering 保持语义。SEC 应分层采用：

```text
Validator proof obligations
Property/differential tests
Translation validation per candidate
Formal proof for tiny trusted kernels
Runtime acceptance
```

- 对 pure normalizer、identity、type compatibility 可做 property/model proof；
- 对 Behavior IR → Target Program IR 的高价值规则可做 refinement/translation validation；
- 对 Backend AST/bytes 使用 round-trip/typecheck/runtime differential；
- 对复杂 opaque algorithm 不伪造完整证明。

CompCert 表明完整证明可行但成本巨大；Alive2 表明逐次 translation validation 能在现实编译器中发现 unsound transformation，同时必须显式列出 unsupported 范围（SRC-033、SRC-034）。

### 1.7 所有长期状态必须采用 Condition + observedRevision

仅有 `status: ready|failed` 会让旧结果附着到新输入。统一 Condition：

```yaml
conditionType:
status: true | false | unknown
reasonCode:
message:
observedRevision:
producerRevision:
evidenceRefs: []
lastTransitionIdentity:
```

适用对象：

- support claim；
- Provider readiness；
- Work Package readiness；
- source adoption；
- migration；
- release promotion；
- recovery；
- domain completeness。

Kubernetes `observedGeneration` 和标准 Conditions 证明了观察必须绑定被观察版本；`Unknown` 是真实状态，不得映射为 False 或 Ready（SRC-072、SRC-103）。

### 1.8 Publication 必须区分逻辑 commit 与物理 durability

最终 publication protocol：

```text
prepare immutable write-set
→ persist intent/journal
→ stage bytes + metadata
→ persist stage receipt
→ publish files/directories
→ persist publication marker
→ fsync/physical durability proof where supported
→ canonical readback
→ verification
→ terminalize
```

终态必须至少区分：

```text
not-published
published-not-durability-proven
published-durable
rolled-back-durable
recovery-required
```

SQLite、ARIES、PostgreSQL WAL 共同说明：写 API 返回、rename 成功或文件存在不能单独证明 durable transaction；恢复需要日志、generation、redo/undo 和明确的 hot/incomplete 状态（SRC-050～SRC-052）。

### 1.9 AI/Provider 安全需要双层授权

第一层是 SEC 语义授权：

```text
principal × typed operation × semantic resource × context
```

第二层是 OS/runtime capability：

```text
filesystem handles
network endpoints
process/syscall surface
browser/native capabilities
secret handles
```

语义允许不等于物理进程获得 ambient host 权限。物理 sandbox 也不能替代语义 authorization。Cedar、WASI、Landlock、seccomp 分别提供 default-deny、capability handle、filesystem/network attenuation 和 syscall surface reduction（SRC-041、SRC-047～SRC-049）。

### 1.10 并发模型必须明确选择，而不是抽象为“支持并行”

SEC 不应默认为 canonical state 使用 CRDT 自动合并。最终并发政策：

- canonical source/semantic mutation：单 writer + CAS + linearizable observable transition；
- independent Work Packages：在机器证明 authority/write/resource 分离后并行；
- read-only query：immutable snapshot 并行；
- derived cache：可并行构建，按 content identity 去重；
- UI annotations、presence、临时协作草稿：可选 CRDT；
- remote multi-node authority：未来出现真实需求后再引入 consensus。

Linearizability 为 workspace operation 定义可观察原子点；CRDT 只适合其代数前提成立的可合并状态，不能保护任意工程 invariant（SRC-054～SRC-056）。

### 1.11 兼容性必须成为多维代数

SemVer 只是对外信号，不能证明真实兼容。Compatibility Matrix：

```text
source
binary
wire
schema-read
schema-write
behavior
error
permission/effect
runtime-host
toolchain
target
platform
data-migration
rolling-deployment
rollback
```

每一维为：

```text
compatible
conditionally-compatible
incompatible
unknown
not-applicable
```

并绑定 producer/consumer direction。Protobuf field identity、Cargo resolver、PubGrub incompatibility derivation、Node exports 和 SemVer 分别提供字段演进、全图解、可解释冲突、公共面封装和发布信号（SRC-086、SRC-092～SRC-095）。

### 1.12 支持声明必须有完整闭包，不再是布尔值

最终 `SupportClaim`：

```yaml
subject:
capability:
profile:
implementationRevision:
providerRevisions: []
requiredEnvironments: []
verificationClaims: []
packageRelease:
deploymentEvidence:
knownLimitations: []
unknownFrontier: []
condition:
```

支持 HTML、Node、Windows、某 Provider 或某 Block 不能只写 `supported: true`。需要实现、owning environment、clean package、release、实际消费和持续失效策略。

## 2. 编译器与 IR：吸收多层结构，拒绝 IR 帝国化

### 2.1 LLVM、GCC、JVM、CLI 和 WebAssembly 的共同启示

这些系统都通过中间表示或验证格式降低复杂度，但表示服务于特定目标：

- LLVM IR 服务低层优化/代码生成；
- GIMPLE 服务 GCC 中层变换；
- JVM classfile/CIL 服务可验证执行环境；
- Rust MIR 服务 flow-sensitive checks 和 lowering；
- WebAssembly typed bytecode 服务可移植、安全验证和执行。

因此 SEC 的 Engineering IR 不能承担 Target Program IR 的职责；Behavior IR 也不能表达任意业务知识。最终层次保持：

```text
Engineering IR
→ Application IR
→ Behavior IR / Governed Extension
→ Target Program IR
→ Backend / Runtime Artifact
```

### 2.2 Dialect/Domain 协议

每个 domain 必须发布：

```yaml
domainId:
schemaRevision:
objectKinds: []
referenceKinds: []
authorityIngress:
rawBuilder:
validator:
canonicalOrdering:
identityDeriver:
revisionDeriver:
queryProvider:
projectionProviders: []
migrationProtocol:
unsupportedProtocol:
```

算法通过 interface/capability 查询对象，不依赖具体类名和字符串 tag。新语言/框架只添加 Provider/dialect，不修改 Core 业务分支。

### 2.3 E-graph 的精确位置

Equality saturation 适用于：

- pure expression normalization；
- target-independent equivalent rewrite；
- query/plan optimization；
- source transform candidate exploration；
- synthesis with explicit cost and proof obligations。

它不适用于：

- 从源码猜业务责任；
- 合并冲突 authoritative facts；
- 自动决定 Effect/permission 等价；
- 不受预算控制地扩展全工程图。

任何 e-graph Provider 需要：typed rewrite rules、side conditions、termination/budget、extraction cost、proof witness、translation validation 和 fallback。

## 3. Source Program Model 与 Responsibility Reconstruction

### 3.1 Source artifact 分类

每个 artifact 先进入物理分类：

```text
authoring
governed
generated
vendor
external
binary
secret
protected
opaque
temporary
control-state
```

分类带 owner、revision、write policy、preservation policy、parser Provider、build target 和 cleanup protocol。Unknown 不能默认 text/source。

### 3.2 Language Provider 输出

```yaml
providerIdentity:
providerRevision:
languageRevision:
sourceRevision:
coverage:
syntaxTreeRef:
symbols: []
types: []
references: []
controlFlow: []
dataFlow: []
stateAccesses: []
effects: []
errors: []
frameworkBindings: []
diagnostics: []
unknownRegions: []
```

Provider 输出不直接成为 Engineering IR。多个 Provider 冲突保留 competing explanations。

### 3.3 Responsibility Candidate 的新判据

上一版按十类 facet 提取仍正确，但需要增加四个维度：

1. **Consistency boundary**：操作属于哪个原子/最终一致性区域；
2. **Capability boundary**：需要什么不可伪造资源/权限；
3. **Observability boundary**：通过什么信号判断履约；
4. **Compatibility boundary**：哪些 consumers/versions 依赖该行为。

候选 identity 不使用 AI 摘要。Identity 应优先由 accepted obligation、owner、contract namespace 和稳定 source bindings 派生。

### 3.4 Utility、Adapter 和 Responsibility 的分离

- Utility：无独立工程 obligation，仅实现复用计算；
- Adapter：在两个明确协议间转换，拥有 compatibility/error/effect；
- Responsibility：对系统或用户承担可验证 obligation；
- Block：对分发、版本、信任、迁移承担封装责任。

调用频率、函数长度和 graph community 不能单独决定分类。

## 4. Type、Effect、State 与 Error 代数

### 4.1 Type Algebra

除现有 primitive/nominal/enum/optional/list/map/record/union/result/async/stream 外，必须显式支持：

- recursive and co-recursive identity；
- variance；
- refinement/constraint reference；
- ownership/resource handles；
- serialization representation；
- opaque external type；
- versioned schema identity；
- Target capability requirements。

### 4.2 State Machine Contract

```yaml
stateMachineId:
owner:
states: []
initialStates: []
terminalStates: []
transitions:
  - id:
    from:
    to:
    trigger:
    guard:
    effects: []
    authorization:
    transaction:
    errorOutcomes: []
    compensation:
    verification: []
concurrencyPolicy:
livenessProperties: []
safetyProperties: []
```

SCXML 可作为交换/参考，TLA+/Alloy 用于关键协议反例；canonical schema 由 SEC 自己拥有（SRC-037～SRC-040）。

### 4.3 Error Protocol

错误不是 message。公共 Error Definition：

```text
stable code
owner
phase
retry class
idempotency implication
user visibility
security classification
compensation/recovery
cause references
diagnostic payload schema
```

transport、Provider 和 Target 可以映射，但不能重新分类 terminal state。

## 5. Query、Index、Cache 和 Materialization

### 5.1 四种不同对象

```text
Query Result
Derived Index
Physical Cache Entry
Materialized Resource
```

- Query Result：确定性函数结果；
- Derived Index：从 canonical/source inputs 重建的查询加速结构；
- Cache Entry：物理存储，可损坏/删除；
- Materialized Resource：node_modules、browser、toolchain、native binary 等实例，带平台和生命周期。

不能用一个 `.sec/cache` 目录统一处理。

### 5.2 Materialization Responsibility

借鉴 LLVM ORC 的 MaterializationUnit/Responsibility：每个 lazy Provider 声明自己能提供什么、依赖什么、何时 ready、失败后通知哪些等待者、如何释放资源（SRC-102）。SEC 用于：

- language indexes；
- browser/toolchain assets；
- optional external graph；
- expensive semantic projections；
- package/build outputs。

Materialization 完成只证明资源可用，不证明 semantic/support claim。

## 6. Delta、Impact 与等价关系

### 6.1 Delta 分层

```text
Byte Delta
Syntax Delta
Source Semantic Delta
Engineering Fact/Responsibility Delta
Compilation IR Delta
Artifact Delta
Runtime Observation Delta
Support/Decision Delta
```

每层有独立 comparator 和 lineage。空上一层 Delta 不推出下一层无变化；例如格式变更可能 Byte Delta 非空但 Semantic Delta 为空，Provider 版本变化可能 source bytes 不变但 analysis revision 变化。

### 6.2 等价关系不是一个布尔值

```text
byte-equal
syntax-equivalent
source-semantics-equivalent
engineering-contract-equivalent
target-behavior-refinement
runtime-observation-equivalent
compatible-under-profile
```

每个等价声明绑定 verifier、assumptions、unsupported、counterexample 和 proof revision。

### 6.3 Impact Witness

每个 Impact item至少包含：

```yaml
seed:
target:
certainty: definite | possible | unknown
witness:
  - domain:
    relation:
    from:
    to:
rules: []
unknownBoundary:
verificationRecommendations: []
```

没有 witness 的“高风险”只能是 decision heuristic，不能是 canonical Impact。

## 7. Verification、测试质量和反例体系

### 7.1 Verification Object Model

```text
Requirement
Applicability Proof
Gate Definition
Execution Plan
Execution Record
Gate Result
Claim Definition
Claim Result
Evidence Node
Aggregate Decision
```

它们不能合并为一个 JSON report。

### 7.2 测试组合

每个核心合同按性质选择：

- example tests：已知场景；
- property tests：不变量和输入空间；
- model tests：状态机和时序；
- differential tests：old/new、clean/incremental、provider A/B；
- fuzz tests：parser/validator/decoder；
- mutation tests：测试是否真正拒绝错误；
- fault tests：publication、resource、process、network；
- concurrency tests：race、CAS、lease、cancellation；
- physical acceptance：真实 platform/browser/package；
- translation validation：lowering refinement。

QuickCheck、libFuzzer、OSS-Fuzz、TSan、ASan 和 PIT 各自证明不同缺陷类别，不能互相替代（SRC-057～SRC-061、SRC-107）。

### 7.3 Counterexample Registry

所有自动产生的反例统一保存：

```yaml
counterexampleId:
producer:
producerRevision:
propertyOrModel:
seed:
minimalInput:
expectedInvariant:
observedFailure:
replayCommand:
fixedByRevision:
retention:
```

反例进入 corpus，但不自动成为 canonical semantic Fact。

## 8. Mutation、事务和恢复

### 8.1 Plan 是不可变、可比较的承诺

Plan identity 绑定：

- operation schema/revision；
- authorization；
- base source/semantic revisions；
- target Responsibility/facet；
- source path proof；
- expected writes/deletes/renames/modes；
- predicted Delta/Impact；
- Verification minimum；
- provider/toolchain/profile revisions；
- expiry。

Apply 必须在 lease 中重新构建 equivalent plan。Equivalent 不是字符串相等，而是 write-set、precondition、must-preserve、authorization 和 required Verification 等价。

### 8.2 WAL-like Journal

Journal event 至少：

```text
transaction-opened
base-proved
staging-written
staging-persisted
preverification-recorded
publish-started
path-published
publication-marker-persisted
durability-proved
readback-rebuilt
postverification-recorded
rollback-started
path-restored
terminal-recorded
cleanup-recorded
```

每个事件 immutable、generation-bound、idempotent replay。Compaction 只在 terminal、readback、retention 和无后继引用全部证明后执行。

### 8.3 Durable orchestration 边界

Development/Mutation workflow 可以吸收 event-history replay，但所有 orchestrator code 必须 deterministic；clock/random/network/tool execution 经显式 activity/provider。长运行流程的代码升级需要 version marker 或 continue-as-new 策略（SRC-053）。

## 9. 并行、协作和分布式边界

### 9.1 本地单写者是正确基线

SEC 初期不需要分布式 consensus。一个 workspace writer + immutable snapshots + CAS 已足够，并显著减少状态空间。

### 9.2 Work Package 并行

只有以下全部成立才并行：

```text
authority writes disjoint
state writers disjoint
artifact writers disjoint
paths compatible
resources isolated
producer/consumer order known
verification independently keyable
integration order known
```

Git 无文本冲突不证明 safe。

### 9.3 CRDT 的限定用途

允许：

- UI layout；
- comments/annotations；
- presence；
-未接受 proposal 草稿；
-可以定义 join-semilattice 的 derived collection。

禁止默认用于：

- canonical source bytes；
- semantic facts with authority conflict；
- migration terminal；
-permission/policy；
- release promotion；
- transaction publication。

## 10. Web 前端的完整模型

HTML/CSS/DOM/ARIA 全球标准进一步确认至少需要七个不同对象：

```text
Source HTML/Template Tree
Framework Component/Render Model
Runtime DOM
Source CSS Rule Graph
Cascade/Computed Style Model
Layout/Paint Observation
Accessibility Tree/Name Computation
```

它们通过 source/runtime Evidence 引用，但不合并。

### 10.1 Web Impact 示例

改变一个 class token 可能传播：

```text
TS/TSX expression
→ rendered class candidate
→ CSS selector candidates
→ cascade layers/specificity
→ responsive/container query
→ runtime DOM/CSSOM
→ accessibility visibility/focus
→ browser acceptance
```

动态字符串、CSS-in-JS、third-party injection 形成 possible/unknown，不伪造完整 closure。

### 10.2 Web 支持声明

每种 artifact/provider 独立 L0–L7。浏览器版本、rendering mode、hydration、framework adapter、bundler 和 accessibility profile 都进入 Target/Verification closure。

## 11. Block、Registry、依赖和兼容

### 11.1 Block Contract Bundle

```text
Manifest
Semantic Contract
Port/Capability
Effect/Permission
Generator declarations
Source/assets
Tests/Acceptance
Compatibility matrix
Migration
SBOM/license/provenance
Signature/trust metadata
```

Block version、Contract schema、Generator protocol、Provider ABI、Target compatibility 分域版本化。

### 11.2 Resolution

使用 PubGrub 风格 incompatibility derivation，而不是简单“最高版本”或回溯黑盒：

- 每个拒绝有可解释 incompatibility chain；
- source/trust/Target/provider constraints 与 version 一起求解；
- unresolved/ambiguous fail closed；
- lock 绑定 exact registry source/digest/policy；
- compatible duplicate version 是否允许由类型/ABI/public surface决定。

### 11.3 升级

升级 plan 从实际 Contract/consumer delta 推导 SemVer 建议，而不是相信版本号。Public exports、wire fields、behavior、Effect、permission 和 data migration 单独分析。

## 12. Supply Chain、Release 和 Provenance

### 12.1 五种 provenance 永久分开

```text
Fact Provenance
Artifact Provenance
Verification Evidence
Runtime Observation
Decision Provenance
```

SLSA/in-toto/PROV/SPDX/CycloneDX 是交换标准，不替代这些内部模型（SRC-078～SRC-085）。

### 12.2 Release Closure

```text
clean source/materials
→ trusted builder/toolchain
→ deterministic build
→ artifact digest
→ SBOM/license
→ verification claims
→ signature/attestation
→ transparency inclusion
→ promotion/publication receipt
→ consumer install/deploy evidence
```

每层失败或 unknown 单独显示。

### 12.3 Secure update

Registry/CLI 自更新阶段采用 TUF 风格 role separation、threshold signatures、version/expiry、rollback/freeze protection。Rekor 提供透明日志 Evidence，但签名存在不代表内容安全。

## 13. Event、API 和可观测性

### 13.1 Event Contract

```yaml
eventIdentity:
semanticType:
producerResponsibility:
payloadType:
schemaRevision:
ordering:
delivery:
idempotency:
partitioning:
privacy:
consumers: []
failureAndDeadLetter:
compatibility:
```

CloudEvents 只统一 envelope；AsyncAPI 只统一事件 API 描述；业务语义由 SEC Contract。

### 13.2 Observability

OpenTelemetry semantic conventions可作为 runtime observation 的稳定属性词汇。每条 observation 必须绑定 source/runtime/release/environment revision、采样和 coverage；未观察到不能证明不存在。

OpenLineage适合数据 job/run/dataset lineage 互操作，但不覆盖 source/semantic/release 全域 Provenance。

## 14. AI Runtime 与工具生态

### 14.1 MCP/LSP/BSP/DAP 都是 transport

这些协议解决互操作和消息 shape，不拥有：

- semantic target；
- authority；
-source owner；
-Impact；
-risk；
-Verification；
-terminal state。

SEC Adapter 必须将外部 tool 映射为 typed query/action，并声明 Effect、capability、input/output schema、freshness、privacy 和 Evidence。

### 14.2 AI Operation Contract

```yaml
operationId:
version:
principalClasses: []
targetKinds: []
callerParameters:
derivedFields:
forbiddenCallerFields:
requiredContext:
allowedEffects:
forbiddenEffects:
sourceOwnershipRequirements:
mustPreserve:
verificationMinimum:
budget:
proposalSchema:
```

AI 只产生 proposal。即使 MCP OAuth 成功，也未获得语义授权。

### 14.3 Context Packet

按结构逐层下钻：

```text
Task/authorization
→ Responsibility/Contract/Impact
→ source bindings/type signatures
→ focused source/tests
→ only-if-needed adjacent context
```

每次扩张有 reason 和 budget，搜索命中不自动加入 writable set。

## 15. Documentation 与 Architecture View

ISO 42010 的 concern/viewpoint/view 进一步证明：Workbench 不应追求一张“完整工程图”。Canonical state 提供多种引用一致的视图：

- responsibility architecture；
- state/transaction；
- data/effect；
- security/trust；
- source ownership；
- target compilation；
- Impact；
- Evidence；
- release/operations。

每个 view 声明：stakeholder、concerns、selection rules、layout、omissions、unknown projection 和 source references。View 不反写 canonical state。

## 16. 形式化与验证投资边界

### 16.1 TLA+ 优先对象

- workspace write lease；
- mutation publication/recovery；
- candidate epoch；
- integration queue；
- Evidence terminal/reuse；
- release promotion。

检查 safety、liveness、deadlock、stale generation、crash transitions。

### 16.2 Alloy 优先对象

- identity/reference uniqueness；
- authority ownership；
- Work Package relations/cycles；
- Block resolution constraints；
- source/responsibility many-to-many；
- domain schema composition。

### 16.3 不形式化一切

普通业务行为以 Contract + property/acceptance 为主。只有高复用、小状态空间、错误代价高的内核进入 mechanized/formal proof。

## 17. 机器合同与生成要求

最终所有核心 schema 应具有：

```text
single canonical schema/type source
→ generated parser/validator/doc/schema projection
→ handwritten semantic invariants
→ property/fuzz/mutation tests
→ compatibility/migration contract
```

避免 TypeScript type、JSON schema、CLI parser、docs 示例和 test fixture 五处复制字段。

## 18. 对当前 SEC 提案的采纳/修正

### 保留

- Authority / Canonical / Evidence / Projection 四分；
- 多模型而非万能图；
- stable identity 与 revision 分域；
- TypeScript-first；
- Responsibility 多对多；
- semantic mutation 事务；
- Verification 五态；
- AI proposal-only；
- Web Provider 分层；
- Block 非默认理解单位；
- self-hosting 阶梯。

### 加强

- 增加 Model Federation Kernel；
- Contract 三元化；
- Effect Algebra；
- Query Contract Audit；
- Translation Validation；
- Condition/observedRevision；
- durability 分级；
-双层授权/沙箱；
-Compatibility Algebra；
-Counterexample Registry；
-Materialization Responsibility；
-Event/Observability Contract。

### 明确拒绝

- 通用 property graph 作为 Core；
- CRDT 自动合并 canonical mutation；
- MCP/LSP/OPA/CodeQL/Bazel/Nix 等外部系统成为 authority；
- 用 SemVer、签名、SBOM、测试绿或 provenance 单独证明支持；
- 用 browser snapshot 作为 source；
- 用 cache/journal/state 文件作为产品语义；
- 用 AI confidence 补 unknown。

## 19. 从研究到正式实现的拆分顺序

本研究不能整体合并。建议拆为以下 focused canonical deltas：

1. **Model Federation + Contract Triad authority**：更新 system architecture/semantic model，冻结最小跨域协议。
2. **Source Representation Contract**：bytes/LST/language semantics/SPM/source binding。
3. **Responsibility + Effect Algebra**：吸收 #224，增加 consistency/capability/observability/compatibility facet。
4. **Verification Object Model + Conditions**：在 #215 后统一 applicability/environment/claim/observedRevision。
5. **Query Contract Kernel**：#194 Phase 1 前冻结 query audit 与 clean oracle。
6. **Publication Durability Protocol**：semantic mutation/journal/recovery正式状态机与 TLA+ model。
7. **Provider Capability + Sandbox Contract**：Host/Provider 双层授权，Linux/Windows/WebAssembly adapters。
8. **Compatibility Algebra + Registry Resolver**：Block/Provider/Target/Schema/Release 多维兼容。
9. **Event/Observability/Provenance Interop**：仅在真实 runtime/release consumer出现后。
10. **Web multi-tree model**：TypeScript Self-Observation闭环后进入。

## 20. 不可由研究直接确定的真实未知

以下必须通过实验而不是继续写设计：

- 当前 SEC compiler clean/warm 各 pass 的 CPU、wall time、memory 和 critical path；
- TypeScript Compiler API、ts-morph、Tree-sitter、CodeQL 在目标 corpus 的 coverage/latency/memory；
- Responsibility candidate 的 precision/recall 和人工 Reconcile 成本；
- LST round-trip 对 comments/format/unowned regions 的稳定性；
- Impact graph 在真实 monorepo 的 edge 数量和 fixpoint成本；
- Windows NTFS、Linux ext4、WSL、macOS APFS 的 rename/fsync/reparse/process settlement差异；
- Node/Bun Host 和 Node/Bun/Browser Target 的 package/runtime physical matrix；
- Landlock/seccomp/WASI 在不同平台可提供的真实 capability；
- translation validation 可覆盖的 Behavior IR 子集；
- TLA+/Alloy 模型发现的反例；
- HTML/CSS/TSX/framework Provider 对动态区域的 coverage；
-用户是否真正需要 remote multi-node authority、CRDT collaboration 或 remote execution。

这些 unknown 必须生成 Spike/benchmark/fault Evidence，不能以“全球最佳实践”替代。

## 21. 最终结论

全球技术谱系没有否定 SEC，反而强化了它的独特位置：

- 现有编译器擅长程序表示和 lowering，但不拥有工程 authority；
- 代码图擅长观察关系，但不是 canonical semantics；
- 构建系统擅长增量和缓存，但不拥有业务/工程责任；
- policy 引擎擅长决策，但不派生 source owner/Impact；
-工作流系统擅长 replay，但不拥有 semantic transaction；
-供应链标准擅长互操作 provenance，但不证明 correctness；
-AI 协议擅长连接工具，但不提供语义治理。

SEC 应把这些成熟机制组合在一个严格单写者、分域 authority、可验证的工程语义架构中。真正“不妥协”的含义不是自行重造每个轮子，而是：

> 对每一种外部能力，精确吸收它已经解决的问题，同时永远不让它越权成为 SEC 的工程事实、权限、Impact、Verification 或发布裁决者。
