---
title: SEC Canonical Architecture Convergence V1
status: proposal
domain: proposal
tracking: issue-232
exact-main: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
authority: none
merge-policy: spike-default-no-merge
---

# SEC Canonical Architecture Convergence V1

> 本目录是 Issue #232 Phase A 的只读设计裁决，综合当前 canonical authority、Issue #222/#224、PR #226/#229/#231 与当前实现反证。它不是第二架构 authority，不改变 `docs/authority.json`、`docs/work/**`、产品代码、workflow 或当前 formal candidate。正式采用必须从届时 latest `main` 提炼聚焦 canonical delta 与 Work Package。

## 1. 最终产品裁决

SEC 的最优产品定义是：

> **一个确定性的、多领域工程语义编译器，以及建立在同一 canonical state、同一查询面和同一 Mutation facade 上的受治理工程变更平台。**

SEC 将产品意图、受权威输入、既有源码、配置、测试、运行观察和工程政策编译为可验证的 Engineering Workspace；再从该状态确定性地产生源码、测试、文档、Gate、Agent、Release、Explain、Impact 与 Workbench 投影。任何变化都必须经过授权、唯一 source owner、实际 Delta、Impact、Verification、发布和恢复闭环。

这一定义同时排除：代码知识图、模板市场、低代码私有运行时、万能 AST/IR、任意整仓 AI patcher、把函数机械拆成 Block 的平台、依赖单一语言/框架/Host 的生成器，以及声称能自动还原任意程序全部业务语义的反编译器。

## 2. 最优总装：极小联邦内核，而不是中央 God Object

此前“Model Federation Kernel”方向正确，但范围必须收窄。最优解不是把 Effect、Condition、Compatibility、Support、Verification、Agent 状态全部塞进中央 Kernel，而是：

```text
Minimal Federation Kernel
├─ Domain identity / descriptor
├─ Stable typed reference + revision reference
├─ Authority class + producer identity
├─ Raw → validated immutable boundary protocol
├─ Coverage / unknown frontier envelope
└─ Migration / retirement reference

Shared Algebra Domains
├─ Contract protocol
├─ Type algebra
├─ Effect / Resource / Capability algebra
├─ Condition / freshness protocol
└─ Compatibility / support-claim protocols

Domain-owned Typed Canonical Snapshots
├─ Source Program
├─ Engineering Semantics
├─ Repository / Documentation / Workflow / Agent / Release
├─ Compilation IRs
├─ Delta / Impact
├─ Verification / Evidence
├─ Mutation / Change Management
└─ Development / Integration
```

Kernel 只统一跨域引用和 validated boundary，不拥有任何领域字段、状态机、算法或万能 property bag。共享代数具有独立 owner；领域通过显式接口消费，不能把共享协议变成中央业务模型。

### Kernel 唯一允许的对象

```text
DomainId
DomainRevision
StableReference<DomainId, ObjectKind>
AuthorityClass
ProducerReference
ValidatedSnapshotEnvelope
CoverageEnvelope
UnknownFrontier
MigrationReference
```

不得进入 Kernel：Responsibility 字段、Effect 具体操作、Verification status lattice、Target type mapping、Agent lifecycle、Mutation terminal、Release state、Provider 品牌或业务名称。

## 3. Canonical truth 的形态

最优状态不是一个万能图，也不是一个巨型 optional Workspace object。

### 3.1 每个领域拥有 typed canonical snapshot

每个领域必须独立拥有：

- raw input 和 validated output；
- stable identity 与 revision；
-唯一 producer、validator、writer 和 query interface；
- state machine、unknown/unsupported语义；
- mutation、migration、compatibility与retirement；
- positive、negative、property、fault或physical proof。

### 3.2 Engineering Fact Graph 是跨域断言层，不复制领域内部模型

Entity / Fact / Assertion 继续作为统一跨域工程陈述与 provenance 层。复杂领域对象仍保留在 typed snapshot 中，通过稳定引用与规范化 Fact projection 参与跨域查询。

因此：

```text
Domain typed snapshot = 领域事实与不变量的唯一 owner
Engineering Fact Graph = 跨域 assertion / query / provenance 层
Workspace Snapshot = 各领域 revision + 跨域引用闭包
```

