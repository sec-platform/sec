---
title: 产品目标与系统边界
status: stable
domain: product
last-reviewed: 2026-08-06
---

# 产品目标与系统边界

本文只拥有 SEC 要解决的问题、目标用户结果、产品边界与长期成功判据。阶段顺序由 `docs/roadmap.md` 拥有，总体对象和权威流由 `docs/system-architecture.md` 拥有，领域字段、状态机与算法由各 canonical 代码合同拥有。当前实现能力只能从最新 `main` 与适用 Evidence 重算。

## 问题

大型软件的工程知识分散在源码、测试、配置、依赖、构建、运行时行为、发布系统和开发者经验中。文件与函数是必要实现载体，但不足以稳定表达：

- 一个能力负责什么、依赖什么、向谁提供什么；
- 状态由谁拥有、谁能读写、何时失效和如何恢复；
- 哪些权限、Effect、Policy、Acceptance 与风险必须保持；
- 同一语义可以由哪些实现完成，当前为什么选择其中一个；
- 某个类库、版本、Adapter或自定义实现究竟满足哪些合同、在哪些Target成立；
- 依赖升级、Provider替换或源码生成方式变化是否保持原产品行为；
- 一个变更实际改变了哪些工程事实、实现绑定和消费者；
- 一个生成物、判断或验证结果来自哪里、是否仍适用于当前 revision；
- 既有工程中哪些关系已证明、哪些只是观察、推断、冲突、未知或 opaque；
- AI、用户、工具和 Provider 可以读取、推断、提议、选择和修改到什么边界。

SEC 的核心命题是：

> 把隐式工程知识提升为可声明、可观察、可组合、可解析、可推导、可验证、可追踪并可安全变更的工程语义。

SEC 不是为了隐藏源码，也不是要求用户精通所有框架和类库；它要让用户主要控制稳定语义、约束和最终决策，同时由平台承担实现解析、确定性生成、兼容验证和迁移机械工作。

## 两条产品主链

SEC 同时服务两类真实工程，但它们必须共享同一个 Engineering Semantic Model，不能发展为两套 identity、Responsibility、Effect、Permission、Implementation truth 或 Verification 真值。

### 既有工程治理

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

用户可以在不先重写工程、不先封装 Block、也不假装完整理解所有源码的前提下：

- 看见完整物理工程、依赖闭包和受支持的源码结构；
- 区分 authoritative、derived、observed、inferred、ambiguous、unknown 与 opaque；
- 对没有专用Adapter的类库先进行type-safe结构化调用；
- 逐步建立 source owner、Responsibility、Contract、Effect、Permission 与 Acceptance；
- 将未知实现保持为Governed Extension或Opaque Boundary，而不是被迫全部重写；
- 在明确写权限和 must-preserve 边界内执行受控变化；
- 对 actual Semantic/Binding Delta、Impact、Verification、发布和恢复形成可追踪闭环。

### 确定性工程生成

```text
Product Intent / Contract / Block
→ Engineering Semantic Model
→ Application IR
→ Behavior IR
→ Implementation Resolution
→ exact Implementation Binding
→ Target Program IR
→ Backend
→ Source / Test / Config / Artifact
→ Verification / Evidence
```

用户可以声明产品意图、工程合同和可复用能力，SEC 通过 validated、target-independent、implementation resolution和target-specific层逐步lowering，确定性地产生真实项目源码与标准工程产物。

平台不能直接在“无数种源码文本”中凭模型偏好选择。它必须先淘汰不满足Semantic Contract、Target、安全、权限、许可证、dependency closure和Verification要求的实现，再按明确政策在合格候选中选择，并以稳定tie-break得到唯一结果。

Backend 不能重新猜业务语义或选择类库；Generator 不能按 Customer、Ticket 或品牌名称特化 Core。

### 共享闭环

两条主链共同使用：

