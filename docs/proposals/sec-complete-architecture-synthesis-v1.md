---
title: SEC 完整目标架构综合 v1
status: draft
domain: proposal
last-reviewed: 2026-08-01
exact-main: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
tracking: issue-225
merge-policy: spike-default-no-merge
---

# SEC 完整目标架构综合 v1

> 本文是基于 `main@6cc3bf8a3b655bebf85dfca3f065c9842207c086`、当前 canonical authority、开放 Program/Issue 与外部一手机制形成的总装 **proposal**。它不是第二份产品、路线、当前状态或架构 authority，不表示任何目标能力已经实现。评审通过后只能拆分为聚焦 canonical 文档更新与正式 Work Package，禁止整体直接合并。

## 0. 最终裁决

SEC 的最终产品定义是：

> **一个确定性的、多领域的工程语义编译器，以及建立在其上的受治理工程变更平台。**

它把产品意图、已有源码、配置、测试、运行观察和工程政策编译为可验证的 canonical Engineering Workspace；再从该状态确定性地产生源码、测试、文档、Gate、Agent、Release、Explain/Impact 与 Workbench 投影；所有变化通过受权限约束的语义操作、事务、Evidence 和恢复协议闭环。

SEC 不是：

- 一个代码知识图；
- 一个模板或脚手架市场；
- 一个把函数机械拆成 Block 的低代码平台；
- 一个万能 AST 或万能 IR；
- 一个直接让 AI 修改任意文件的 Agent 框架；
- 一个私有运行时；
- 一个依赖某种语言、框架、Host、数据库或构建工具的专用生成器；
- 一个承诺自动还原任意程序全部业务语义的反编译器。

“没有妥协”不等于一次实现所有语言和生态，而是以下永久不变量不可为交付速度让步：

1. authority、canonical state、Evidence 与 projection 永不混淆；
2. unknown、ambiguous、conflicted、stale、unsupported、opaque 永不伪装为已知或 PASS；
3. 每个 canonical identity、state、writer、selector、validator、producer 只有一个 owner；
4. AI、Provider、Workbench、CLI、PR、Issue、文档和测试都不能越权创建事实；
5. 相同受验证输入产生 byte-stable canonical 结果；
6. 增量路径与 clean 路径语义等价；
7. 未执行、环境不归属、影响未知、cleanup 未闭合、Evidence 陈旧绝不 PASS；
8. mutation 不存在 partial-success；发布失败必须 rejected、rolled-back 或 recovery-required；
9. Core 不因新增业务、语言、框架或工具增加名称特化分支；
10. 所有支持声明必须区分设计、实现、物理验证、分发和现实支持层级。

## 1. 为什么不能有一个万能 IR、万能图或万能状态机

软件工程中至少存在六种本质不同的关系网络：

1. **Source Program Graph**：文件、语法、symbol、type、reference、control/data flow、framework binding；
2. **Engineering Semantic Graph**：Entity、Fact、Assertion、Responsibility、Contract、State、Policy、Permission、Effect、Acceptance；
3. **Target Compilation Graph**：Target Profile、Type Algebra、Application/Behavior/Target Program IR、Backend、Artifact；
4. **Delta / Impact Graph**：from/to semantic endpoint、变化、传播规则、witness、unknown frontier；
5. **Verification / Evidence Graph**：Gate Definition、Execution、Result、Claim、Evidence、Provenance、freshness；
6. **Operational Graph**：Mutation transaction、development epoch、resource generation、journal、recovery、integration order。

这些图可以通过 stable identity 与 revision 连接，但不得合并为一个“所有边都是关系”的万能图。原因是：

- 它们的 authority 不同；
- identity 和 revision 域不同；
- 更新频率、失效规则、确定性和生命周期不同；
- 某个图的路径方向不代表另一个图的影响方向；
- 某个图的 Evidence 不能成为另一个图的 canonical Fact；
- 一个通用 edge/property bag 会把 schema、validator 和查询语义推回字符串猜测。

因此最终结构是：

```text
统一 Authority / Identity / Revision / Validation Kernel
                    │
        ┌───────────┼───────────┐
        │           │           │
  正交 Domain   正交 Graph   正交 Journal
        │           │           │
        └────── stable references ──────┘
```

不是一个万能模型，而是一个统一规则下的模型联邦。

## 2. 四个平面

### 2.1 Truth Plane

拥有谁可以声明什么、哪个对象是 canonical、哪些只是观察和投影：

```text
Authority Input
→ Raw Candidate
→ Validate / Reconcile
→ Immutable Canonical Snapshot
→ Projection / Evidence Reference
```

### 2.2 Compilation Plane

把 canonical semantics 降低为特定 Target：

