---
title: 产品目标与系统边界
status: stable
domain: product
last-reviewed: 2026-07-29
---

# 产品目标与系统边界

本文只拥有 SEC 要解决的问题、目标用户结果、产品边界与长期成功判据。当前实现能力由最新 `main` 与适用 Evidence 决定；阶段顺序由 `docs/roadmap.md` 拥有；字段、状态机与算法由代码合同拥有。

## 问题

大型软件的工程知识分散在源码、测试、配置、运行时行为和开发者经验中。文件与函数是必要实现载体，但不足以稳定表达：

- 一个能力负责什么、依赖什么、向谁提供什么；
- 状态由谁拥有、谁能读写、何时失效和如何恢复；
- 哪些权限、Effect、Policy、Acceptance 与风险必须保持；
- 一个变更实际改变了哪些工程事实、影响了哪些消费者；
- 一个生成物、判断或验证结果来自哪里、是否仍适用于当前 revision；
- AI 或工具可以读取、推断、提议和修改到什么边界。

SEC 的核心命题是：

> 把隐式工程知识提升为可声明、可组合、可推导、可验证、可追踪并可安全变更的工程语义。

## 产品结果

用户可以声明产品意图和工程合同，也可以导入既有 workspace。SEC 在保留真实源码和未知边界的前提下，建立 canonical 工程状态，并确定性地产生源码、测试、文档、Gate、Agent、Release 与 Evidence 投影。

用户面对的不是脚本集合，而是一个可操作的工程语义空间。用户应能直接看到：

- 当前系统的责任、状态、数据、合同、Effect 与权限边界；
- 一项提议会改变什么、影响什么、哪些区域仍未知；
- 哪些验证已经执行、在哪个环境执行、证明了什么、何时失效；
- 哪个 owner 能实施变化，哪些路径或副作用被禁止；
- 失败是否已拒绝、已回滚，还是需要显式恢复；
- 当前阻塞来自产品语义、工程能力、环境、Evidence 还是治理条件。

## 核心价值

### 理解

把分散关系投影为 Architecture、Scenario、Data、State、Contract、Effect、Impact 与 Evidence，使维护者不必每次从文件和调用链重新猜系统含义。

### 实现

以 Block、Semantic Contract、Generator、Adapter 与受治理扩展复用工程能力。复用单位包含合同、验证、来源、迁移和失败边界，而不是只复制文件。

### 演进

以 stable identity、Fact Assertion、Fact Delta、Impact、Verification、Migration、Provenance 与 Recovery 控制长期漂移，使变更可以解释、验证、拒绝、回滚和重新生成。

### AI 治理

平台选择任务、构造最小充分上下文、授予操作与路径上限并验证结果；AI 只提交 proposal。目标是降低模型能力和 token 需求，同时阻止模型凭自信扩大权限或改写事实。

## 核心单位

- **Block**：分发、版本、信任、升级、迁移和资产封装单位。
- **Semantic Contract**：声明 Entity、Responsibility、Operation、State、Policy、Permission、Effect、Scenario 与 Acceptance。
- **Semantic Responsibility**：架构理解和状态/行为责任单位，可以位于一个 Block 内或通过显式合同跨 Block。
- **Semantic Fact / Assertion**：最小 canonical 工程陈述，以及不同来源对该陈述的独立声明。
- **Authoring Source**：用户、项目或受治理操作可以修改的权威输入。
- **Governed Extension**：SEC 不完全表达内部算法，但拥有接口、Effect、Owner、Source binding 与 Verification 的代码区域。
- **Opaque Boundary**：当前不能安全理解、重生成或自动修改的显式边界。

图、文件、模块、包、UI 卡片和外部分析结果都可以映射这些对象，但不能自动取得它们的 authority。

## 产品形态

- **CLI**：确定性编译、查询、验证、迁移与恢复的薄入口。
- **Local Workbench**：理解、Review、影响预览和受控操作面，不是普通 IDE 或低代码运行时。
- **AI / Tool Adapter**：只暴露有权限的查询与 proposal 接口，不暴露第二套写路径。
- **Registry**：分发 Block、Contract、Generator、Verification 与 Migration；长期资产不是模板数量。
- **Provider 层**：语言前端、静态分析、运行时观察、浏览器、构建和外部工具以可替换能力接入。

