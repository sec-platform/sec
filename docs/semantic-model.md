---
title: Engineering IR 语义模型
status: stable
domain: semantic-model
last-reviewed: 2026-08-06
---

# Engineering IR 语义模型

本文拥有 Engineering IR 的概念模型、身份域、Semantic Responsibility、Assertion 生命周期、authority、冲突语义与 validated boundary。精确 TypeScript shape 由 `src/semantic/engineering-ir/index.ts` 公开，Predicate signature、diagnostic、canonical ordering 和 digest payload 由该合同、`src/compiler/ir/**` 及合同测试共同验证。

## 定位

Engineering IR 是 SEC 接受的 canonical engineering semantics。它是有向、强类型、带属性的多重图，但不是 AST、Source Program Model、源码符号图、调用图、Implementation Resolution state、Target Program IR、ExplainGraph、interface projection、Repository inventory 或 AI Knowledge Graph。

它回答“哪些工程对象存在、哪些工程陈述成立、谁以什么依据作出陈述、哪个对象承担哪些工程责任”，不回答目标语言如何打印、文件如何布局、选用哪个具体类库、UI 如何排版或某次运行是否通过。

Brownfield governance 与 deterministic generation 共用同一 Engineering IR。源码观察、Contract/Block 声明和显式 Adopt decision只是不同输入来源，不得产生平行语义核心。Implementation Resolution只能消费validated语义并产生下游实现绑定，不能以候选、Provider默认值或源码写法反向修改Semantic Contract。

## 核心对象

- **Entity**：具有稳定 identity 的工程对象，如 application、Block、Responsibility、Operation、State、Policy、Effect、Generator、Artifact 或 Acceptance。
- **Fact**：规范化 triple：`subject --predicate--> object`。Fact 只拥有 triple identity。
- **Assertion**：某个来源对该 exact Fact 的独立声明，拥有 authority、confidence、provenance、evidence references 和 validity range。
- **Semantic Responsibility**：一个稳定工程对象承担状态、行为、Effect、Permission、Resource、Contract、Source/Artifact binding 与 lifecycle 的语义边界。
- **Scenario**：从 canonical Entities/Facts 确定性重建的只读 derived cache，不是第二声明入口。
- **Validated Snapshot**：通过统一 validator 后签发的不可变边界，绑定输入与语义 revision。

同一规范化 triple 在一个 snapshot 中只有一个 Fact。不同来源、authority 或 provenance 的主张作为多个 Assertions 保留，禁止 strongest-wins、last-write-wins 或把多个来源压成一个“综合事实”。

## Semantic Responsibility

Responsibility 是 SEC 的工程理解和影响传播单位，不等于文件、函数、类、模块、Block、UI 节点或团队名称。

一个 Responsibility 至少可以通过 canonical Facts 关联：

- owned state、readers、writers 与 mutation boundary；
- operations、inputs、outputs、errors、idempotency 与 concurrency；
- Effects、Permissions、Policies、Resources 与 external ports；
- provided/required Contracts、consumers、providers 与 dependencies；
- Scenarios、Acceptance 与 Verification requirements；
- Authoring/Governed Source、Target Artifact 和 release/public bindings；
- lifecycle、replacement、split、merge、migration 与 retirement。

Responsibility identity 表示“同一个工程责任是谁”，不能仅从一个文件路径、symbol 名称、Block ID、具体类库或当前实现位置派生。合法演进至少区分：

```text
same | renamed | moved | split | merged | replaced | ambiguous | unknown
```

Split、merge 和 replacement 必须有显式 relation 和 migration/provenance，不能复用旧 ID 表示新的责任对象。

### Responsibility 的来源

- Contract/Policy/Adopt decision 可以产生 authoritative Responsibility assertions；
- canonical rule 可以产生 derived facets；
- Source Program Model 可以产生 observed/inferred candidates；
- AI、静态分析、代码图和 runtime trace 只能产生 candidate assertions或 Evidence。

Responsibility reconstruction 的候选必须保留 source bindings、facets、confidence、coverage、conflicts 和 unknown frontier，并明确 `authoritative: false`。同名、路径邻近、高 confidence、框架惯例或多个 Provider 一致不能自动取得 authority。

Reconcile/Adopt 可以接受、拒绝、拆分、合并或保留 opaque candidate。Adopt 只授予明确 scope 的 canonical authority、source owner、allowed Operation 和 Verification，不把整个文件或 Provider 结果全部升格。

### Responsibility 与其他对象