```text
Validated Engineering Workspace
→ Target Profile + Type Algebra
→ Application IR
→ Behavior IR / Governed Extension
→ Target Program IR
→ Backend AST / bytes
→ Artifact + Provenance
```

### 2.3 Operation Plane

拥有变化、事务和恢复：

```text
Intent
→ Authorization
→ Plan
→ Isolated Candidate
→ Actual Delta / Impact / Verification Plan
→ Apply under writer lease
→ Publish / Readback
→ accepted | rejected | rolled-back | recovery-required
```

### 2.4 Governance Plane

拥有开发选择、验证、Evidence、发布和 AI 边界：

```text
Work Selection
→ Task Capsule / Change Closure
→ Work Package / Candidate Epoch
→ Verification / Review / Merge Authority
→ main readback / cleanup / replan
```

四个平面不能互相建立第二状态机。Operation Journal 不拥有 Engineering semantics；Development Run Journal 不拥有 Mutation terminal；Verification Result 不拥有 task selection；Workbench 不拥有 authorization。

## 3. 完整数据流

```text
Product Intent / Existing Workspace
        │
        ▼
Authoring Sources + Repository Inventory
        │
        ├─ Language / Framework / Build / Runtime Providers
        ▼
Versioned Source Program Models
        │
        ▼
Candidate Extraction + Reconciliation
        │
        ▼
Validated Engineering Semantic Domains
        │
        ▼
Validated Engineering Workspace Snapshot
        │
        ├───────────── Query / Impact / Explain
        │
        ├───────────── Workbench / Context Packet / AI proposal
        │
        ▼
Target Compilation Snapshot
        │
        ▼
Source / Config / Test / Docs / Gate / Release Artifacts
        │
        ▼
Verification Executions + Evidence DAG
        │
        ▼
Governed Mutation / Upgrade / Recovery
        │
        └───────────── canonical rebuild
```

任何箭头都必须有唯一 producer、typed input/output、revision、validator、diagnostic、cache/invalidation owner 和 failure protocol。

## 4. 唯一身份与 revision 代数

以下身份域永久分离：

| 域 | 典型身份 | revision 绑定 |
|---|---|---|
| Repository | workspace、package、artifact path binding | Git/object/source inventory |
| Source | source artifact、symbol、span binding | content + language/provider revision |
| Semantic | Entity、Fact、Assertion、Responsibility、Contract | canonical semantic payload |
| Workspace Domain | Documentation、Workflow、Agent、Release 等 | 各 domain validated revision |
| Compilation | Profile、Type、IR node、pass result | validated inputs + pass/provider revision |
| Artifact | generated file/package/release object | producer inputs + bytes |
| Verification | Gate、Execution、Claim、Evidence | exact input/environment/producer closure |
| Mutation | operation、plan、transaction、publication | authorization/base/source/journal generation |
| Development | work decision、capsule、epoch、candidate | exact main/manifest/head/policy |

永久禁止：

- 随机 UUID 作为可重建 canonical identity；
- 绝对路径、行号、数组位置、UI 坐标、branch、PR 编号、wall-clock 进入 semantic identity；
- 用一个 `revision` 字段同时表示 source、semantic、artifact、transaction 和 Evidence；
- 通过对象引用相等或 Map 插入顺序判断相同对象。

所有 canonical object 使用：

```text
normalize → validate references → canonical order
→ derive identity/revision → verify identity → deep-freeze
```

Git/CAS 只提供物理内容寻址，不自动定义 SEC 的语义 action key。Action key 必须由相应 domain 显式声明完整输入闭包。

## 5. Authoring Source 与 Source Program Model

### 5.1 Authoring Source

Authoring Source 是被用户、Contract、Policy 或受治理 operation 授权修改的输入。它可以是：

- Semantic Contract；
- TypeScript/JavaScript/HTML/CSS 等源码；
- 配置、schema、policy；
- governed extension；
- adopted Brownfield source。

Generated artifact、IR dump、Evidence、journal、cache 和 UI model 不是 Authoring Source。

### 5.2 Source Program Model

每种语言/框架生成独立、versioned、validated Source Program Model，至少表达：

- package/module/file；
- declaration/symbol/type/reference；
- syntax/source span/trivia preservation；
- control/data flow；
- state/effect/error candidates；
- configuration/resource/framework candidates；
- generated/vendor/protected/opaque；
- coverage、ambiguous、unsupported 和 diagnostics。

第一语言是 TypeScript：

