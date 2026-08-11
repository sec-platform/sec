---
title: 系统架构与权威流
status: stable
domain: system-architecture
last-reviewed: 2026-08-11
---

# 系统架构与权威流

本文只拥有 SEC 的总体对象分层、两条产品主链、canonical/projection 边界、状态类别、跨域引用、单写者和依赖方向。产品目标由 `docs/product.md` 拥有，阶段依赖由 `docs/roadmap.md` 拥有；领域内部字段、当前实现能力和具体文件集合分别由领域代码合同、最新 `main` 和机器 registry 拥有。

## 总体闭环

SEC 是 Engineering Workspace Compiler。它不是一条“从 YAML 生成文件”的单向流水，也不是一套自由式 Agent 脚本，而是围绕同一工程语义核心形成两个方向的闭环。

### 既有工程治理链

```text
Existing Workspace
→ Physical Workspace Observation
→ Source Program Model
→ Engineering Semantic Model
→ Responsibility / Delta / Impact
→ Operation / Authorization / Plan
→ Transactional Mutation
→ Verification / Evidence
→ Publish / Recovery / Readback
```

### 确定性工程生成链

```text
Product Intent / Contract / Block
→ Engineering Semantic Model
→ Application IR
→ Behavior IR
→ Implementation Resolution
→ frozen Implementation Binding
→ Target Program IR
→ Backend
→ Source / Test / Config / Artifact
→ Verification / Evidence
```

两条链共享 Engineering identity、Responsibility、State、Operation、Policy、Permission、Effect、Scenario、Acceptance、Provenance 和 Verification truth。Brownfield 不能建立一套“源码图语义”，Generator 也不能建立另一套“模板语义”，Implementation Resolver、Block Resolver、Provider Registry和Workbench也不能各自建立实现选择真值。

### 产品回路

```text
canonical state
→ query / projection / Workbench / Context Packet
→ user or AI proposal
→ platform-owned Operation ingress
→ plan without live writes
→ apply under transaction and CAS
→ canonical rebuild / implementation re-resolution
→ actual Semantic / Binding Delta and Impact
→ Compatibility / Verification / Migration decision where applicable
→ accepted | rejected | rolled-back | recovery-required
→ projections reload from accepted canonical revision
```

UI、CLI、HTTP、AI Adapter 和 Provider 都只能通过同一个产品 adapter 消费该回路，不能各自维护写路径、实现选择、兼容性或成功状态。

## 四种不同身份

- **Authority**：谁有权声明、修改或裁决输入和策略。
- **Canonical state**：由确定性 producer 从受权威输入构建、验证和冻结的工程状态。
- **Evidence**：某个来源、方法、revision 与环境下的观察、测量、执行或推断。
- **Projection / Artifact**：为用户、工具、运行目标或治理消费者生成的输出。

同一个物理文件可以承载其中一种身份，但路径、格式、Git 状态或被多个消费者读取不会自动改变它的身份。Evidence 不能通过 confidence、多数票或 UI 接受动作自动成为 authoritative Fact；Projection 也不能反向修改 canonical state。

## 核心对象层

### 1. Authoring 与显式决策

拥有产品意图、Semantic Contract、Block 引用、Policy、受治理源码、Implementation constraints、Rule-backed Override、Migration decision 和显式 Adopt decision。

Authoring Source 是可修改的权威输入，不等于所有源码。Registry source、generated artifact、cache、Evidence、IR JSON、ResolutionDecision、journal、UI state 和外部 Provider 输出默认都不是 Authoring Source。

### 2. Physical Workspace

表达 exact revision 下物理存在的对象：repository、workspace、package、file、directory、config、test、workflow、resource、generated output、runtime materialization 和 release artifact。

Physical Workspace 只回答“看见了什么、如何定位、由谁物理拥有、哪些区域不可读或受保护”，不自动解释业务 Responsibility。它必须显式保留 tracked/untracked/ignored、content/object identity、mode、encoding、symlink/reparse、case/Unicode、generated/vendor/secret/opaque 与 unknown。

Repository、Documentation、Workflow/Gate、Agent Operations、Release、Product Decision 和 Evidence Ledger 等 Workspace Domain 在出现真实 consumer 时逐域建立独立 raw/validated boundary；不能先创建一个巨型 optional Workspace object。

### 3. Source Program Model

Language、Compiler、Static、Runtime 和 Build Provider 把 Physical Workspace 提升为 observed/derived 源码模型，表达：

