---
title: Engineering IR 语义模型
status: stable
domain: semantic-model
last-reviewed: 2026-07-29
---

# Engineering IR 语义模型

本文拥有 Engineering IR 的概念模型、身份域、Assertion 生命周期、authority、冲突语义与 validated boundary。精确 TypeScript shape、Predicate signature、diagnostic、canonical ordering 和 digest payload 由 `platform/shared/engineering-ir/**`、`platform/compiler/ir/**` 及合同测试唯一拥有。

## 定位

Engineering IR 是 SEC 接受的 canonical engineering semantics。它是有向、强类型、带属性的多重图，但不是 AST、源码符号图、调用图、ExplainGraph、Workbench View Model、Repository inventory 或 AI Knowledge Graph。

它回答“哪些工程对象存在、哪些工程陈述成立、谁以什么依据作出陈述”，不回答目标语言如何打印、文件如何布局、UI 如何排版或某次运行是否通过。

## 核心对象

- **Entity**：具有稳定 identity 的工程对象，如 application、Block、Responsibility、Operation、State、Policy、Effect、Generator、Artifact 或 Acceptance。
- **Fact**：规范化 triple：`subject --predicate--> object`。Fact 只拥有 triple identity。
- **Assertion**：某个来源对该 exact Fact 的独立声明，拥有 authority、confidence、provenance、evidence references 和 validity range。
- **Scenario**：从 canonical Entities/Facts 确定性重建的只读 derived cache，不是第二声明入口。
- **Validated Snapshot**：通过统一 validator 后签发的不可变边界，绑定输入与语义 revision。

同一规范化 triple 在一个 snapshot 中只有一个 Fact。不同来源、authority 或 provenance 的主张作为多个 Assertions 保留，禁止 strongest-wins、last-write-wins 或把多个来源压成一个“综合事实”。

## 身份域

### Entity identity

Entity identity 表示同一个工程对象跨重建、显示名变化和合法移动仍然是谁。它不得来自随机 UUID、数组位置、UI 坐标、绝对路径或显示 label。路径可以成为受版本约束的 source/artifact binding，但不能默认等于跨域 identity。

### Fact identity

Fact identity 只从规范化 subject、predicate 和 object 派生。authority、confidence、provenance、evidence 数量和 Assertion 数量都不得进入 Fact ID。

### Assertion identity

Assertion identity绑定 Fact、authority 与规范化 provenance identity。Evidence 可以补充同一 Assertion，但不能通过加入一条报告制造新的语义 claim。相同 Assertion identity 若出现不兼容 confidence、validity 或来源语义，必须诊断冲突，不能静默取最大值或最后值。

### Revision

输入声明 revision、最终 semantic revision、transaction execution identity、artifact revision 和 Evidence revision 是不同域：

- input revision 表示规范化声明输入；
- semantic revision 表示最终 canonical graph；
- transaction identity 表示一次执行；
- artifact revision 表示某个生成结果；
- Evidence revision 表示一个观察或证明记录。

时间戳、绝对路径、UI 布局、Map insertion order、当前进程和一次运行 ID 不得污染 semantic identity。

## Authority、confidence 与来源

Assertion authority 至少区分：

- **authoritative**：用户、项目 Contract、明确 Policy 或其他被授权来源的声明；
- **derived**：由版本化 canonical rule 从受信输入确定性推导；
- **observed**：对 exact source/runtime/environment 的直接观察；
- **inferred**：静态分析、AI 或其他不完备机制产生的解释。

Authority 是权力层级，不是概率。`inferred confidence = 1` 仍不能覆盖 authoritative claim；多个 Provider 一致也不能多数票升格。Confidence 只在允许不确定性的 authority 类别中描述该 assertion 自身的判断强度。

Provenance 回答声明来自哪个 Contract、compiler rule、source span、runtime observation 或 Provider。Evidence reference 指向外部记录；Evidence 内容、expiry、bias 和运行环境不应被复制进 semantic graph。

## Assertion 生命周期

Assertion 具有明确有效区间。新 revision 可以：

- 保留相同 assertion；
- 为同一 Fact 增加不同来源 assertion；
- 终止旧 assertion 的有效区间；
- 重新推导或重新观察产生新 assertion；
- 因来源失效而撤销 assertion，但不抹除历史记录。

升级或 source change 后，Assertion 不能凭 Entity identity 延续而自动继承。Contract assertions 从新 Contract 重建；derived assertions 由新规则重算；observed assertions绑定新环境或 source revision；inferred assertions可以失效并重新推断。

## 冲突与未知

冲突不是简单的“哪条 confidence 更高”。Validator 和 source policy 必须区分：

- 同一 assertion identity 的不兼容内容：hard conflict；
- 多个 authoritative assertions 对互斥命题的冲突：阻止相应 validated boundary；
- inferred/observed 与 authoritative 冲突：保留 competing assertion 和 diagnostic，不改写 authority；
- stale、partial 或覆盖不足：保留 Evidence limitation 和 unknown frontier；
- 无法唯一解析 identity/reference：ambiguous，不得选择一个最像的对象；
- predicate 或 object shape 未获支持：在 canonical boundary 前拒绝。

“没有发现 Fact”只有在输入 inventory、Provider coverage 和验证机制按设计足以发现该 Fact 时，才构成缺失证据；否则仍是 unknown。

## Predicate 与 signature

Predicate 描述关系语义，使用唯一、版本化 signature registry 约束 subject kinds、object kind 和 value schema。每个 predicate 必须明确处于 active 或 reserved 状态：

- active 需要至少一个无歧义 producer 和 signature；
- reserved 只保留未来语义位置，不能出现在 validated Facts。

Predicate signature 只定义合法 shape，不自动定义 Impact 传播方向、UI 边样式或 Verification runnable mapping。Builder、validator、Fact store、index、Projector 和 consumer 不得各自复制另一套 switch。

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
6. duplicate/collision/conflict；
7. Scenario 等 derived cache 与 Facts 的一致性；
8. semantic revision 与 canonical payload；
9. clone 后递归 deep-freeze。

只有该边界可以签发 branded validated snapshot。Lowering、Impact、Projection、Workbench 和 Mutation planner 等 IR-native consumer 只接受 validated snapshot，不接受调用方提供的 index、raw graph 或自行拼装的“已验证”对象。

## 与其他模型的边界

- Repository/Source Program Model 表达物理文件、模块、符号和 observed structure，不自动成为 Engineering IR。
- Target/Application/Behavior/Program IR 表达编译计划和目标程序，不重新拥有 Engineering identity 或 authority。
- ExplainGraph、SemanticView 和 ReviewSummary 是可丢弃投影。
- Evidence Ledger 拥有 evidence record、freshness、coverage、bias、expiry 和 invalidation；Engineering IR 只保存 assertion 对 evidence identity 的引用。
- Fact Delta 比较两个 validated semantic endpoints；Impact 在独立规则 registry 下传播，不能由 UI 或 changed-file selector替代。