- TypeScript Compiler API 负责 compiler-accurate symbol/type/module resolution；
- full-fidelity/LST 层负责 formatting、comments 和受控 source rewrite；
- Tree-sitter 适合多语言和嵌入语法的增量 syntax Provider，但不能替代 TypeScript semantic frontend；
- ts-morph、ast-grep、CodeQL、runtime trace、AI 都只能作为 Provider，不建立第二 source authority。

Source Program Model 不直接成为 Engineering IR。调用关系、AST shape、类型相似或运行时偶遇都只能产生 candidates/Evidence。

## 6. Provider Protocol

所有外部或可替换能力必须实现统一 Provider 协议：

```yaml
provider:
  identity:
  revision:
  kind:
  supportedInputs:
  capabilities:
  requiredEnvironment:
  permissions:
  deterministicBoundary:
  inputClosure:
  outputSchema:
  coverageModel:
  unknownModel:
  diagnostics:
  resourceContract:
  cacheKeyContract:
  invalidationRules:
  provenance:
```

Provider kinds：

```text
LanguageFrontend
SourceAnalysis
FrameworkAdapter
BuildSystem
RuntimeObservation
BrowserVerification
NativeCapability
ArtifactBackend
AIInference
Release/Deployment
ExternalGraph
```

Provider 只产生 typed output、coverage 和 Evidence；不能：

- 直接写 canonical IR；
- 授予 source ownership；
- 选择 merge；
- 把 confidence 升格为 authority；
- 通过“没发现”证明“不存在”；
- 在缺能力时静默 fallback 到当前 Host 或默认框架。

## 7. Engineering Semantic Kernel

### 7.1 核心对象

```text
Entity
Fact
Assertion
Responsibility
Operation
State / Transition
Policy / Permission
Effect / Resource
Contract / Port
Scenario / Acceptance
Source / Artifact Binding
```

Fact 是 normalized triple identity；Assertion 是某来源对 Fact 的独立声明。Authority、confidence、provenance 和 validity 属于 Assertion，不进入 Fact identity。

### 7.2 Predicate / Type / Operation Dialects

吸收 MLIR 的分层与方言思想，但不把 MLIR operation 直接当 Engineering IR：

- 每个 semantic domain 注册自己的 entity kinds、predicate signatures、value types、validators、queries、Impact rules 和 lowering interfaces；
- Core 只拥有注册协议、canonical identity、reference closure、validation 和 revision；
- domain 不能在通用 switch 中按框架/业务名称分支；
- unknown/unregistered domain object 只能以明确 opaque payload round-trip，不能进入需要理解的 validated semantic pass；
- pass 必须声明 dependent dialects/capabilities，不能依赖 ambient registry。

### 7.3 Assertion 与 Reconciliation

Reconciliation 输出：

```text
accepted | rejected | conflicted | ambiguous | unknown | opaque
```

规则：

- authoritative 输入优先于 inferred/observed，但冲突不删除低 authority Evidence；
- 多个 Provider 一致不是多数票 authority；
- 相同 assertion identity 的不兼容 payload 是 hard conflict；
- accepted candidate 必须绑定 owner、source/evidence、policy 和 validity；
- 无法唯一解析的 identity/reference 不选择“最像的”。

查询层可以采用 CodeQL/Datalog 风格的关系表达和路径见证，但查询数据库是可重建 index，不是 canonical fact store。

## 8. Semantic Responsibility Reconstruction

Responsibility 是工程 obligation，不是函数、类、文件或调用图 cluster。

```text
Function ↔ Responsibility = 多对多
Responsibility ↔ Block = 多对多
Responsibility ↔ Source Span = 多对多
```

候选提取至少包含十种 facet：

```text
Computation
Decision
State
Effect
Authority
Transaction
Lifecycle
Error
Orchestration
Projection
```

候选来源：syntax/type、control/data flow、state access、effect calls、exception mapping、transaction/lock/cache/event、schema/config、tests、policy、runtime、AI inference。

Canonical Responsibility 至少绑定：

- stable identity；
- obligation 与唯一 owner；
- input/output、pre/postconditions；
- state ownership/transition；
- Effect/Permission；
- error/transaction/lifecycle；
- source bindings 与 coverage；
- consumer/dependency；
- Verification obligations；
- assertions/provenance/unknown frontier。

SEC 不要求把紧凑代码机械拆成大量函数或 Block。它必须能够在代码保持简洁的前提下，允许只修改目标 facet，并证明其他 facets 保持不变。

## 9. Engineering Workspace Domains

最终 Workspace 不是一个巨型 optional object。每个 domain 独立拥有 raw/validated boundary、identity/revision、producer、query、mutation 和 migration：

1. Repository / Source Ownership；
2. Semantic Engineering；
3. Documentation Authority；
4. Workflow / Gate；
5. Agent Operations；
6. Evidence Ledger；
7. Product Decision；
8. Release / Deployment / Operations；
9. Security / Policy / Trust；
10. Registry / Capability Assets。

