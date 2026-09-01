---
title: 产品目标与系统边界
status: stable
domain: product
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

SEC 同时服务两类真实工程，但它们必须共享同一个 Engineering Semantic Model，不能发展为两套 identity、Responsibility、Effect、Permission、Implementation truth 或 Verification 真值。内部对象链、authority flow与依赖方向只由System Architecture拥有；本文只表达用户旅程与终局结果，不复制流水。

### 既有工程治理

用户可以在不先重写工程、不先封装 Block、也不假装完整理解所有源码的前提下：

- 看见完整物理工程、依赖闭包和受支持的源码结构；
- 区分 authoritative、derived、observed、inferred、ambiguous、unknown 与 opaque；
- 对没有专用Adapter的类库先进行type-safe结构化调用；
- 逐步建立 source owner、Responsibility、Contract、Effect、Permission 与 Acceptance；
- 将未知实现保持为Governed Extension或Opaque Boundary，而不是被迫全部重写；
- 在明确写权限和 must-preserve 边界内执行受控变化；
- 对 actual Semantic/Binding Delta、Impact、Verification、发布和恢复形成可追踪闭环。

### 确定性工程生成

用户可以声明产品意图、工程合同和可复用能力，SEC把它们确定性地变成Target workspace的真实源码与标准工程产物。
相同输入必须得到相同结果；实现选择必须可解释并遵守用户合同、安全、权限、许可证、依赖与验证边界，不能由模型偏好、
示例品牌或目标源码文本偶然决定。内部lowering、resolver和backend职责只由System/Compiler owner定义。

### 共享产品真值

两条用户旅程必须投影同一工程语义、实现选择、变化、验证与恢复真值；既有工程不能因来源不同获得第二套identity，
确定性生成也不能因目标不同绕过同一用户约束。内部对象链、authority flow、transaction、provider和artifact边界只由
相应架构owner定义，Product只要求所有用户入口给出同一可解释结果。

## 产品对象与术语边界

- **SEC repository** 是 SEC 产品自身的仓库；其生产源码区由System Architecture workspace-zone contract唯一签发，本文不复制物理路径。测试、文档、配置、生成物和运行状态各自属于自己的合同，不因包含代码文本就成为第二产品源码图。
- **Target workspace** 是用户在 IDE 中使用 SEC 开发、观察、生成、迁移和验证目标软件的工作区。它不是 SEC repository，也不是 SEC 自身运行状态目录。
- **Authoring Source** 是能够产生权威工程事实的语义角色，不是目录名称。Target workspace 中的文件、声明式合同或受治理扩展只有在相应 owner 和生命周期合同下才能成为 Authoring Source。
- **Source Program Model** 是对目标工作区或 SEC 产品源码的物理与符号观察。它提供结构 Evidence 和候选关系，但不把文件路径、目录名称或源码文本提升为业务语义。
- **Project** 只在具体领域合同确实定义该业务对象时使用；泛指用户开发对象时统一称 Target workspace，泛指 SEC 本身时统一称 SEC repository，避免让一个词同时指产品、仓库、工作区和生成结果。

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

产品不能把“官方支持/不能使用”做成二分。外部能力从物理存在、结构化调用、受治理声明、观察候选、已验证Provider/Adapter到可被SEC-owned projection替代的成熟度，由External Provider唯一owner定义和计算；本文只拥有用户结果：陌生类库可以先被结构化使用或保持unknown，自动选择、迁移和支持承诺只能在相应成熟度、Binding、Evidence与退出条件闭合后发生。

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

CLI、AI Adapter 和报告可以使用不同投影，但必须指向同一 canonical identity、revision、plan、Decision、Binding、result 与 Evidence，不能分别维护成功或实现选择状态。

## 终局业务意图

任何设计先绑定产品或领域唯一 owner 中的终局业务意图，而不是当前报错、现有文件、测试数量或最后一句实现建议。闭包只包含已由产品、roadmap、current spec、重新激活条件或真实 consumer 证明的事实：

```text
terminal user outcome
+ user-observable acceptance
+ hard constraints / must-preserve / non-goals
+ known consumer and lifecycle horizon
+ whole-lifecycle cost objective
+ reversal / retirement condition
```

SEC 的终局业务能力是：让用户在真实 Target workspace 中声明或重建工程语义，确定性解析合格实现，在明确权限和资源边界内实施变化，并用同一 identity 对实际语义变化、物理 Effect、Verification、Migration、Recovery 与 readback 给出可解释结果。任何 IR、Block、Slot、文件布局、界面、脚本或测试都只是实现这一结果的可替换手段，不能反向成为产品目标。