Fact projection 可以重建，不能反向覆盖 typed domain state。这样既避免 generic graph 退化为字符串 property bag，又保留统一 Explain/Impact/AI 查询面。

## 4. 四个平面与依赖方向

### Truth Plane

```text
Authority Inputs / Imported Observations
→ Source Program Models
→ Candidate extraction / reconciliation
→ domain typed snapshots
→ Engineering Fact assertions
→ Validated Engineering Workspace Snapshot
```

### Compilation Plane

```text
Validated Workspace
→ Target Profile + Type Algebra
→ Application IR
→ bounded Behavior IR / Governed Extension
→ Target Program IR
→ Backend
→ Artifact + source/provenance map
```

### Operation Plane

```text
Typed intent
→ authorization intersection
→ deterministic read-only plan
→ isolated candidate
→ actual Delta / Impact / Verification plan
→ apply under writer lease + CAS + journal
→ publish / readback
→ accepted | rejected | rolled-back | recovery-required
```

### Governance Plane

```text
Work selection
→ Task Capsule / Change Closure
→ Work Package / Candidate Epoch
→ Verification / Evidence / Review
→ Integration Epoch / expected-head publication
→ main readback / cleanup / replan
```

平面只能通过 typed references 连接。Development Run Journal 不拥有 Mutation terminal；Evidence DAG 不拥有 compiler query result；Workbench 不拥有 authorization；Verification 不拥有 work selection。

## 5. Source 与 Brownfield 最优链

固定分层：

```text
Exact bytes + mode
→ lossless syntax representation
→ language semantic model
→ Source Program Model dialect
→ Responsibility / binding candidates
→ reconciliation
→ canonical semantic domains
```

TypeScript 首先使用 TypeScript Compiler API 作为 symbol/type/module authority，并使用 full-fidelity/LST 层保存 comments、format 与 unowned regions。Tree-sitter、ts-morph、ast-grep、CodeQL、runtime trace 和 AI 只能作为明确 Provider；任何 Provider 都必须暴露 coverage、unknown、revision 与 diagnostics。

Source Program Model 采用共享最小接口加语言 dialect，不建立一个可容纳所有语言字段的万能 source schema。

Brownfield 生命周期保持：

```text
Attach → Lift → Reconcile → Adopt → Normalize
```

Normalize 只有在 source ownership、round-trip、behavior/effect parity、consumer migration、Verification 与 rollback 已闭合时发生。

## 6. Semantic Responsibility 裁决

Responsibility 是工程 obligation，不是函数、类、文件、调用图 cluster 或 AI 摘要。

```text
Function ↔ Responsibility = 多对多
Responsibility ↔ Source Binding = 多对多
Responsibility ↔ Block = 多对多
```

固定 facets：

```text
Computation | Decision | State | Effect | Authority
Transaction | Lifecycle | Error | Orchestration | Projection
```

Canonical Responsibility 至少绑定 obligation、owner、inputs/outputs、pre/postconditions、state transitions、Effect/Permission、error/transaction/lifecycle、source coverage、consumers、Verification 和 unknown frontier。SEC 不要求为了显式化语义机械拆碎紧凑代码。

## 7. Contract、Type 与 Effect

### 7.1 Contract triad

所有公共合同必须同时具有：

1. **Structural**：shape、schema、identity、reference；
2. **Semantic**：不变量、含义、兼容和禁止状态；
3. **Operational**：Effect、resource、failure、retry、cleanup、recovery。

只通过 JSON/TypeScript shape 不构成完整工程合同。

### 7.2 Type Algebra

Type identity 与目标语言拼写分离。首期支持 primitive、nominal、enum、optional、list、map、record、union、result、async、stream；随后增加 recursive、resource handle、opaque external、representation 与 directional compatibility。`any`、字符串 type 或 Backend 私有默认不能吞掉 unsupported。

### 7.3 Effect / Resource / Capability Algebra

Effect 不进入 Federation Kernel，而建立独立共享代数域：

```text
operation
resource identity / ownership
read | write | create | delete | invoke | publish
required capability
semantic permission
runtime attenuation mechanism
determinism
idempotency
isolation
compensation
failure modes
observability
```

Semantic authorization 与 OS/runtime capability attenuation 永久分离，并取交集。Effect 不是字符串标签；Provider 缺失不能由当前 Host 隐式补齐。