Aggregate Workspace Snapshot 只引用各 domain revision 和跨域 reference closure，不复制域内对象。

跨域 mutation 必须调用目标 domain 的 operation registry；不能用“Semantic Mutation”名义绕过 Documentation、Workflow、Release 或 Agent domain authority。

## 10. 查询式编译内核与增量架构

固定流水负责语义阶段顺序；实际计算采用 demand-driven query：

```text
query(key, normalizedInputs)
→ read dependency queries
→ produce immutable result
→ fingerprint canonical output
→ record dependency edges
```

吸收 rustc red-green 模型：

- input key 变化先标潜在 dirty；
- 重算后若 canonical output fingerprint 未变，下游可保持 green；
- query 必须尽量纯；副作用进入 transaction/publication layer；
- query key 绑定 content、validated revision、implementation/options、Profile/Provider；
- unknown dependency 只扩大失效；
- same-process cache、persistent cache、daemon 都消费同一 query semantics。

Compiler Incremental Graph 与 Verification Evidence DAG 永久分离：

| Compiler Graph | Verification DAG |
|---|---|
| 计算 canonical/target/artifact | 证明 exact requirement |
| node output 可作为下游输入 | Evidence node 支持 claim |
| clean/incremental parity | execution/reuse/freshness |
| pass/provider revision | Gate/producer/environment revision |
| 不拥有 merge result | 不重新实现 compiler pass |

二者可以共享物理 CAS，但不能共享 node schema 或 authority。

## 11. Target Compilation

### 11.1 Target Profile

显式描述：

```text
language/revision
runtime family/range
module system
package manager
delivery
persistence/database
UI/browser/server
network/process/thread/storage
verification/deployment
Provider capabilities
```

Target 不从 Host、Toolchain、cwd 或仓库当前框架推导。

### 11.2 分层 IR

```text
Engineering IR
→ Application IR
→ Behavior IR / Governed Extension
→ Target Program IR
→ Backend AST/Printer
```

- Application IR 表达目标无关应用结构；
- Behavior IR 只表达 SEC 能验证和 lowering 的受限行为；
- 复杂算法长期保留 Governed Extension/Opaque Boundary；
- Target Program IR 表达目标语言程序结构；
- Backend 只负责 AST、printer、formatter、typecheck、bytes。

每层有 raw builder → validator → branded immutable snapshot → deterministic lowerer。

### 11.3 Artifact Ownership

每个 artifact identity/path 在一个 candidate 只有一个 writer。新 writer 接管必须：

```text
shadow
→ bytes/diagnostics/effect/source-map parity
→ switch consumers
→ invalidate old revisions
→ retire old writer
```

## 12. Delta 与 Impact

Delta 只比较两个独立 validated endpoints：

```text
fromSnapshot + toSnapshot + comparatorRevision
→ Entity/Fact/Assertion Delta
```

Impact 是 versioned rules 上的 monotone fixpoint：

```text
seed delta
→ direct rules
→ transitive propagation
→ stable witness paths
→ definite | possible | unknown
→ Verification recommendations
```

必须：

- addition 在新端传播，removal 在旧端传播；
- cycle 有 visited/lattice 收敛；
- rule 未注册、reference 缺失、coverage 不足形成 unknown frontier；
- inferred/observed edge 不能升级为 definite；
- budget/cutoff 到达时不得声明 complete；
- predicted Impact 与 apply 后 actual Impact 分离；
- changed files、call graph、UI edge 不替代 semantic Impact。

Responsibility-level Impact 按 facet 传播。例如 permission change 不应自动重写 persistence/event；transaction change必须触发 consistency/idempotency/concurrency/recovery obligations。

## 13. Verification、Evidence 与可信合并

### 13.1 六个对象

```text
GateDefinition
ApplicabilityProof
ExecutionRecord
GateResult
ClaimDefinition / ClaimResult
EvidenceNode
```

禁止把它们压成一个 status。

GateResult 五态：

```text
passed | failed | not-run | unsupported | invalidated
```

Disposition 独立：

```text
executed | reused | not-executed
```

Claim 必须先裁决 applicability 和 owning environments；已证明 not-applicable 的 claim 不进入 required aggregate。Wrong environment、无环境 reused、zero-test 无 proof、duplicate/missing gate 全部 fail closed。

### 13.2 Action Key

Action key 绑定：

- Gate definition/revision；
- exact subject/input closure；
- environment/toolchain/provider/dependency identity；
- selector/Impact revision；
- required resource identity；
- trusted producer revision。

不绑定 branch、PR、聊天和 wall-clock。