- stable Entity / Fact / Assertion identity；
- Semantic Contract 与 Semantic Responsibility；
- State、Operation、Policy、Permission、Effect、Scenario 与 Acceptance；
- Implementation Requirement、Constraint、Decision 与 exact Binding；
- Authoring Source、Governed Extension 与 Opaque Boundary；
- Fact/Binding Delta、Impact、Provenance、Explain 与 Verification；
- 统一 Operation、Mutation、transaction、journal、rollback/recovery；
- Host、Toolchain、Target、Provider、Adapter 与 Distribution 的正交边界。

Brownfield Adopt 后的 source 与新工程 Contract 都只是不同 Authoring Source。Normalize 只是把已完整证明的 Governed Source/Provider局部切换为 SEC-owned deterministic projection，不创建第二语义母模型。

## 用户控制模型

开发者拥有最终决策权，但不必亲自承担所有机械选择。产品必须提供渐进控制：

- **Intent**：只声明要实现的行为和合同，由平台选择实现；
- **Constraint**：声明runtime、平台、成本、许可证、安全、隐私、dependency、resource和portability硬边界；
- **Prefer**：合格时优先某Provider、built-in、existing-stack或某Resolution Policy；
- **Require**：强制某实现族，不合格则整体blocked；
- **Forbid**：禁止某Provider、包、许可证、Effect、network、native或Target；
- **Pin**：锁定exact package/version/integrity/config/Adapter，但不能绕过hard eligibility；
- **Custom**：使用用户自己的TypedInvocation、Governed Source或Custom Provider；未知内部保持opaque；
- **Bounded override**：只在明确Policy允许的紧急/迁移边界内，绑定理由、expiry、Verification和reversal。

这些模式都进入同一个Engineering Operation，不形成多套写路径。用户指定实现后，平台可以跳过候选偏好比较，但不能跳过类型、Target、安全、合同、compatibility和Verification。

## 任意类库与正式支持

产品不能把“官方支持/不能使用”做成二分：

```text
L0 physical dependency
→ L1 typed external invocation
→ L2 declared governed invocation
→ L3 observed / inferred candidate
→ L4 verified Provider / Adapter
→ L5 normalized SEC-owned projection
```

- L0/L1允许用户立即安装或结构化调用陌生类库，不要求SEC预先拥有专用Adapter；
- L1只证明调用shape和类型，不证明Effect、幂等性、retry、timeout、cancellation、安全和runtime behavior；
- L2允许用户声明受治理边界，但声明仍需验证；
- L3分析和AI只产生candidate/Evidence；
- L4才允许平台自动选择、迁移并形成正式候选；
- L5只适用于能完整表示、round-trip、验证、迁移并删除旧writer的局部范围。

因此“任意类库可用”与“平台理解全部行为”“官方承诺支持”是不同产品能力。未知必须可用但诚实地保持unknown/opaque。

## 用户可观察结果

用户面对的不是脚本集合，而是一个可操作的工程语义与实现空间。用户应能直接看到：

- 当前系统的 Responsibility、Boundary、State、Data、Contract、Effect 与 Permission；
- 当前实现需求、候选、Eligibility、Resolution Policy、最终Decision和exact Binding；
- 选择了哪个Provider/package/version/Adapter/Target，为什么选择；
- 哪些候选被淘汰，原因是合同、Target、安全、许可证、依赖、Support还是unknown；
- 某个实现属于physical dependency、typed invocation、governed、verified还是normalized；
- 一项提议会改变什么、影响什么、哪些区域仍未知；
- 依赖升级或Provider切换产生的Binding Delta、Compatibility Decision和Migration要求；
- 哪些验证已经执行、在哪个环境执行、证明了什么、何时失效；
- 哪个 owner 能实施变化，哪些路径、资源或副作用被禁止；
- 失败是否 rejected、blocked、failed、rolled-back，还是 recovery-required；
- 当前阻塞来自产品语义、实现资格、工程能力、环境、Evidence、Compatibility、Support 还是治理条件；
- 一个结果属于 declared、implemented、physically verified、packaged/deployed 还是 product-supported。

UI、CLI、AI Adapter 和报告可以使用不同投影，但必须指向同一 canonical identity、revision、plan、Decision、Binding、result 与 Evidence，不能分别维护成功或实现选择状态。

## 核心价值

### 理解

