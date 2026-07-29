---
title: 稳定交付路线
status: active
domain: roadmap
last-reviewed: 2026-07-29
---

# 稳定交付路线

本文只拥有稳定 capability DAG、阶段进入条件和产品完成定义。当前 SHA、PR、CI、活动包、blocker 和支持矩阵只由 live resolver、代码合同与 `docs/work/**` 拥有。

## 总体 DAG

```text
Canonical Engineering Foundation
→ Semantic Mutation Minimal Surface
→ Blockless Source Ownership
→ Target Profile + Type Algebra
→ Application IR
→ Behavior IR
→ Target Program IR + Backend
→ General TypeScript Lowering
→ Engineering Workspace Domains
→ Workbench / AI Semantic Operator
→ TypeScript Brownfield Adoption
→ Release / Deployment / Operations
→ Registry Trust / Ecosystem / Additional Languages
```

四条横切基础不替代上述产品层，并在出现消费者时逐步闭合：

```text
Documentation / Development Governance
Verification Truth / Impact / Evidence / Fault
Incremental Compilation / Artifact Graph
Host / Toolchain / Target / Provider / Distribution
```

## 1. Canonical Engineering Foundation

进入条件：产品问题、非目标和 authority flow 已冻结。

必须具备：stable Entity/Fact/Assertion identity、Semantic Contract、Responsibility、validated Engineering IR、deterministic revision、Pipeline Kernel、transaction/journal/recovery、Provenance 与 Explain projection。

退出条件：同输入 canonical graph byte-stable；unknown/ambiguous/conflicted/opaque 显式；consumer 只接受统一 validated boundary；不存在第二 identity、revision、writer 或 pipeline coordinator。

## 2. Semantic Mutation Minimal Surface

平台从 intent 独立派生 authorization、source owner、path、actual Delta、Impact、minimum Verification、CAS、writer lease 与 rollback/recovery。Workbench、CLI 和 AI 只消费同一个 product adapter；transport 不拥有语义。

退出条件：plan/dry-run 无 live write；apply 在 lease 内重新 plan；发布前后失败分别得到 rejected、rolled-back 或 recovery-required，不存在 partial-success。

## 3. Blockless Source Ownership

现有或新建 workspace 即使没有 Block，也能建立 Authoring Source inventory、source owner、governed/opaque boundary 和 mutation adapter。Block 是分发/版本/信任单位，不是理解任何源码的前置条件。

退出条件：未被完整理解的源码仍可只读观察和受控修改；任何 adopted source 都有稳定 identity、owner、Verification 与 rollback。

## 4. Target Profile 与 Type Algebra

Target Profile 显式描述 language、runtime、module、delivery、persistence、UI、verification、deployment 和 capability；Host Runtime、Toolchain Provider 与生成 Target 正交。Type Algebra 拥有类型身份、归一、兼容、序列化与目标映射。

退出条件：未知组合在 emit 前确定性拒绝；Target 选择不由当前 Host、package manager 或框架默认值推断。

## 5. Application / Behavior / Target Program IR

- Application IR：目标无关的应用组件、责任、状态、操作与关系。
- Behavior IR：SEC 能完整验证和 lowering 的受限行为模型。
- Target Program IR：目标语言模块、声明、语句、表达式、import/export 与 source binding。
- Backend：AST、printer、formatter、typecheck 与 bytes。

每层只有一个 producer，具有 raw/validated boundary、identity、revision、ordering、validator、deep-freeze 和 source mapping。复杂算法进入 Governed Extension 或 Opaque Boundary，不通过无限扩张 Behavior IR 伪装为通用支持。

退出条件：至少三组无关业务模型不修改 Core；unsupported-before-emit；legacy/new writer 对同一 artifact 完成 shadow parity 后只保留一个 writer。

## 6. 通用 TypeScript Lowering

Lowering 只消费 validated upstream IR 与 Target Profile，不重新解释 Contract。相同 inputs/profile/provider revisions 产生 byte-stable TypeScript artifacts、tests、config 与 provenance。

退出条件：常见新业务能力主要增加 Contract/Block/Adapter，不增加业务名称分支；round-trip、typecheck、runtime acceptance 与 negative scenarios 闭合。

## 7. Compiler Incremental Graph