### 13.3 Trusted Bootstrap

Verifier、selector、docs authority、Evidence validator 和 merge gate 的候选不能自证。Trusted base runner把 candidate tree作为不可信 SUT，运行 base-side contract/adversarial vectors。

### 13.4 Hermetic Resource Lifecycle

```text
prepare → allocate → execute → terminate
→ cleanup → readback → receipt
```

Workspace、port、process tree、browser、database、temp、cache、lease、journal 和 control-state 各有唯一 owner。测试断言成功但 cleanup/readback失败，Gate仍失败。

### 13.5 Formal / Property / Fault

- TLA+：Mutation、writer lease、publication/recovery、integration epoch、Evidence terminal 等关键并发状态机；
- Alloy：identity/reference/owner/compatibility/graph结构的有限反例；
- property/model tests：normalization、ordering、round-trip、lattice、fixed-point、clean/incremental parity；
- fault tests：每个持久化、publication、cleanup、recovery边界；
- mutation testing：高价值 validator、authorization、selector、fail-closed kernel。

Formal model 是设计 Evidence，不是生产运行 authority；模型与实现必须有 versioned conformance tests。

## 14. Semantic Mutation 与 durable operation

最终状态机：

```text
received
→ authorized | rejected
→ planned | blocked
→ candidate-built
→ preverified | rejected
→ publishing
→ published | publication-unknown
→ readback-verified
→ accepted | rolled-back | recovery-required
```

关键规则：

- Caller只提交 intent/target/allowed parameters；
- path、owner、Delta、Impact、risk、Verification、rollback由平台重新派生；
- plan/dry-run无 live write；
- apply在唯一 writer lease 内重新读取、重新授权、重新 plan、双 CAS；
- 多文件发布使用 staging + journal + commit marker + directory durability policy；
- terminal replay不重复副作用；
- journal append-only或等价 durable，不能被普通 cache cleanup 删除；
-恢复使用 exact generation/topology，不靠 timeout 猜 owner 已死。

吸收 durable workflow 的 event-history/replay思想，但不把 Temporal 或其他 workflow runtime作为 Semantic Core 依赖。SEC operation journal拥有自己的小而可验证协议。

## 15. AI Runtime 与授权

AI 是 `AIInferenceProvider`，永远不是 authority。

授权模型采用：

```text
principal × action × resource × context
```

并执行：

```text
default deny
+ explicit permit
+ forbid overrides permit
+ immutable decision diagnostics
```

完整链路：

```text
Work Selection Decision
→ Task Capsule
→ Change Closure Plan
→ Context Packet
→ Task Envelope
→ AI proposal
→ canonical planner
→ Verification / Review
```

AI 不得提交：

- canonical Fact/Delta/Impact/Result；
- source owner/path；
-更宽权限、Effect、budget；
- lower Verification；
- terminal状态；
- control/Evidence/journal/release receipt。

所有仓库写动作使用 typed action：

```text
create-issue
add-comment
create-branch
create-or-update-file-on-branch
update-ref
open-pr
request-review
merge
close
archive
cleanup-ref
```

每次动作前验证 intent class、repository/resource、branch protection、write scope、expected base、dry-run delta、reversibility。Plan/Issue/Comment 意图绝不能路由到 main file mutation。

## 16. Workbench

Workbench 采用 progressive disclosure：内部高分辨率，外部按用户意图投影。

主视图：

```text
Architecture
Responsibility
Scenario
Data
State
Contract
Effect / Permission / Trust
Impact
Evidence
Source / Artifact
Operations / Recovery
```

统一 Inspector 分组：identity、authority、contract、state、effect、error、lifecycle、concurrency、permissions、relations、provenance、Evidence、source binding、maturity。

每个判断保留可点击 witness/reference。UI layout、颜色、选择和临时摘要不进入 semantic revision。

CLI、Workbench、AI、HTTP 只消费同一个 product facade 与 operation registry。

## 17. Web 前端

最终必须支持 HTML、CSS、DOM、Template、TSX 和 Browser，但分层：

```text
HTML/Template Source Model
CSS/Style Source Model
TypeScript/JS Behavior Model
Framework Adapter
Resource/Asset Graph
Rendered DOM Candidate
Runtime DOM/CSSOM Evidence
Web Target Profile
```

HTML tree、framework virtual tree、runtime DOM、CSS syntax、computed style 和 layout不是同一对象。

支持等级：

```text
L0 inventory
L1 parse/source map
L2 static semantic graph
L3 cross-artifact Impact
L4 governed mutation
L5 deterministic round-trip/lowering
L6 browser acceptance
L7 SEC-owned normalized projection
```