所有入口必须消费同一 canonical producer、Mutation facade 和 Verification 结果真值。

## 优先适用范围

第一目标是 TypeScript 工程中的可重复业务与工程语义，优先覆盖：

- B2B SaaS、管理后台和控制面；
- 工单、CRM、ERP 子域和内部工具；
- 多服务应用中的合同、状态、权限和集成边界；
- AI Agent 应用层及其工具、权限、状态和验证；
- 具有明确输入、输出、Effect、Policy 和 Acceptance 的工程能力。

数据库内核、编译器后端、实时渲染、高性能数值内核等复杂算法不应被强塞进通用行为模型。SEC 在这些区域优先治理接口、资源、Effect、Ownership、Benchmark 与 Verification Boundary，内部实现可以长期保留为 Governed Extension 或 Opaque Boundary。

## 与相邻系统的边界

- 脚手架和模板解决初始化；SEC 负责持续组合、验证、升级、来源和语义变化。
- SDK 和库复用调用点；Block 复用能力、合同、生成策略、验收与迁移。
- 工作流引擎编排运行时流程；SEC 位于工程构建、演进和治理层。
- 低代码平台通常绑定专用运行时；SEC 输出真实项目源码和标准目标。
- 代码知识图从源码推断关系；SEC 的 canonical semantics 来自受权威输入和编译规则，源码图只提供 Evidence 或候选。
- AI 编码助手直接操作源码；SEC 把 AI 限制为受控 Semantic Operator 或 bounded source operator。

## 非目标

SEC 不是通用 IDE、低代码私有运行时、模板市场、单纯代码知识图、任意语言自动翻译器或自由式整仓 AI 编码器。源码不会消失；变化的是工程权威与主要操作不再完全依赖源码反推。

SEC 也不承诺把任意程序完整还原为高级业务语义。无法证明的关系必须保持 observed、inferred、ambiguous、unknown 或 opaque。

## 永久边界

- AI、Workbench、CLI 和 Provider 不直接写 canonical IR 或治理结果。
- Projection、报告、图、缓存和 Evidence 不反向成为事实源。
- 新同类业务模型不得要求 compiler core 增加业务名称分支。
- unknown、ambiguous、stale、conflicted 和 opaque 必须显式。
- 任何自动写入都必须有唯一 owner、授权边界、实际 Delta、Verification 与 rollback/recovery。
- Host Runtime、Toolchain Provider、Target Profile 和生成项目能力保持正交。
- 一项声明只有在实现、适用环境验证、分发和现实使用面全部闭合后，才成为支持承诺。

## 长期飞轮

```text
高质量 Contract
→ 可复用 Block / Adapter
→ 更准确的 canonical state
→ 更小的 Context Packet
→ 更强的 Impact 与 Verification
→ 更可靠的 Upgrade / Migration
→ 更低的维护成本
→ 继续沉淀 Contract、Block、Evidence 与迁移历史
```

真正的资产不是 Prompt，而是可演进的 Contract、Block、stable identity、Fact Provenance、Verification、Migration 和已验证的 Provider 协议。

## 成功判据

SEC 达到 TypeScript 产品闭环时，应同时满足：

1. 多组无关业务模型不修改 compiler core 的业务分支。
2. 支持的模型可以完整 lowering；不支持的组合在 emit 前确定性拒绝。
3. 同一 validated inputs、Profile 和 Provider revisions 产生 byte-stable 结果。
4. 同一 canonical state 可以生成多种有引用的语义和治理投影。
5. 变更前可以计算保守影响，变更后可以验证 actual Delta 与可观察行为。
6. 未完整理解的源码仍可被安全观察、显式拥有并在受限边界内修改。
7. Workbench 可以执行主要 Semantic Operations，而不建立第二写路径。
8. AI 只在小而明确的 Context Packet、操作许可和路径交集内提交 proposal。
9. 失败要么在发布前拒绝，要么恢复 exact prior state，要么进入可诊断的 recovery-required。
10. 用户看到健康、影响、证据、未知和阻塞，不需要理解内部脚本流水才能判断工程状态。