增量编译是 clean deterministic compilation 的优化投影，不是第二编译语义。Pass node identity 只绑定 content、validated revisions、pass/options、Target Profile 与 Provider revision；未知依赖只扩大失效。

阶段：exact census/benchmark → in-memory graph → artifact/lowering incrementality → optional persistent derived cache → development daemon integration。

退出条件：clean/incremental byte-equivalent；小变化只重算真实影响节点；过期 revision 可取消且不发布 partial state；CPU、memory、queue、cache GC 与 critical path 可观察。

## 8. Verification 与开发反馈

能力顺序按真实依赖分阶段，而不是强制一条长串行链：

```text
Verification Result Truth
├→ Semantic Test Impact
├→ Epoch / Failure Core
└→ Hermetic Result Integration

Epoch / Failure Core → Trusted Bootstrap → Evidence DAG / Run Journal
Hermetic Resource Core → Physical Fault Traversal
Impact + Watch Evidence → Warm Plan-only Feedback
Result + Epoch + Hermetic Runtime → Automatic Execution
Evidence DAG → Persistent Reuse / Resume / Flake Governance
```

退出条件：未执行、平台不匹配、unknown impact、stale evidence 或 candidate self-proof 永不显示 PASS；已证明无影响才 not-run；相同有效节点复用；失败给出稳定 owner、最小复现和唯一下一动作。

## 9. Engineering Workspace Domains

Repository、Documentation、Workflow/Gate、Agent Operations、Release、Product Decision 与 Evidence Ledger 分别建立独立 raw/validated boundary、identity/revision、validator、mutation 和 migration；最终 Workspace Snapshot 只聚合 domain revisions 和跨域引用完整性。

禁止一次创建巨型 optional object，也禁止文档、Issue、PR body 或 Agent 会话成为 domain authority。

## 10. Workbench 与 AI Semantic Operator

Workbench 是 canonical state 的理解、Review 与受控操作面，不是低代码运行时。AI 只提交 proposal；Task Envelope 限制 operation、target、path、must-preserve、forbidden effects、Verification 与 budget。

退出条件：Architecture、Scenario、Data、State、Contract、Effect、Impact 和 Evidence 都是有引用的 projection；UI/layout 不进入 semantic revision；AI confidence 不能扩大权限。

## 11. Brownfield

```text
Attach → Lift → Reconcile → Adopt → Normalize
```

TypeScript 为第一目标，Core contract 保持语言无关。Source Program Model 是 observed/derived representation；unknown 和 opaque 可长期存在。Normalize 仅在 round-trip、behavior/effect parity、consumer migration 与 rollback 闭合后发生。

## 12. Release、Deployment 与 Operations

Release candidate、artifact、build profile、SBOM/signing、Verification、promotion 与 publication receipt 必须结构化。Deployment、configuration/secrets、migration、feature flag、canary、rollback、observability、SLO、incident 与 operational Evidence 在出现真实运行消费者后逐域升格。

构建成功不等于可发布，发布成功不等于部署安全，运行 trace 不自动改写 canonical truth。

## 路线规则

- TypeScript first，Core language-neutral。
- 每次交付一个可合并纵向闭包；Spike 默认不合并。
- 外部能力先作为可替换 Provider/Adapter；引入必须删除或阻止重复实现。
- 阶段顺序表达依赖，不授权第二 loader、writer、revision、selector、cache 或 pipeline。
- 无真实阻塞时及时 merge/close/cleanup，不制造无证据修改。

## 单包退出

Work Package 只有在结果进入唯一主链、owner 无竞争、正负/失败兼容测试通过、required CI/Review 无阻塞、旧路径退役或有明确迁移，并完成新 `main` readback 后结束。

## 产品完成边界

SEC-TS MVP 要求：多组无关业务模型不修改 Core、unsupported-before-emit、同输入 byte-stable、主要 Semantic Operations 可由 Workbench 执行、AI 只能提交 proposal、失败可 rollback 或进入 recovery-required。

Engineering Workspace MVP 还要求文档、Repository、Gate、Agent、Toolchain、Release 与 Evidence 结构化，并能计算跨域影响。任何“无漏洞”“全部支持”或“跨平台”声明必须绑定范围、方法、owning environment Evidence 与 residual risk。