- workspace、package、build target、file、module；
- symbol、declaration、type、reference、source span；
- import/export、resolution、call candidate；
- control/data-flow、state/effect/error/permission candidate；
- framework/config/resource binding；
- generated、vendor、protected、opaque、ambiguous 与 unresolved region。

Source Program Model 有独立 identity、revision、validator、canonical ordering、coverage 和 provider provenance。它不是 Engineering IR，Provider 私有 ID、绝对路径或模型 confidence 不能自动成为跨重建 semantic identity。

### 4. Engineering Semantic Model

Engineering IR 是 SEC 接受的 canonical engineering semantics，拥有 stable Entity、Fact、Assertion、Semantic Contract、Responsibility、State、Operation、Policy、Permission、Effect、Scenario、Acceptance 和 semantic revision。

它回答：

- 哪些工程对象存在；
- 哪些陈述成立；
- 谁以什么 authority 和 provenance 作出陈述；
- 哪个对象承担什么责任和边界；
- 哪些未知、冲突和 opaque 必须保留。

Source observation、AI interpretation 和 Provider analysis只能产生 observed/inferred Assertion 或 candidate binding。Reconcile/Adopt 的显式 policy 决定哪些输入可以进入 canonical authority；不能通过 strongest-wins、last-write-wins 或多数票压缩来源。

### 5. Responsibility、Delta 与 Impact

Responsibility 是 Engineering Semantic Model 中的稳定工程责任对象；它绑定 owned state、operations、effects、permissions、contracts、resources、source/artifact bindings 和 lifecycle。Responsibility reconstruction 可以从 Source Program Model 生成候选，但候选保持 `authoritative: false`，直到显式 Adopt 或 canonical rule 取得 authority。

Delta/Impact authority分离并比较 independently validated endpoints：

- Fact/Assertion Delta只比较canonical semantics；
- `ImplementationBindingDelta`只比较old/new exact Binding集合；
- Semantic / Implementation Impact传播到Responsibility、consumer、Artifact、dependency、runtime、Verification、release和support surfaces；
- Change Management消费Delta/Impact与Evidence，产生Compatibility Decision和Migration，不重做Comparator；
- Actual Delta不能由Resolver、UI、Migration或测试结果提交。

实现切换不能伪装成源码文本变化，也不能自动改写Semantic Contract。Changed files、测试列表、AI 风险评分、semver和 UI 边方向都不能替代 canonical Delta/Impact 或 Compatibility。

### 6. Operation、Authorization 与 Plan

任何用户、AI、CLI 或 Workbench 写请求都必须进入版本化 Engineering Operation：

```text
intent
+ semantic target
+ expected revision
+ implementation constraints / preferences where applicable
+ requested effects
+ required permissions
+ must-preserve / forbidden effects
+ verification obligations
```

平台从 caller capability、Operation Registry、semantic target、source owner、physical path/region、Policy、Provider capability、minimum Verification 和 current revision 的交集重新派生 authorization。

Planner 只读地解析 owner/path、运行 isolated transform、重建 canonical state、计算preview Resolution、Delta/Impact和Verification union，产生 immutable plan 或 blocked diagnostics。Caller 不能提交 derived path、Eligibility、Decision、Binding、Delta、Impact、risk、rollback 或 terminal status。实现选择输入只能表达受治理的constraint、preference、require、forbid、pin或custom request；所有derived结果由平台重新计算。

### 7. Transactional Mutation

Mutation 把合法 Operation 计划应用到 Authoring/Governed Source：

```text
validate expected plan
→ acquire unique writer authority
→ reread live inputs and re-plan / re-resolve
→ source + semantic CAS
→ durable journal
→ stage exact write set
→ pre-publication Verification
→ publish
→ live canonical rebuild / re-resolution
→ actual Semantic / Binding Delta and Impact
→ Compatibility / Migration checks where applicable
→ post-publication Verification / readback
→ accepted | rejected | rolled-back | recovery-required
→ cleanup receipt
```

不存在 partial-success。无法证明 accepted 或 exact prior-state rollback 时必须进入 recovery-required。Semantic Mutation 唯一拥有单次 source/canonical transaction 的 journal、publish、rollback 和 recovery；Change Management只拥有跨版本Compatibility、migration、compensation、forward recovery 与 irreversible boundary；Delta/Impact只拥有结构变化和传播事实。

### 8. Verification 与 Evidence