把分散关系投影为 Architecture、Scenario、Data、State、Contract、Effect、Implementation、Impact 与 Evidence，使维护者不必每次从文件、调用链、package文档和历史经验重新猜系统含义。

### 实现

以 Block、Semantic Contract、Provider、Adapter、Reference Provider、Governed Source 和受治理扩展复用工程能力。复用单位包含合同、类型、Target、验证、来源、权限、迁移和失败边界，而不是只复制文件或API调用。

平台优先采用成熟可靠轮子，但只在真实consumer、同条件A/B、安全/许可证审查、conformance和退出条件闭合后正式采用。SEC原生实现只承担自身独有语义或少量Reference基准，不重写整个软件生态。

### 演进

以 stable identity、Fact Assertion、Fact/Binding Delta、Impact、Verification、Compatibility、Migration、Provenance 与 Recovery 控制长期漂移，使变更可以解释、验证、拒绝、回滚、恢复、替换实现和重新生成。

### AI 治理

平台选择或接受一个 Operation，构造最小充分 Context Packet，授予角色、语义操作、实现约束、路径、Effect 和预算上限，并独立解析和验证结果。AI 只提交 proposal或Provider/Adapter candidate；模型能力、confidence、长上下文或自然语言指令都不能扩大权限或伪造最终Binding。

目标不是依赖更强模型维持工程正确性，而是通过结构化事实、受限操作和机器合同降低模型能力与 token 需求。

## 核心单位

- **Block**：分发、版本、信任、升级、迁移和资产封装单位；不是默认架构理解或最终实现选择单位。
- **Semantic Contract**：声明 Entity、Responsibility、Operation、State、Policy、Permission、Effect、Scenario 与 Acceptance。
- **Semantic Responsibility**：工程对象承担状态、行为、Effect、资源与合同责任的稳定理解单位，可以位于一个 Block 内或通过显式合同跨 Block。
- **Semantic Fact / Assertion**：最小 canonical 工程陈述，以及不同来源对该陈述的独立声明。
- **Implementation Requirement / Constraint**：从validated语义派生的实现需求和不可被优化抵消的边界。
- **Resolution Decision / Implementation Binding**：可解释选择记录，以及精确Provider/package/version/config/Adapter/Target/dependency闭包。
- **Provider / Adapter**：提供具体能力的可替换实现，以及稳定Contract到其API的映射；不拥有业务Responsibility。
- **Authoring Source**：用户、项目或受治理操作可以修改的权威输入。
- **Source Program Model**：对物理源码、模块、符号、类型、引用和候选流关系的 observed/derived 表示，不自动拥有业务 authority。
- **TypedInvocation**：无专用Adapter时对外部函数/构造器/方法的结构化类型调用，默认保留行为unknown。
- **Governed Extension**：SEC 不完全表达内部算法，但拥有接口、Effect、Owner、Source binding 与 Verification 的代码区域。
- **Opaque Boundary**：当前不能安全理解、重生成或自动修改的显式边界。
- **Engineering Operation**：对 semantic target 的受限意图，绑定预期 revision、实现约束、Effect、Permission、must-preserve 与 Verification；不是任意文件 patch。
- **Verification Claim / Evidence**：对 exact input、Binding、environment 和 requirement 的物理证明，不等同于一个绿色命令状态。

图、文件、模块、包、UI 卡片、Binding和外部分析结果都可以映射这些对象，但不能自动取得Engineering authority。

## 产品形态

- **CLI**：确定性编译、实现解析、查询、验证、迁移与恢复的薄入口。
- **Local Workbench**：理解、Review、Implementation解释、影响预览、决策和受控操作面，不是普通 IDE 或低代码私有运行时。
- **AI / Tool Adapter**：只暴露有权限的查询与 proposal 接口，不暴露第二套写路径或实现选择器。
- **Registry**：分发 Block、Contract、Generator、Provider/Adapter声明、Verification 与 Migration；长期资产不是模板数量。
- **Provider 层**：语言前端、静态分析、运行时观察、应用类库、浏览器、构建和外部工具以可替换能力接入。
- **Agent Operation System**：以 Role、typed Operation Envelope、一个 Primary Skill、确定性服务和外部 Run State 组织 SEC 自身开发，不让 Skill prose 成为第二状态机。