## 8. Compiler 裁决

- 每层只有一个 producer，使用 `raw builder → validator → branded frozen snapshot`。
- Behavior IR 保持小而完整，只表达可验证、可 lowering 的受限行为；复杂算法进入 Governed Extension 或 Opaque Boundary。
- 编译执行采用 demand-driven Query Contracts，但只有 clean deterministic pipeline 稳定后启用。
- 每个 query 声明完整 input closure、动态依赖、output fingerprint、invalidation、cancellation、resource class 与 clean oracle。
- Compiler Query DAG 与 Verification Evidence DAG 永久分离；最多共享物理 CAS。
- 高风险 pure lowering/optimization 使用 per-candidate translation validation；不要求形式化全部业务代码。
- E-graph 只在出现真实 typed pure rewrite consumer 后作为可选 Provider，不进入当前核心。

## 9. Delta、Impact 与 Mutation

Delta 分层为 Authoring、Source Syntax、Source Semantic、Engineering、Compilation、Artifact、Runtime 和 Support Delta。它们使用稳定引用连接，但不能互相改名替代。

Impact 使用 definite / possible / unknown 单调格、版本化 rule registry、canonical witness 与 unknown frontier；预算耗尽或缺 rule 返回 unknown，不返回 complete。

Mutation 永久采用 plan/apply 分离、唯一 writer、source + semantic CAS、isolated rebuild、actual Delta、minimum Verification 与 journaled publication。Canonical source/semantics/release/policy 使用 single-writer linearizable transition；CRDT 只允许用于草稿、评论、UI 协作等非 authority 表面。

发布必须区分：

```text
not-published
published-durability-unknown
published-durable
rolled-back
recovery-required
```

不存在 partial-success。

## 10. Verification 与 Evidence

Verification 对象必须拆分：

```text
Requirement
Applicability Proof
Gate Definition
Execution Plan
Execution Record
Gate Result
Claim Result
Evidence Node
Aggregate Decision
```

`passed | failed | not-run | unsupported | invalidated` 与 `executed | reused | not-executed` 分离。`not-run` 只有可信 applicability/Impact proof 才成立；unknown、缺失、stale、cleanup/readback失败都不能 PASS。

Evidence DAG 保存 exact input/environment/producer closure；Action Cache 与 CAS 分离：Action Key正确后才能复用 CAS。失败结果可复用来停止无意义重跑和支持 diagnosis，永远不能变成 positive Evidence。

Trust-root 变化使用 base-side或独立 verifier；candidate 不能用自身新增 validator、selector、docs-doctor、workflow 或 merge authority授权自身。

## 11. Development、Agent 与吞吐

最优交付主链：

```text
Ready Issue
→ trusted orientation
→ Task Capsule
→ Change Closure
→ one authorized operation
→ thin incremental feedback
→ Candidate Closure
→ independent Review
→ Integration Epoch
→ expected-head merge
→ main readback / cleanup / replan
```

Work selection、Task Capsule、Change Closure、Candidate/Failure、Verification、Evidence/Run、Integration Epoch 和 publication 各有唯一 state owner。Candidate Closure 只编排，不重新定义 PASS、Impact或Review。

Agent 架构采用：

```text
Universal AGENTS policy
→ explicit Role
→ typed Operation Envelope
→ exactly one Primary Skill
→ deterministic services
→ typed outcome / legal next transition
→ external state and Evidence
```

批准 Role/Operation/Primary Skill 分层；不冻结“11个 Skill”为永久数量。Skill 数量必须由历史 routing evaluation、权限边界和重复 owner 检查决定。机器可判断规则全部下沉到 parser、validator、permission evaluator、state transition和runner。

## 12. Workbench 与 AI

CLI、Workbench、HTTP/MCP 和 AI Adapter 只调用同一个 canonical query、plan、apply、recover facade。

AI 只提交 proposal。Context Capsule 是带 reason、authority、symbol、digest、freshness 与 invalidation 的引用集合，而不是复制整仓文档。模型按需加载正文；budget、path、Effect、operation、must-preserve 与 minimum Verification 都由平台授予。

授权采用 principal/action/resource/context 式 typed request，并与 workspace owner、operation contract、source region、policy 和 runtime capability求交集。Cedar/OPA 可作为 policy evaluator Provider，但不能拥有 SEC source path、semantic owner或terminal result。