Verification 分离：

```text
Requirement / Claim
→ Gate definition
→ physical observation / execution record
→ owning-environment-aware aggregate
→ Decision / merge or product consumer
```

Result 至少区分 `passed | failed | not-run | unsupported | invalidated`，并独立记录 executed/reused/not-executed、applicability、environment、input closure、artifacts、cleanup、expiry 和 invalidation lineage。

Verification PASS 只证明 exact requirement 和 input closure；不能自动证明Eligibility、Compatibility、packaged/deployed 或 product-supported。Evidence Ledger 拥有 record、freshness、coverage、bias、expiry 和 references；Engineering IR 只保存 Assertion 对 Evidence identity 的引用。Provider或Implementation candidate的conformance、benchmark、安全、许可证和运行结果都是Resolution/Compatibility的输入Evidence，不是最终实现选择或迁移authority。

### 9. Implementation Resolution

Implementation Resolution 只消费validated Engineering/Application/Behavior requirements、Target capability、repository existing-stack facts、用户/组织约束、Provider/Adapter catalog Evidence与版本化Resolution Policy，产生：

```text
Implementation Requirement
→ canonical candidate closures
→ Eligibility Results
→ Resolution Decision
→ exact frozen Implementation Binding
```

它不拥有：

- 产品或业务Semantic Contract；
- Source Program观察和Provider分析事实；
- Registry trust和Block内容绑定；
- package/lock写入和安装；
- Host/Target物理支持；
- Fact/Binding Delta与Impact；
- Compatibility、Migration或retirement decision；
- Verification结果；
- Target Program打印和Artifact发布。

正确性、安全、权限、Target、许可证和dependency闭包等硬条件先过滤；unknown/conflict保持显式；优化policy只作用于合格候选；仍并列时使用稳定tie-break。相同完整输入必须产生相同Decision与Binding。Generator、Backend、Adapter、UI、Block Resolver和package materializer不得重新选择实现。

Block Capability Resolution与Implementation Resolution为上下层不同协议：Implementation Resolver可以请求一个受约束的`block-delivered`候选；Block Resolver只在其Registry/Block领域内返回冻结BlockProviderBinding，不能替产品决定原生、参考、既有、自定义或Block实现谁更优。

### 10. Target Compilation

Target compilation 只消费 validated Engineering Semantics、显式 Target Profile和冻结的ImplementationBinding：

```text
Engineering Semantic Model
→ Application IR
→ Behavior IR
→ Implementation Resolution
→ exact Implementation Binding
→ Target Program IR
→ Backend
```

- **Application IR**：目标无关的 module/service/data/state/operation/policy/effect/verification 结构；
- **Behavior IR**：SEC 能完整验证和 lowering 的受限控制流、数据流、state/effect/error/authorization/transaction；
- **Implementation Binding**：每个需要具体实现的能力所选Provider/Reference/Existing/Custom闭包及其exact revisions；
- **Target Program IR**：目标语言 package/module/declaration/statement/expression/import/export/config/resource binding；
- **Backend**：AST、printer、formatter、typecheck、package/config lowering 和最终 bytes。

每层只有一个 producer、raw/validated boundary、identity/revision、validator、canonical ordering、diagnostic 和 source map。Target Program IR和Backend不得重新读取raw Contract、live Registry或依赖catalog来选库。新层只有在真实 consumer 暴露现有层无法安全表达的 gap 时才物理落地；完整设计已冻结不等于提前实现无消费者的 IR 空壳。

### 11. Product Surface

CLI、Workbench、ExplainGraph、SemanticView、Implementation View、ReviewSummary、Context Packet、Agent Task、文档、Gate、Release 和 dashboard 都是 canonical state 的消费者。

Workbench 只拥有 view/inspector、interaction、transport/session 和 bounded proposal projection；Operation Envelope、Role、Permission、Implementation Decision、Binding Delta、Compatibility、Verification 和 terminal result由各自 machine owner拥有。

Projection 可以过滤、布局和聚合，但必须保留 stable references、revision、authority、unknown 和 Evidence freshness，不能复制或重算上游裁决。实现视图可以解释选了什么、为什么、精确版本、淘汰原因、Binding变化和升级影响，但不能把用户点击或AI建议直接变成Binding、Delta或Compatibility Decision。

## Workspace 状态与路径类别

路径只是物理 binding，不是跨域 identity。一个 workspace 至少区分：