“终局”不是开放世界猜测。不能证明的未来保持 unknown；但已经证明的后继、升级、替换、运维和退役 consumer 不能因“当前只调用一次”被忽略。业务价值是所有代码、测试、Provider、文档和治理对象存在的最终理由；不能改善用户结果或降低正确变化全生命周期成本的对象必须派生、合并或删除。

系统替换还必须吸收旧 owner 已经正式声明并由真实 consumer、roadmap transition、支持窗口或重新激活条件证明的设计目的与未来能力边界。当前行为相同不等于可以退役：新系统必须以更小或更强的 canonical primitive 覆盖同一可观察结果、演进方向、失败/恢复边界和全生命周期成本；缺少任一覆盖时返回 `design-intent-unresolved`。注释、死代码、闲置 API、版本后缀、测试自证或“以后可能会用”不是未来价值 Evidence，不能授权保留旧实现，也不能授权凭空扩建新机制。

替换裁决比较的是语义覆盖，不是表示相似：旧系统当前可观察价值和由 canonical owner 明确签发的未来设计意图都必须被覆盖或显式拒绝；旧名称、目录、fixture、版本后缀、schema 数字、测试数量和历史代码体积本身不产生价值，也不要求新系统保留同形结构。

充分探究也不是无界读取。每次任务先冻结会改变裁决的问题、unknown 与 Evidence 类型，再从 authority、依赖、因果、consumer 和 Impact 图编译最小完整闭包；删掉任一必要引用会使裁决不完整，加入不能回答未决问题的材料则是噪声。根因、owner、机制、验证或退役被新证据推翻时，全部下游设计和 Evidence 必须失效并重算。

## 核心价值

### 理解

把分散关系投影为 Architecture、Scenario、Data、State、Contract、Effect、Implementation、Impact 与 Evidence，使维护者不必每次从文件、调用链、package文档和历史经验重新猜系统含义。

### 实现

以 Semantic Contract、Provider、Adapter、Reference Provider、Governed Source 和受治理扩展复用工程能力。复用单位包含合同、类型、Target、验证、来源、权限、迁移和失败边界，而不是只复制文件、包装成 Slot 或复制API调用。Block是可选资产封装，不能成为所有能力必须经过的芯片化中间层；它是否成立只由Capability/Block owner的admission决定。

平台优先采用成熟可靠轮子，但只在真实consumer、同条件A/B、安全/许可证审查、conformance和退出条件闭合后正式采用。`defer`只能保持显式unknown或推迟采用，不能授权把临时自研同构实现固化成长期第二owner。SEC原生实现只承担自身独有语义或少量Reference基准，不重写整个软件生态。

### 演进

以 stable identity、Fact Assertion、Fact/Binding Delta、Impact、Verification、Compatibility、Migration、Provenance 与 Recovery 控制长期漂移，使变更可以解释、验证、拒绝、回滚、恢复、替换实现和重新生成。

### AI 治理

平台选择或接受一个 Operation，构造最小充分 Context Packet，授予角色、语义操作、实现约束、路径、Effect 和预算上限，并独立解析和验证结果。AI 只提交 proposal或Provider/Adapter candidate；模型能力、confidence、长上下文或自然语言指令都不能扩大权限或伪造最终Binding。

目标不是依赖更强模型维持工程正确性，而是通过结构化事实、受限操作和机器合同降低模型能力与 token 需求。

## 多入口一致性

CLI、Agent、API、报告和未来交互界面只是同一产品能力的投影。它们必须让用户观察和提交相同的intent、constraint、
decision、change、failure与recovery语义，不能分别维护实现选择、成功状态或写路径。任何具体载体、协议、registry、
provider、Block或AI workflow只有在自己的canonical owner证明真实consumer与全生命周期价值后才可存在；Product不冻结其shape。

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
- SDK 和库复用调用点；SEC的Provider、Adapter与可选分发资产复用能力、合同、生成策略、验收与迁移。
- 包管理器解析包名与版本依赖；SEC额外解析“哪个完整实现闭包满足当前Semantic Contract和Target”。
- 工作流引擎编排运行时流程；SEC 位于工程构建、演进和治理层。
- 低代码平台通常绑定专用运行时；SEC 输出 Target workspace 的真实源码和标准目标，并允许用户从自动选择到精确pin/custom。
- 代码知识图从源码推断关系；SEC 的 canonical semantics 来自受权威输入、显式采用和编译规则，源码图只提供 Evidence 或候选。
- AI 编码助手直接操作源码；SEC 把 AI 限制为受控 Semantic/Implementation proposal operator 或 bounded source operator。
- 通用 AGI 试图拥有开放世界行动；SEC 只在可验证工程对象、权限、状态和操作合同内提供工程智能。