先 Native HTML/CSS，再 TSX/JSX，再按真实消费者增加 framework Provider。Core 不按 React/Vue/Svelte/Angular 名称分支，也不重写浏览器 layout engine。

## 18. Registry、Block 与生态

Block 是分发、版本、信任、Migration 和资产封装单位，不是每条逻辑的架构单位。

Block bundle：

```text
Manifest
Semantic Contracts
Ports / Capabilities
Generator declarations
Source/assets
Tests / Acceptance
Migrations
Effects / Permissions
Compatibility
SBOM / license / provenance
Signature / trust metadata
```

Registry resolution必须绑定 source identity、digest、trust policy、version compatibility和 deterministic order。多个 source 同 ID 不按搜索顺序或最新时间覆盖。

一个 Responsibility 只有在有独立 contract、owner、复用/替换价值、Verification和生命周期时才提升为 Block。细碎逻辑留在 Responsibility facet/Operation。

## 19. Runtime、Distribution、Release 与 Supply Chain

保持正交：

```text
Semantic Core
Host Runtime
Repository Toolchain
Generated Target Runtime
Optional Capability Provider
```

公共 Host、当前 Bun Toolchain、Node/Bun/Browser Target分别有物理 Gate；不存在兼容性推断。

Release 使用 clean workspace 和白名单 projection，绑定：

- source/materials；
- builder/toolchain/environment；
- artifact digests；
- Verification；
- SBOM/license；
- signature/attestation；
- promotion/publication receipt；
- rollback/yank/deprecation。

采用 SLSA/in-toto 的构建 provenance 和 W3C PROV 的 Entity/Activity/Agent/qualified relation概念作为互操作参考，但 SEC 内部继续保持 Fact Provenance、Artifact Provenance、Verification Evidence、Runtime Observation和Decision Evidence的独立 typed models。

## 20. Development Operating System

### 20.1 唯一状态分工

| 对象 | 唯一 owner |
|---|---|
| 下一工作选择 | #221 Work Selector |
| 任务最小充分输入 | #205 Task Capsule |
| 变化完整闭包 | #219 Change Closure |
| 并行合法性 | #207/#191 Integration Epoch |
| Candidate/Failure | #177 Epoch/Failure |
| Gate真值 | #176/#215 Verification Result |
| 测试选择 | #188 Test Impact |
| Evidence复用/恢复 | #179 Evidence DAG/Run Journal |
| 测试物理资源 | #190 Hermetic Runtime |
| Compiler增量 | #194 Query/Build Graph |
| 自动执行 | #189 Feedback Executor |

任何模块只消费上游结果，禁止复制其算法或状态。

### 20.2 Work Selector

不用不可解释综合分数。先 lifecycle，再 eligibility，再词典序优先：

```text
integrity-critical
active-critical-path
product-critical-path
near-term-acceleration
maintenance-required
defer
```

无真实消费者的基础设施默认 defer；P0/P1 integrity 不受产品配额限制；纯流程连续推进触发 product/self-bootstrap 饥饿保护。

### 20.3 Change Closure

共享 contract/state/cache/trust/publication变化在编码前展开：producer/consumer、状态、identity/invalidation、environment、migration、retirement、negative/property/fault cases。Known-cell-missed 反哺规则；同类根因第二次出现禁止叶节点补丁。

## 21. 自举阶梯

自举必须逐层接管，不可一步把 Git/CI/merge 交给未验证系统：

```text
L1 Observe：读取 SEC 自身 Source Program Model
L2 Reconcile：重建 Responsibility/Contract/State/Effect candidates
L3 Explain：产生有 witness 的语义视图
L4 Impact：计算责任级 predicted/actual impact
L5 Plan：生成受控 mutation plan，不写 live source
L6 Mutate：完成一种 operation 的 CAS/rollback闭环
L7 Lower：确定性生成/维护自身受控源码
L8 Verify：选择并证明自己的 affected closure
L9 Govern：生成 Task Capsule/Closure/Work Selection
L10 Operate：有限接管 branch/PR/CI/closeout typed actions
```

在 L1–L8 成熟前，Git/GitHub/CI 是外部可信壳；在 L9–L10 成熟前，物理 merge authority保留独立 Review和 base-side trust。

## 22. 语料与反特化

至少维护五类 corpus：

1. SEC 自身受控子系统；
2. lifecycle/state-machine 业务；
3. reservation/concurrency 业务；
4. approval/policy workflow；
5. 一个真实 Brownfield TypeScript/Web 工程；
6. 一个 Governed Extension/复杂算法边界；
7. native HTML/CSS/TS、React/TSX、另一 framework（Web阶段）。

