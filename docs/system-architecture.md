---
title: 系统架构与权威流
status: stable
domain: system-architecture
last-reviewed: 2026-08-04
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
→ Target Program IR
→ Backend
→ Source / Test / Config / Artifact
→ Verification / Evidence
```

两条链共享 Engineering identity、Responsibility、State、Operation、Policy、Permission、Effect、Scenario、Acceptance、Provenance 和 Verification truth。Brownfield 不能建立一套“源码图语义”，Generator 也不能建立另一套“模板语义”。

### 产品回路

```text
canonical state
→ query / projection / Workbench / Context Packet
→ user or AI proposal
→ platform-owned Operation ingress
→ plan without live writes
→ apply under transaction and CAS
→ canonical rebuild
→ actual Delta / Impact / Verification
→ accepted | rejected | rolled-back | recovery-required
→ projections reload from accepted canonical revision
```

UI、CLI、HTTP、AI Adapter 和 Provider 都只能通过同一个产品 adapter 消费该回路，不能各自维护写路径或成功状态。

## 四种不同身份

- **Authority**：谁有权声明、修改或裁决输入和策略。
- **Canonical state**：由确定性 producer 从受权威输入构建、验证和冻结的工程状态。
- **Evidence**：某个来源、方法、revision 与环境下的观察、测量、执行或推断。
- **Projection / Artifact**：为用户、工具、运行目标或治理消费者生成的输出。

同一个物理文件可以承载其中一种身份，但路径、格式、Git 状态或被多个消费者读取不会自动改变它的身份。Evidence 不能通过 confidence、多数票或 UI 接受动作自动成为 authoritative Fact；Projection 也不能反向修改 canonical state。

## 核心对象层

### 1. Authoring 与显式决策

拥有产品意图、Semantic Contract、Block 引用、Policy、受治理源码、Rule-backed Override、Migration decision 和显式 Adopt decision。

Authoring Source 是可修改的权威输入，不等于所有源码。Registry source、generated artifact、cache、Evidence、IR JSON、journal、UI state 和外部 Provider 输出默认都不是 Authoring Source。

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

Delta 分离 Authoring、Entity、Fact/Assertion、Source、Artifact、Runtime Observation 与 Evidence 变化。Actual semantic Delta 只能比较两个 independently validated endpoints。

Impact 以 canonical Delta、两端 graph、版本化 propagation rules 和跨域 references 推导 direct/transitive consumers、certainty、witness、unknown frontier 和 Verification recommendation。Changed files、测试列表、AI 风险评分和 UI 边方向都不能替代 canonical Impact。

### 6. Operation、Authorization 与 Plan

任何用户、AI、CLI 或 Workbench 写请求都必须进入版本化 Engineering Operation：

```text
intent
+ semantic target
+ expected revision
+ requested effects
+ required permissions
+ must-preserve / forbidden effects
+ verification obligations
```

平台从 caller capability、Operation Registry、semantic target、source owner、physical path/region、Policy、Provider capability、minimum Verification 和 current revision 的交集重新派生 authorization。

Planner 只读地解析 owner/path、运行 isolated transform、重建 canonical state、计算 preview Delta/Impact 和 Verification union，产生 immutable plan 或 blocked diagnostics。Caller 不能提交 derived path、Delta、Impact、risk、rollback 或 terminal status。

### 7. Transactional Mutation

Mutation 把合法 Operation 计划应用到 Authoring/Governed Source：

```text
validate expected plan
→ acquire unique writer authority
→ reread live inputs and re-plan
→ source + semantic CAS
→ durable journal
→ stage exact write set
→ pre-publication Verification
→ publish
→ live canonical rebuild
→ actual Delta / Impact
→ post-publication Verification / readback
→ accepted | rejected | rolled-back | recovery-required
→ cleanup receipt
```

不存在 partial-success。无法证明 accepted 或 exact prior-state rollback 时必须进入 recovery-required。Semantic Mutation 唯一拥有单次 source/canonical transaction 的 journal、publish、rollback 和 recovery；Change Management 只拥有跨版本 migration、compensation、forward recovery 与 irreversible boundary。

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

Verification PASS 只证明 exact requirement 和 input closure；不能自动证明 Compatibility、packaged/deployed 或 product-supported。Evidence Ledger 拥有 record、freshness、coverage、bias、expiry 和 references；Engineering IR 只保存 Assertion 对 Evidence identity 的引用。

### 9. Target Compilation

Target compilation 只消费 validated Engineering Semantics 和显式 Target Profile：

```text
Engineering Semantic Model
→ Application IR
→ Behavior IR
→ Target Program IR
→ Backend
```

- **Application IR**：目标无关的 module/service/data/state/operation/policy/effect/verification 结构；
- **Behavior IR**：SEC 能完整验证和 lowering 的受限控制流、数据流、state/effect/error/authorization/transaction；
- **Target Program IR**：目标语言 package/module/declaration/statement/expression/import/export/config/resource binding；
- **Backend**：AST、printer、formatter、typecheck、package/config lowering 和最终 bytes。

每层只有一个 producer、raw/validated boundary、identity/revision、validator、canonical ordering、diagnostic 和 source map。新层只有在真实 consumer 暴露现有层无法安全表达的 gap 时才物理落地；完整设计已冻结不等于提前实现无消费者的 IR 空壳。

### 10. Product Surface

CLI、Workbench、ExplainGraph、SemanticView、ReviewSummary、Context Packet、Agent Task、文档、Gate、Release 和 dashboard 都是 canonical state 的消费者。

Workbench 只拥有 view/inspector、interaction、transport/session 和 bounded proposal projection；Operation Envelope、Role、Permission、Candidate、Verification 和 terminal result由 Development/Product/Verification 等 machine owner拥有。

Projection 可以过滤、布局和聚合，但必须保留 stable references、revision、authority、unknown 和 Evidence freshness，不能复制或重算上游裁决。

## Workspace 状态与路径类别

路径只是物理 binding，不是跨域 identity。一个 workspace 至少区分：

- `source/**`：开发者或受控 Mutation 拥有的 Authoring Source、Governed Source 与 Opaque Boundary；
- `project/**`：生成目标或 adopted runtime artifact；人工修改形成 Drift 或受治理 Override；
- `control/**`：Lock、Verification、Provenance、Review、Workflow 等持久治理投影；只有对应 owner 可写；
- `.sec/cache/**`、派生 build info 与可重建索引：可删除、可重算、不能成为 Evidence 或 authority；
- `.sec/workspace-write-lease/**`、transaction journal、recovery state 与其他 identity-bound control state：不可按“本地缓存”整体删除；
- runtime/toolchain materialization：可重建但绑定 package、lock、provider、platform 和 generation identity；ambient cache 不能冒充当前实例。

因此 `.sec/**` 不是一种统一生命周期。任何清理器、fixture、worktree hygiene 或发布逻辑都必须先通过机器分类，unknown 默认拒绝删除、复制或并行共享。

## 跨域引用

Domain 只通过 stable identity 与 revision 关联：

```text
Physical source/artifact
↔ Source Program object/span
↔ Semantic Entity/Fact/Responsibility
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

每个 canonical type、state、identity/revision algorithm、pipeline stage、writer、selector、cache truth 和 public facade 只有一个 owner。合法依赖方向是：

```text
authority / validated upstream state
→ deterministic producer
→ validated downstream state
→ projection / physical executor
```

Adapter、Workbench、AI、Provider、测试、文档和 Backend 不得反向拥有上游语义。

迁移固定执行：

```text
retain current owner
→ shadow/read-only compare
→ prove bytes/diagnostics/effects/consumer parity
→ migrate consumers
→ switch the single writer
→ invalidate old revisions
→ delete or archive old owner
```

在 source bytes、diagnostics、副作用、consumer 和 failure parity 未证明前，新旧 writer 不能同时写同一 artifact。

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

文档、类型、fixture、PR 或单平台测试不能跨越后续层级。目标架构字段只有在 TypeScript contract、producer、consumer、migration、tests 和 main readback闭合后才是当前能力。

## Agent Operation System

SEC 自身开发最终使用：

```text
Universal repository policy
→ explicit Agent Role
→ typed Operation Envelope
→ exactly one Primary Skill
→ deterministic services/contracts/tools
→ typed outcome and legal next transition
→ external Run State / Evidence
```

Role 拥有职责和可申请权限上限；Envelope 授予当前 operation 的 exact target、path、capability 和 completion claims；Skill 只是需要 Agent 判断的 workflow recipe。

Repository snapshot、Work Package、Impact selection、Failure/Epoch、Verification Result、Evidence reuse、permission intersection、Integration 和 merge legality必须由机器 owner决定，不能重复写进多个 Skill。Run Kernel 未实现时只能从 Git/PR/manifest/Evidence 做 manual-shadow 恢复，不能用聊天摘要冒充外部状态。

## 生命周期与失败

所有长期状态必须能回答：创建者、owner、revision、可变性、读者、失效规则、持久化边界、并发、清理、恢复与退役。进程退出、请求返回、文件存在或单次测试通过都不自动证明状态已提交、资源已收口或下游可以继续。

跨层失败遵循：

- 上游 validation 失败，后续 producer blocked，不生成猜测输出；
- Source observation coverage不足时保留 unknown，不伪装不存在；
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
- 不建立第二 authority、writer、loader、revision、selector 或 pipeline；
- 有 migration、compatibility、negative/fault tests 和 retirement；
- 对当前主线的收益高于上下文、维护和验证成本。

大型未知探索只产生 Evidence。正式结果按唯一 owner 进入聚焦 Work Package；不能把完整 Spike 历史、并列总计划或未来状态机直接合并进主干。