## 非目标

SEC 不是通用 IDE、低代码私有运行时、模板市场、单纯代码知识图、任意语言自动翻译器、万能包市场、自由式整仓 AI 编码器或依赖私有聊天状态才能继续的 Agent harness。

SEC 产品自身不拥有浏览器、Playwright、Workbench、local view、前端 UI graph 或第二交互应用运行时。这些产品面已经退役；这不限制 SEC 对 Target workspace 中浏览器应用合同的语义治理或代码生成。通用 Node、process、文件系统、锁、deadline、资源预算和外部能力治理继续由各自 canonical owner 服务其他真实 consumer，但不能成为复活 SEC 浏览器能力图的理由。

SEC 也不以 Block/Slot 芯片化、把所有能力包装为统一插槽、维护旧目录形状或保留 Vn facade 为目标。只有被真实用户结果消费的编译、语义理解、实现解析、验证、升级、迁移、恢复和分发能力可以继续存在；其表示必须从唯一语义 owner 派生。

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
- AI、Agent/CLI interface 和 Provider 不直接写 canonical IR、Implementation Decision、Verification、Evidence 或治理 terminal result。
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
→ 更可复用的 Contract / Provider / Adapter / Evidence
→ 更低的维护成本
→ 继续沉淀 Contract、实现候选、迁移和运行历史
```

真正的资产不是 Prompt、模板、Slot、Block 数量或某个流行库，而是可演进的 Contract、stable identity、Fact Provenance、Source/Implementation binding、Verification、Migration 和已验证的 Provider 协议；Block只有在承载这些资产的真实分发生命周期时才有价值。

## TypeScript 产品闭环成功判据

SEC 达到首个真实 TypeScript 产品闭环时，应同时满足：

- 从canonical semantic/consumer graph可重算地覆盖彼此无关的业务模型、外部工程、候选实现与unknown/opaque等价类；新增覆盖不会要求compiler core增加业务、品牌或fixture分支，具体测试表示、路径和数量由Verification machine contract派生；
- 同一个 Engineering Semantic Model同时服务Brownfield governance与deterministic generation；
- 支持的模型可以完整lowering；不支持的组合在Implementation Resolution或emit前确定性拒绝；
- 同一validated semantics、Target、constraints、Provider catalog、Resolution Policy和Backend revisions产生相同Decision、Binding与byte-stable结果；
- 对真实TypeScript Target workspace建立可重复的Physical Inventory与Source Program Model，并显式显示coverage、unknown和opaque；
- 没有专用Adapter的外部package可以通过TypedInvocation结构化调用，但行为unknown不会被伪装成正式支持；
- Responsibility reconstruction输出source binding、state/effect/permission facets、conflict与confidence，且候选不越权成为authority；
- 当真实catalog包含独立合格、不合格和unknown候选时，Resolver能稳定选择、解释拒绝并fail closed，而不依赖冻结的候选数量；
- `prefer`不合格时可解释回退，`require/pin`不合格时blocked，Custom实现保持受治理和opaque边界；
- 变更前可以计算保守predicted Semantic/Implementation Impact，变更后可以验证actual Fact/Binding Delta、actual Impact与可观察行为；
- 依赖升级或Provider替换不会静默改变timeout、retry、error、serialization、consistency、安全或Effect；无法保持时产生明确Migration；
- 每个受支持的Authoring Source和Brownfield Governed Source operation class都完成authorization、CAS、transaction、Verification、rollback/recovery与readback；
- 未完整理解的源码仍可被安全观察、显式拥有并在受限边界内修改；
- Agent/CLI可以从intent/constraint到pin/custom执行适用Semantic Operations，并解释选择、淘汰原因与迁移影响，不建立第二写路径或Resolver；
- AI只在最小充分Context Packet、Operation Envelope、角色权限、实现约束和路径交集内提交proposal/candidate；
- 失败要么在发布前拒绝，要么恢复exact prior state/Binding，要么进入可诊断的recovery-required；
- 用户看到健康、实现、影响、证据、未知和阻塞，不需要理解内部脚本或精通每个类库才能判断工程状态；
- clean package、exact Binding closure、目标Host/Target physical Evidence、发布receipt与support maturity分别可验证。