- Block 是分发、版本和信任单位，可以声明多个 Responsibilities；
- module/class/function 是 Source Program objects，可以实现或参与一个或多个 Responsibilities；
- Operation 是 Responsibility 提供或消费的受限行为；
- State/Effect/Permission 是 Responsibility facets，不单独代表完整 Responsibility；
- Impact 可以传播到 Responsibility，但不拥有其 identity 或 canonical facets；
- Implementation Requirement可以从Responsibility/Operation/Effect/Permission派生，但不成为新的业务语义来源；
- Agent/CLI architecture view只是 Responsibility projection。

## 身份域

### Entity identity

Entity identity 表示同一个工程对象跨重建、显示名变化和合法移动仍然是谁。它不得来自随机 UUID、数组位置、UI 坐标、绝对路径或显示 label。路径可以成为受版本约束的 source/artifact binding，但不能默认等于跨域 identity。

### Fact identity

Fact identity 只从规范化 subject、predicate 和 object 派生。authority、confidence、provenance、evidence 数量和 Assertion 数量都不得进入 Fact ID。

### Assertion identity

Assertion identity绑定 Fact、authority 与规范化 provenance identity。Evidence 可以补充同一 Assertion，但不能通过加入一条报告制造新的语义 claim。相同 Assertion identity 若出现不兼容 confidence、validity 或来源语义，必须诊断冲突，不能静默取最大值或最后值。

### Revision

输入声明 revision、最终 semantic revision、Source Program revision、Responsibility candidate revision、Implementation Requirement/Decision/Binding revision、transaction execution identity、artifact revision 和 Evidence revision 是不同域：

- input revision 表示规范化声明输入；
- source-program revision 表示对 exact physical workspace 的 observed/derived 模型；
- semantic revision 表示最终 canonical graph；
- candidate revision 表示一组尚未 Adopt 的解释；
- implementation requirement/decision/binding revision表示对既有语义的下游实现选择，不得进入semantic revision；
- transaction identity 表示一次执行；
- artifact revision 表示某个生成结果；
- Evidence revision 表示一个观察或证明记录。

时间戳、绝对路径、UI 布局、Map insertion order、当前进程和一次运行 ID 不得污染 semantic identity。

## Authority、confidence 与来源

Assertion authority 至少区分：

- **authoritative**：用户、项目 Contract、明确 Policy、Adopt decision 或其他被授权来源的声明；
- **derived**：由版本化 canonical rule 从受信输入确定性推导；
- **observed**：对 exact source/runtime/environment 的直接观察；
- **inferred**：静态分析、AI 或其他不完备机制产生的解释。

Authority 是权力层级，不是概率。`inferred confidence = 1` 仍不能覆盖 authoritative claim；多个 Provider 一致也不能多数票升格。Confidence 只在允许不确定性的 authority 类别中描述该 assertion 自身的判断强度。

Provenance 回答声明来自哪个 Contract、Adopt decision、compiler rule、source span、runtime observation 或 Provider。Evidence reference 指向外部记录；Evidence 内容、expiry、bias 和运行环境不应被复制进 semantic graph。

## Assertion 生命周期

Assertion 具有明确有效区间。新 revision 可以：

- 保留相同 assertion；
- 为同一 Fact 增加不同来源 assertion；
- 终止旧 assertion 的有效区间；
- 重新推导或重新观察产生新 assertion；
- 因来源失效而撤销 assertion，但不抹除历史记录；
- 通过显式 Adopt/Reject decision改变候选 assertion 的治理状态；
- 通过 Responsibility split/merge/replacement 迁移有效关系。

升级或 source change 后，Assertion 不能凭 Entity identity 延续而自动继承。Contract assertions 从新 Contract 重建；derived assertions 由新规则重算；observed assertions绑定新环境或 source revision；inferred assertions可以失效并重新推断。Provider或ImplementationBinding升级若保持Semantic Contract，不得无故重写canonical Assertions；无法保持时必须进入显式Semantic Migration。

## 冲突与未知

冲突不是简单的“哪条 confidence 更高”。Validator 和 source policy 必须区分：

- 同一 assertion identity 的不兼容内容：hard conflict；
- 多个 authoritative assertions 对互斥命题的冲突：阻止相应 validated boundary；
- inferred/observed 与 authoritative 冲突：保留 competing assertion 和 diagnostic，不改写 authority；
- Responsibility candidate 对 owner、state writer、Effect 或 source binding 冲突：保持 conflicted/ambiguous，不能自动选择；
- stale、partial 或覆盖不足：保留 Evidence limitation 和 unknown frontier；
- 无法唯一解析 identity/reference：ambiguous，不得选择一个最像的对象；
- predicate 或 object shape 未获支持：在 canonical boundary 前拒绝。

“没有发现 Fact”只有在输入 inventory、Provider coverage 和验证机制按设计足以发现该 Fact 时，才构成缺失证据；否则仍是 unknown。Implementation Resolver也必须消费这一未知边界，不能把缺失Fact、空Provider结果或类型检查成功解释为能力、安全或行为已经证明。