所有入口必须消费同一 canonical producer、Implementation Resolver、Operation/Mutation facade 和 Verification 结果真值。

## 优先适用范围

第一目标是 TypeScript 工程中的可重复业务与工程语义，优先覆盖：

- B2B SaaS、管理后台和控制面；
- 工单、CRM、ERP 子域和内部工具；
- 多服务应用中的合同、状态、权限和集成边界；
- AI Agent 应用层及其工具、权限、状态和验证；
- 具有明确输入、输出、Effect、Policy 和 Acceptance 的工程能力；
- 具有真实源码、配置、依赖、测试和发布面的 Brownfield TypeScript 工程。

数据库内核、编译器后端、实时渲染、高性能数值内核等复杂算法不应被强塞进通用 Behavior IR。SEC 在这些区域优先治理接口、资源、Effect、Ownership、Benchmark、Implementation Binding 与 Verification Boundary，内部实现可以长期保留为 Governed Extension 或 Opaque Boundary。

## 与相邻系统的边界

- 脚手架和模板解决初始化；SEC 负责持续组合、实现解析、验证、升级、来源和语义变化。
- SDK 和库复用调用点；SEC的Provider/Adapter/Block复用能力、合同、生成策略、验收与迁移。
- 包管理器解析包名与版本依赖；SEC额外解析“哪个完整实现闭包满足当前Semantic Contract和Target”。
- 工作流引擎编排运行时流程；SEC 位于工程构建、演进和治理层。
- 低代码平台通常绑定专用运行时；SEC 输出真实项目源码和标准目标，并允许用户从自动选择到精确pin/custom。
- 代码知识图从源码推断关系；SEC 的 canonical semantics 来自受权威输入、显式采用和编译规则，源码图只提供 Evidence 或候选。
- AI 编码助手直接操作源码；SEC 把 AI 限制为受控 Semantic/Implementation proposal operator 或 bounded source operator。
- 通用 AGI 试图拥有开放世界行动；SEC 只在可验证工程对象、权限、状态和操作合同内提供工程智能。

## 非目标

SEC 不是通用 IDE、低代码私有运行时、模板市场、单纯代码知识图、任意语言自动翻译器、万能包市场、自由式整仓 AI 编码器或依赖私有聊天状态才能继续的 Agent harness。

SEC 不承诺：

- 把任意程序完整还原为高级业务语义；
- 预先内建或正式支持世界上所有类库和版本；
- 在不知道行为时仍保证某个实现满足合同；
- 存在脱离Contract、Target、Policy和Evidence的宇宙唯一最优源码；
- 通过重写所有成熟轮子获得通用性。

无法证明的关系必须保持 observed、inferred、ambiguous、unknown 或 opaque；完整性不足不能通过 AI confidence、Provider 多数票、类型检查、semver或默认框架惯例掩盖。

SEC 也不以一次性生成大量 IR、Provider、Domain、Skill、Gate 或治理 schema 作为进展。没有真实 producer、consumer、迁移与验收的结构保持 proposal。

## 永久边界

- `main` 与 canonical Authoring Source 是正式工程事实；PR、聊天、报告和投影不是。
- AI、Workbench、CLI 和 Provider 不直接写 canonical IR、Implementation Decision、Verification、Evidence 或治理 terminal result。
- Projection、报告、图、缓存和 Evidence 不反向成为事实源。
- Brownfield 与 deterministic generation 共用同一 Engineering Semantic Model。
- Engineering semantics、Implementation Resolution、Binding Delta、Compatibility/Migration、Verification和Artifact publication各有唯一owner。
- 新同类业务模型不得要求 compiler core 增加业务或品牌名称分支。
- unknown、ambiguous、stale、conflicted 和 opaque 必须显式。
- 用户可以约束、偏好、强制、禁止、pin或提供Custom实现，但不能迫使平台把不合格实现标为正确。
- 任何自动写入都必须有唯一 owner、authorization、actual Semantic/Binding Delta、Impact、Verification 与 rollback/recovery。
- Observation、Impact、Authorization和Implementation eligibility 未闭合前，不得把通用 Mutation 视为完成。
- Host Runtime、Toolchain Provider、Target Profile、Implementation Binding、Runtime Environment 和 Distribution 保持分域。
- Verification PASS、Eligibility、Compatibility、implemented-in-main、packaged/deployed 和 product-supported 是不同状态，不能自动互推。
- Skill 是非权威 workflow recipe，不拥有 Role、Permission、State、Implementation Resolution、Verification、Evidence 或 merge truth。
- 一项声明只有在实现、适用环境验证、分发和现实使用面全部闭合后，才成为支持承诺。