任何新 corpus 不得要求 Core 按业务/框架名称分支。Coverage 必须声明 supported/unknown/opaque，不能只报告解析成功率。

## 23. 当前实现到目标架构的迁移原则

不重写全仓。使用：

```text
census current owner
→ freeze target contract
→ build read-only/shadow producer
→ differential/parity
→ migrate consumer
→ switch single writer
→ invalidate old revision
→ retire old path
→ main readback
```

现有实现若已满足目标职责，保留并收敛命名/接口；只删除重复 authority、第二 parser/selector/cache/writer和无消费者结构。

当前已明确的迁移：

- 现有 Engineering IR 继续作为语义主干，补齐 Responsibility/source/provider边界；
- V1 Work Package/control plane 迁移到经过 #207 校准的 V3/Integration Epoch，不并存两个 active selector；
- verification result 从过渡 product summary 迁移到环境/claim/applicability完整真值；
- path/manual test declarations 逐步迁移到 #188 explainable graph；
-现有 pipeline cache 迁移到 #194 query kernel，不新增第三 cache；
- Workbench/CLI transport迁移到统一 product facade；
-旧 Generator 与 Target Program IR 完成 parity后单写者切换；
-新增 Web/语言/framework只通过 Provider/dialect协议进入。

## 24. 最短总工期的正式路线

### 当前不可跳过

**0. 完成 #215 / PR #223**：owning environment、order-independent aggregate、not-applicable、zero-test truth、duplicate/missing IDs。当前 Draft 只有反例和 manifest，不得误判完成。

### 接下来一个加速前置

**1. #207 最小 Resolver Correctness + Integration Epoch**：只做到两个正式包机器安全并行，不扩 Virtual Merge/自动 Queue。

### 随后双线推进

#### 产品主线

2. TypeScript Source Program Model + Source Ownership 最小闭环；
3. #224 Responsibility Candidate + SEC Self-Observation V0；
4. Responsibility-level Semantic Impact / Explain；
5. 一种 Controlled Mutation（优先 decision/state/permission）；
6. Deterministic TypeScript Lowering + round-trip；
7. 外部 Brownfield 模块 Attach→Adopt→Normalize。

#### 治理/复利主线

2a. #221 Phase A read-only deterministic Work Selector；
3a. #177 Phase A Epoch/Failure Core；
4a. #219 Phase A read-only Change Closure historical replay；
5a. #188 TypeScript/semantic Test Impact，消费产品图；
6a. #178 trusted bootstrap + #179最小Run Journal；
7a. #194 in-memory query incremental，消费已稳定 clean boundaries。

两条线每次只能由 #207 证明真实写集/authority/resource无冲突。没有消费者的更深自动化、persistent CAS、daemon、remote execution、全框架支持保持 defer。

### Web 与生态

在 TypeScript Self-Observation、Impact、Controlled Mutation闭合后：

8. Native HTML/CSS；
9. TSX/JSX cross-artifact graph；
10. Workbench自举；
11. Browser Evidence；
12. Framework Providers；
13. Registry/Release ecosystem。

## 25. 性能目标

性能优化的唯一合法来源：

- demand-driven query；
- content identity；
-精确 invalidation；
-机器证明并行；
-未失效 Evidence/Artifact复用；
-candidate晚冻结；
-资源生命周期复用且不越权；
-上下文按 Context Packet 最小投影。

必须观测：

```text
cold/warm P50/P95
critical path
node recompute/reuse
memory peak/GC
verification wait
proof reset
known-cell-missed
post-merge hotfix
context reorientation
integration wait
```

不能通过少测、弱化 validator、扩大 timeout、retry到绿或 stale cache提速。

## 26. 安全与威胁模型

必须显式建模：

- malicious/untrusted source；
- prompt/tool injection；
- path traversal、symlink/reparse、case/Unicode；
- secret/environment/network exfiltration；
- dependency/install/build script供应链；
- browser/local HTTP/DNS rebinding；
- native/FFI/container逃逸；
- forged Evidence/provenance；
- stale authorization/plan/reused result；
- concurrent writer/TOCTOU；
- journal/backup泄露；
- registry poisoning/revocation。

普通 temp dir、loopback、browser context、container或输入 validation不自动构成安全 sandbox。Capability、OS isolation和trust policy必须由独立 Provider与物理 Evidence证明。

## 27. 外部机制吸收裁决