## 13. Runtime、存储与分发

- Semantic Core runtime-neutral。
- 公共 CLI 面向当前受支持 Node LTS family；具体最低版本由机器 support profile和物理Evidence冻结，不写死在稳定架构。
- Repository Toolchain 可继续使用 exact Bun；Node Host、Bun Toolchain和生成 Target保持正交。
- 依赖按 Core、Host、Toolchain、Verification、Target、Workbench、External、Release 分包；根 package不长期承担所有职责。
- immutable artifacts、query results和Evidence blobs可进入内容寻址存储；Action Cache另存 action key → result metadata。
- canonical Authoring Source、transaction journal、writer generation和recovery state不得降格为可删除cache。
- derived index、compiler cache和Repository Semantic Index可删除、可重建，不成为第二 Engineering IR。

目标包边界：

```text
@sec/federation
@sec/contracts
@sec/semantic
@sec/source-typescript
@sec/compiler
@sec/delta-impact
@sec/mutation
@sec/verification
@sec/development
@sec/cli-node
@sec/toolchain-bun
@sec/workbench
@sec/provider-*
```

这是一组职责边界，不要求当前立即物理拆包；拆包必须基于真实 load graph、cycle和release consumer。

## 14. Web 与专用平台

Web 是最终必要能力，但不阻塞 TypeScript 核心闭环。顺序：

```text
Native HTML/CSS/TS source models
→ TSX/JSX binding
→ cross-artifact Impact
→ governed web mutation
→ browser Evidence
→ framework adapters
```

Runtime DOM、CSSOM、computed style、layout和interaction由 Browser Verification Provider提供 Evidence，不成为 source authority。

GPU、kernel/eBPF、mobile、real-time、HSM/crypto、ML model/data/evaluation等专用平台统一使用：

```text
Specialized Provider
+ Target/Capability Profile
+ typed Resource/Effect
+ owning-environment Evidence
+ Governed/Opaque Boundary
```

不得为专用平台无限扩张通用 Behavior IR。

## 15. Security 与支持声明

- default deny；forbid优先；权限是 Role/Caller、Operation、Resource、Source Owner、Policy、Capability、current revision的交集。
- Secret/key bytes不进入 Engineering IR、AI Context、普通日志或通用Evidence。
- `sandbox: true` 被永久拒绝；支持声明必须绑定平台、机制、capability、process generation与physical Evidence。
- Dependency graph、SBOM、source index、Impact、Provider coverage必须声明 completeness；partial/unknown下“无边”不等于“无影响”。
- Support Claim固定分层：design → implemented-in-main → physically-verified → packaged/deployed → product-supported；任何层不能代替下一层。

## 16. 被拒绝的架构

永久拒绝：

1. 万能 IR / 万能图 / generic property bag Core；
2. 一个 Assembly 文档成为第二领域算法 authority；
3. 一个 revision覆盖source/semantic/artifact/evidence/transaction；
4. 一函数一Responsibility、一Responsibility一Block；
5. AI/Provider confidence、多数票或UI接受直接建立canonical Fact；
6. incremental/cache结果拥有独立语义；
7. build/query cache等于Verification Evidence；
8. canonical authority自动CRDT merge；
9. Skill prose拥有状态机、权限或Gate算法；
10. current Host/Toolchain隐式决定Target；
11. 未执行、unsupported、stale或unknown投影为PASS；
12. 巨型一次性架构PR同时修改authority、core、workflow、package和产品。

## 17. Final Design V1 完成门

只有全部满足才可声明“全工程最终设计 V1完成”：

- 本裁决的每项decision进入唯一canonical owner或明确rejected/deferred/experimental；
- `docs/authority.json` 与机器Assembly不存在duplicate owner和循环authority；
- #226/#229/#231/#222/#224无并列“最终设计”身份；
- shared protocol只有一套定义，domain算法保持domain-owned；
- 所有active proposal有retirement/activation trigger；
- docs doctor、authority、relationship、repository audit通过；
- new-main readback一致；
- 至少一个真实自举纵切片证明总装可执行；
- 剩余unknown具有owner、Evidence需求、trigger和reversal condition。

Final V1不是永不演化，而是禁止未来通过新增并列终极文档绕过versioned decision和canonical migration。