## 长期飞轮

```text
高质量 Contract / Observations
→ 更准确的 canonical state
→ 更可靠的 Responsibility / Implementation Requirements
→ 更准确的 Resolution Decision / Binding
→ 更可靠的 Semantic / Binding Delta 与 Impact
→ 更小的 Operation Envelope / Context Packet
→ 更强的 Verification / Recovery
→ 更安全的 Mutation / Upgrade / Migration
→ 更可复用的 Block / Provider / Adapter / Evidence
→ 更低的维护成本
→ 继续沉淀 Contract、实现候选、迁移和运行历史
```

真正的资产不是 Prompt、模板或某个流行库，而是可演进的 Contract、Block、stable identity、Fact Provenance、Source/Implementation binding、Verification、Migration 和已验证的 Provider 协议。

## TypeScript 产品闭环成功判据

SEC 达到首个真实 TypeScript 产品闭环时，应同时满足：

1. 多组无关业务模型不修改 compiler core 的业务或品牌分支。
2. 同一个 Engineering Semantic Model 同时服务 Brownfield governance 与 deterministic generation。
3. 支持的模型可以完整 lowering；不支持的组合在Implementation Resolution或emit前确定性拒绝。
4. 同一 validated semantics、Target、constraints、Provider catalog、Resolution Policy和Backend revisions产生相同Decision、Binding与byte-stable结果。
5. 对真实 TypeScript workspace 建立可重复的 Physical Inventory 与 Source Program Model，并显式显示 coverage、unknown 和 opaque。
6. 没有专用Adapter的外部package可以通过TypedInvocation结构化调用，但行为unknown不会被伪装成正式支持。
7. Responsibility reconstruction 能输出 source binding、state/effect/permission facets、conflict 与 confidence，且候选不越权成为 authority。
8. 同一Target-independent Contract至少有两个无关合格实现；一个不合格和一个unknown候选能够fail closed。
9. `prefer`不合格时可解释回退，`require/pin`不合格时blocked，Custom实现保持受治理和opaque边界。
10. 变更前可以计算保守 predicted Semantic/Implementation Impact，变更后可以验证actual Fact/Binding Delta、actual Impact 与可观察行为。
11. 依赖升级或Provider替换不会静默改变timeout、retry、error、serialization、consistency、安全或Effect；无法保持时产生明确Migration。
12. 至少一个 canonical Authoring Source operation 和一个 Brownfield Governed Source operation完成 authorization、CAS、transaction、Verification、rollback/recovery 与 readback。
13. 未完整理解的源码仍可被安全观察、显式拥有并在受限边界内修改。
14. Workbench/CLI可以从intent/constraint到pin/custom执行主要Semantic Operations，并解释选择、淘汰原因与迁移影响，不建立第二写路径或Resolver。
15. AI 只在小而明确的 Context Packet、Operation Envelope、角色权限、实现约束和路径交集内提交 proposal/candidate。
16. 失败要么在发布前拒绝，要么恢复 exact prior state/Binding，要么进入可诊断的 recovery-required。
17. 用户看到健康、实现、影响、证据、未知和阻塞，不需要理解内部脚本或精通每个类库才能判断工程状态。
18. clean package、exact Binding closure、目标 Host/Target physical Evidence、发布 receipt 与 support maturity分别可验证。
19. 至少两个与 SEC reference business 无关的真实外部 TypeScript 工程重复核心纵切片，Core 不增加业务或品牌名称分支。