- `source/**`：开发者或受控 Mutation 拥有的 Authoring Source、Governed Source 与 Opaque Boundary；
- `project/**`：生成目标或 adopted runtime artifact；人工修改形成 Drift 或受治理 Override；
- `control/**`：Lock、Verification、Provenance、Review、Workflow 等持久治理投影；只有对应 owner 可写；
- `.sec/cache/**`、派生 build info 与可重建索引：可删除、可重算、不能成为 Evidence 或 authority；
- `.sec/workspace-write-lease/**`、transaction journal、recovery state 与其他 identity-bound control state：不可按“本地缓存”整体删除；
- runtime/toolchain materialization：可重建但绑定 package、lock、provider、platform、Implementation Binding和generation identity；ambient cache 不能冒充当前实例。

因此 `.sec/**` 不是一种统一生命周期。任何清理器、fixture、worktree hygiene 或发布逻辑都必须先通过机器分类，unknown 默认拒绝删除、复制或并行共享。

## 跨域引用

Domain 只通过 stable identity 与 revision 关联：

```text
Physical source/artifact
↔ Source Program object/span
↔ Semantic Entity/Fact/Responsibility
↔ Implementation Requirement/Decision/Binding
↔ Fact / ImplementationBinding Delta and Impact
↔ Compatibility Decision / Migration
↔ Target Program/Artifact
↔ Operation/Plan/Transaction
↔ Verification Claim/Evidence
↔ Documentation owner/consumer
↔ Workflow/Gate
↔ Agent operation
↔ Release artifact/promotion
↔ Product decision/rationale
```

禁止通过显示名称、相邻路径、同名字符串、数组位置或复制整份对象建立隐式关联。跨域 validator 必须检查引用存在、revision 兼容、owner 唯一、循环依赖和 unresolved frontier。

## 单写者与依赖方向

每个 canonical type、state、identity/revision algorithm、pipeline stage、writer、resolver、comparator、compatibility evaluator、selector、cache truth 和 public facade 只有一个 owner。合法依赖方向是：

```text
authority / validated upstream state
→ deterministic producer / resolver / comparator
→ validated downstream state
→ decision / projection / physical executor
```

Adapter、Workbench、AI、Provider、测试、文档和 Backend 不得反向拥有上游语义；Block Resolver、Implementation Resolver、Delta comparator、Compatibility evaluator、dependency solver和Backend也不得互相复制算法。

迁移固定执行：

```text
retain current owner
→ shadow/read-only compare
→ prove decisions/bindings/deltas/compatibility/bytes/diagnostics/effects/consumer parity
→ migrate consumers
→ switch the single resolver/comparator/writer
→ invalidate old revisions
→ delete or archive old owner
```

在 Decision、Binding、Delta、Compatibility、source bytes、diagnostics、副作用、consumer 和 failure parity 未证明前，新旧owner不能同时决定或写入同一scope/artifact。

## 能力成熟度

所有能力必须使用前置完整的成熟度，而不是一个“支持”标签：

```text
proposed
→ contract-frozen
→ implemented-in-main
→ physically-verified
→ packaged/deployed
→ product-supported
```

对于 Workspace Domain 可进一步使用：inventory → validated model → query/projection → Delta/Impact → Mutation → Migration → Fault/Recovery → product-supported。

文档、类型、fixture、PR 或单平台测试不能跨越后续层级。Implementation Resolution、Binding Delta和Compatibility只有在各自TypeScript contract、真实producer/consumer、migration、positive/negative/failure/property tests 和 main readback闭合后才是当前能力。

## Agent Operation System

SEC 自身开发最终使用：

```text
Universal repository policy
→ typed WorkDecision
→ Task Capsule Compiler
→ explicit Agent Role + typed Operation Envelope
→ zero or one applicable trusted Skill
→ deterministic domain decisions and physical Actions
→ VerificationSession composition and legal next transition
→ external Evidence / Review / Integration / main readback
```

Role 拥有职责和可申请权限上限；Envelope 授予当前 operation 的 exact target、path、
capability 和 completion claims；Skill 只是需要 Agent 判断的 workflow recipe。
Task Capsule 是独立 pure compiler 的不可变输出，拥有 selected work、owner/root-cause、
scope、Impact 与 Verification obligations；VerificationSession 只能引用其 ref、digest 和
revision，不能拥有 Capsule 内容、编译规则或 lifecycle。