## Predicate 与 signature

Predicate 描述关系语义，使用唯一、版本化 signature registry 约束 subject kinds、object kind 和 value schema。每个 predicate 必须明确处于 active 或 reserved 状态：

- active 需要至少一个无歧义 producer 和 signature；
- reserved 只保留未来语义位置，不能出现在 validated Facts。

Predicate signature 只定义合法 shape，不自动定义 Impact 传播方向、UI 边样式、Implementation eligibility或 Verification runnable mapping。Builder、validator、Fact store、index、Projector 和 consumer 不得各自复制另一套 switch。

Responsibility 所需的 `OWNS / READS / WRITES / MUTATES / IMPLEMENTS / DEPENDS_ON / REQUIRES / PERFORMS_EFFECT / REQUIRES_PERMISSION / VERIFIED_BY / CONSUMES / PROVIDES / PUBLISHES / LOWERS_TO` 等 relation只有进入 active signature、producer和tests后才是 canonical capability；名称存在不代表已实现。Implementation Resolver可以从这些validated relations派生requirement，但不能反向写入或借用同名自由字符串建立Provider等价。

## Canonical ordering 与确定性

所有 Entities、Facts、Assertions、attributes、provenance 和 derived caches 都必须经过统一 normalization 与 canonical ordering。相同 inputs 和规则产生相同 IDs、revisions 与 serialized bytes。去重必须以 identity 和完整 canonical payload 为依据，不能依赖插入顺序或 object reference。

IR 是 multigraph，不要求全图无环。某个 Pass 可以对某类 predicate 子图要求 acyclic，但 State loop、retry、recursive evidence 或 workflow cycle 可以合法存在。

## Raw 与 validated boundary

Raw IR 是不受信计算结果。统一 validator 至少验证：

1. format/input/graph/app binding；
2. Entity、Fact、Assertion identity 与 canonical order；
3. subject/object 引用完整性；
4. Predicate signature 与 value schema；
5. Assertion authority、confidence、provenance、evidence 与 validity；
6. Responsibility identity、facets、source bindings、replacement/split/merge关系与authority；
7. duplicate/collision/conflict；
8. Scenario 等 derived cache 与 Facts 的一致性；
9. semantic revision 与 canonical payload；
10. clone 后递归 deep-freeze。

只有该边界可以签发 branded validated snapshot。Lowering、Implementation Resolution、Impact、Projection、Agent/CLI interface 和 Mutation planner 等 IR-native consumer 只接受 validated snapshot，不接受调用方提供的 index、raw graph、Responsibility candidate 或自行拼装的“已验证”对象。

## 与 Implementation Resolution 的边界

Engineering IR只提供稳定语义和可追溯的实现要求来源：Responsibility、Operation、Type、State、Effect、Permission、Policy、Scenario、Acceptance与Verification Requirement。实现解析领域负责从这些validated对象推导`ImplementationRequirement`并选择具体实现闭包。

固定不变量：

- library/package/version/Adapter、performance rank、support maturity和源码写法不进入Engineering semantic identity；
- Provider manifest、`.d.ts`、源码分析、runtime trace和AI建议不能直接产生authoritative业务Fact；
- 某个Provider无法满足合同只能淘汰候选，不能降低或修改合同；
- 用户要求某个Provider属于Implementation constraint/operation input，不自动获得绕过类型、安全、权限或Verification的权力；
- 若依赖升级无法保持原Semantic Contract，必须由Change Management产生显式Semantic Migration，而不是在Binding层静默改义；
- Implementation Decision/Binding是可替换、可失效的下游编译状态，不是第二Engineering IR。

## 与其他模型的边界

- Physical Workspace 表达文件、配置、资源和物理 owner；不自动成为 Engineering IR。
- Source Program Model 表达模块、符号、类型、引用、flow candidate和observed structure；不自动成为 Engineering IR。
- Responsibility reconstruction产生 candidate；显式 authority决定后才进入 canonical semantics。
- Implementation Requirement/Decision/Binding表达具体实现选择，不重新拥有Engineering identity或Semantic Contract。
- Target/Application/Behavior/Program IR 表达编译计划和目标程序，不重新拥有 Engineering identity 或 authority。
- ExplainGraph、SemanticView 和 ReviewSummary 是可丢弃投影。
- Evidence Ledger 拥有 evidence record、freshness、coverage、bias、expiry 和 invalidation；Engineering IR 只保存 assertion 对 evidence identity 的引用。
- Fact Delta 比较两个 validated semantic endpoints；Impact 在独立规则 registry 下传播，不能由 UI、Implementation Resolver或 changed-file selector替代。