| 机制 | 吸收 | 不吸收 |
|---|---|---|
| MLIR/LLVM | 多层IR、dialect、局部验证、pass依赖 | 用编译器IR替代Engineering IR |
| rustc query | demand-driven、red-green、fingerprint | 把所有副作用伪装pure query |
| Roslyn | immutable solution/syntax/semantic snapshots | .NET对象模型成为SEC Core |
| Tree-sitter | 多语言增量syntax、嵌入语言 | 用syntax tree推断完整语义 |
| OpenRewrite LST | format/comment-preserving rewrite | parse成功等于semantic parity |
| CodeQL/Datalog | relational query、path witness、dataflow | query DB成为authority |
| Bazel | explicit action inputs/outputs/env、cache | build graph拥有semantic truth |
| Nix | precise derivation、isolated reproducibility | Nix生态成为强制运行时 |
| Git CAS | content-addressed bytes/tree | Git hash等于semantic revision |
| TLA+ | critical state-machine safety/liveness | 形式化所有业务代码 |
| Alloy | structural constraints/counterexamples | 把有限模型当现实证明 |
| Temporal | durable history/replay思想 | 引入为Core operation runtime |
| Cedar | principal/action/resource/context、default deny | policy engine直接拥有source path/Impact |
| SLSA/in-toto | builder/materials/provenance/attestation | provenance等于Verification correctness |
| W3C PROV | Entity/Activity/Agent互操作词汇 | RDF/OWL成为内部canonical存储 |

## 28. 必须建立的机器合同

近期目标 schema：

```text
sec-source-program-snapshot-v1
sec-provider-descriptor-v1
sec-responsibility-candidate-v1
sec-responsibility-snapshot-v1
sec-workspace-domain-snapshot-v1
sec-workspace-snapshot-v1
sec-query-node-v1
sec-target-profile-v1
sec-application-ir-v1
sec-behavior-ir-v1
sec-target-program-ir-v1
sec-semantic-delta-v1
sec-impact-result-v1
sec-gate-definition-v1
sec-gate-execution-v1
sec-verification-result-v1
sec-evidence-node-v1
sec-mutation-plan-v1
sec-mutation-journal-v1
sec-work-selection-decision-v1
sec-task-capsule-v1
sec-change-closure-plan-v1
sec-integration-epoch-v1
```

每个 schema 必须有唯一 owner、builder、validator、canonical serializer、revision、negative/property tests和consumer migration。名字可在正式设计中调整，但职责不可重叠。

## 29. 完成门

SEC-TS 产品闭环只有同时满足以下条件才成立：

1. SEC 能以 byte-stable Source Program/Responsibility graph观察自身一个真实子系统；
2. function↔responsibility多对多，unknown/opaque显式；
3. 一个责任级变化产生可解释 predicted/actual Delta与Impact；
4. 一个 operation完成plan、CAS、apply、rollback/recovery physical proof；
5. 同一 validated input确定性 lowering为可维护 TypeScript；
6. clean/incremental等价；
7. Gate owning environment、applicability、cleanup、Evidence完整；
8. CLI/Workbench/AI消费同一 product facade；
9. 一个真实 Brownfield模块完成Adopt/Normalize/round-trip；
10. 三组无关业务模型不修改Core业务分支；
11.支持等级、release、package和physical Evidence一致；
12. 每个旧 owner/writer在迁移后退役，无第二真值源。

## 30. 本 Proposal 的处理方式

本文不能直接升格为 canonical authority。评审后必须产出：

1. 与现有 canonical docs 的差异矩阵；
2. 需要补充的少量 canonical owner，而非复制全文；
3. 被 supersede/merge 的 Issue 职责；
4. 近期正式 Work Package 清单；
5. 不进入近期路线的 archive/proposal 项；
6. 对每项采纳决定的 owner、migration和验收。

在完成上述拆分前，本文保持 Spike/Draft，不更新 `docs/authority.json`，不改当前 active pointer，不干扰 #223。

## 31. 外部一手参考

- LLVM MLIR：Pass Infrastructure、Defining Dialects、Rationale / multi-level IR。
- rustc-dev-guide：Query System、Incremental Compilation / red-green algorithm。
- Microsoft Roslyn：Compiler Platform Architecture、Workspaces、immutable full-fidelity syntax trees。
- Tree-sitter：incremental parsing and edits。
- OpenRewrite：Lossless Semantic Trees。
- Git Internals：content-addressable object database。
- Bazel Remote Caching / Remote Execution：action graph、Action Cache、CAS。
- Nix derivations：precisely declared inputs and outputs。
- CodeQL：relational code database、CFG/data-flow/path queries。
- Leslie Lamport TLA+：state machines、safety/liveness、TLC。
- Alloy Analyzer：relational structural models and counterexamples。
- Cedar Policy：principal/action/resource/context、default deny、forbid precedence。
- Temporal：durable execution and history replay。
- SLSA Provenance、in-toto supply-chain metadata。
- W3C PROV Data Model / PROV-O。