VerificationSession 是唯一 development run coordinator，拥有 run/session identity、event、
transition、resume verification 和所引用事实的 composition；它不重新拥有 Work、Task
Capsule、Impact、Failure、Action、Evidence、Review、Provider 或 Integration。系统不建立
general Run Kernel，也不以另一个 current-phase ledger 包装这些 owner。

NextTransitionCompiler 只组合各 owner 已签发的 typed decisions：WorkDecision、FailureDecision、
ImpactDecision、ActionState、SessionState、ReviewFreshness、ProviderAvailability 与
IntegrationState。它必须是同输入 byte-stable 的 pure composition resolver，只能输出
`execute | join | wait | blocked | complete` 及前置条件，不能选择 Issue、重算 Impact、判断
failure owner、Review freshness 或 merge legality。

Repository snapshot、Work Package、Impact selection、Failure/Epoch、Verification Result、
Evidence reuse、permission intersection、Integration 和 merge legality必须由机器 owner决定，
不能重复写进多个 Skill。VerificationSession production consumer 未由 new-main canary 激活时，
只能从 Git/PR/manifest/Evidence 做 manual-shadow 恢复，不能用聊天摘要冒充外部状态。

### 开发控制面 identity 分层

开发控制面不得把内容、Git transport、Review 和发布身份压成一个 SHA：

```text
ScopeGrantId
→ CandidateContentId
→ CandidateGenerationRef
→ ActionKey / Evidence identity
→ ReviewSubjectId
→ PromotionId
→ merged main readback identity
```

- `CandidateContentId` 只绑定会改变候选内容语义的 base dependency、candidate tree、
  ScopeGrant 与 manifest semantic revision；等价内容重新 materialize 时保持不变；
- `CandidateGenerationRef` 绑定 run、单调 generation、content identity 与 exact Git head，
  用于恢复、PR transport 和 invalidation history；
- Action 只绑定其实际 subject closure；整个 candidate tree 只有在 Gate contract 真实读取
  全树时才进入该 ActionKey；
- ReviewSubject 与 Promotion 始终绑定 exact head/tree 和各自 live policy/facts，不能仅凭
  content identity 复用授权。

### 持久状态准入

domain 数量由 `docs/authority.json` 推导，state-machine 数量也不是架构常量。只有某对象同时
具备真实跨进程世界状态、外部副作用或竞争、crash recovery/CAS/lease 需求、无法从其他
canonical facts 纯计算、唯一 writer/consumer 以及 migration/retirement 时，才允许建立 durable
state machine。Evidence、freshness、health、applicability、maturity 和 next-transition projection
优先保持 immutable record、truth lattice 或 pure evaluator；不得为了展示 phase 再建状态机。

## 生命周期与失败

所有长期状态必须能回答：创建者、owner、revision、可变性、读者、失效规则、持久化边界、并发、清理、恢复与退役。进程退出、请求返回、文件存在或单次测试通过都不自动证明状态已提交、资源已收口或下游可以继续。

跨层失败遵循：

- 上游 validation 失败，后续 producer blocked，不生成猜测输出；
- Source observation coverage不足时保留 unknown，不伪装不存在；
- Implementation eligibility无法证明时保留unknown/unsupported/conflicted，不自动沿用旧Binding或选择近似Provider；
- old/new Binding无法比较时不生成空Delta；
- Compatibility无法证明时保持unknown，不自动进入Migration或发布；
- Projection 失败不回写 canonical state；
- Evidence 缺失或 stale 不改写事实；适用 Claim 要求它时阻止成功；
- 发布前失败不得产生 live write；
- 已发布写入失败必须证明 exact rollback，否则 recovery-required；
- cleanup/readback 失败属于结果的一部分，不能被产品断言通过覆盖；
- Full/runtime 反例暴露遗漏关系时修复 owner/rule/selector，不只追加一个全量测试。

## 架构演进约束

新增一层、一个 Domain、一个 Skill 或一个公共写入口前，必须证明：

- 它拥有独立对象、identity 和 lifecycle；
- 存在真实 producer 和 consumer；
- 不建立第二 authority、writer、loader、revision、resolver、comparator、compatibility evaluator、selector 或 pipeline；
- 有 migration、compatibility、negative/fault tests 和 retirement；
- 对当前主线的收益高于上下文、维护和验证成本。

大型未知探索只产生 Evidence。正式结果按唯一 owner 进入聚焦 Work Package；不能把完整 Spike 历史、并列总计划或未来状态机直接合并进主干。
