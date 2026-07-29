---
title: 系统架构与权威流
status: stable
domain: system-architecture
last-reviewed: 2026-07-29
---

# 系统架构与权威流

本文只拥有 SEC 的总体分层、canonical/projection 边界、状态类别、跨域引用和依赖方向。领域内部字段、当前实现能力与具体文件集合分别由领域代码合同、最新 `main` 和机器 registry 拥有。

## 总体闭环

```text
Product Intent / Existing Workspace
→ Authoring Source + imported observations
→ Canonical Workspace Input Snapshot
→ independently validated domains
→ Validated Engineering Workspace Snapshot
→ target-specific Compilation Snapshot
→ Source / Test / Docs / Gate / Agent / Release projections
→ Verification / Evidence / Workbench
→ governed proposal and Mutation
→ canonical rebuild or rollback/recovery
```

当前尚未实现的 Workspace domains 和 target IR 不得用空 optional object、规划文档或 UI 模型冒充。迁移期间允许已有 validated Engineering IR 作为显式 provisional input，但只能由一个主链 owner 消费，不能建立第二 loader、revision 或 target pipeline。

## 四种不同身份

- **Authority**：谁有权声明、修改或裁决输入和策略。
- **Canonical state**：由确定性 producer 从受权威输入构建、验证和冻结的工程状态。
- **Evidence**：某个来源、方法、revision 与环境下的观察、测量或推断。
- **Projection / Artifact**：为用户、工具、运行目标或治理消费者生成的输出。

同一个物理文件可以承载其中一种身份，但路径、格式或被多个消费者读取不会自动改变它的身份。Evidence 不能通过 confidence、多数票或 UI 接受动作自动成为 authoritative Fact；Projection 也不能反向修改 canonical state。

## 核心层与唯一职责

### Authoring / Import

拥有产品意图、Contract、受治理源码、Block、Patch、Policy 和显式采用决策。Brownfield Provider 只产生 Source Program Model、Evidence 与候选绑定；在 Adopt 前没有写 authority。

### Semantic Frontend / Engineering IR

把规范化输入构建为 stable Entity、Fact、Assertion、Scenario 与 revision。它不拥有目标语法、UI 布局、外部工具品牌或运行时支持声明。

### Engineering Workspace Domains

Repository、Documentation、Workflow/Gate、Agent Operations、Release、Product Decision 与 Evidence Ledger 各自独立拥有 raw/validated boundary、identity、revision、validator、producer、query、Mutation 与 migration。聚合 Snapshot 只引用各域 revision 并验证跨域引用，不复制域内对象。

### Target Compilation

Target Profile、Type Algebra、Application IR、Behavior IR、Target Program IR 与 Backend 逐层 lowering。每层只能消费前一层 validated output；Backend 只负责目标程序结构、AST/printer、typecheck 与 bytes，不重新决定业务语义、权限或 Effect。

### Projection / Product Surface

CLI、Workbench、ExplainGraph、ReviewSummary、SemanticView、文档、Gate、Agent 和 Release 都是同一 canonical state 的消费者。Transport 可以校验输入和脱敏输出，但不能拥有 source owner、risk、Impact、Verification 或 terminal state。

### Mutation / Transaction

写操作从 proposal 开始，由平台重新派生 authorization、source owner、actual Delta、Impact 与 minimum Verification；使用 workspace lease、source CAS、journal、isolated rebuild 和原子发布。失败必须在 rejected、rolled-back 或 recovery-required 中明确收敛。

## Workspace 状态与路径类别

路径只是物理绑定，不是跨域 identity。一个 workspace 至少区分：

- `source/**`：开发者或受控 Mutation 拥有的 Authoring Source、Governed Source 与 Opaque Boundary。
- `project/**`：生成目标或 adopted runtime artifact；人工修改形成 Drift 或受治理 Override。
- `control/**`：Lock、Verification、Provenance、Review、Workflow 等持久治理投影；只有对应 owner 可写。
- `.sec/cache/**`、派生 build info 与可重建索引：可删除、可重算、不能成为 Evidence 或 authority。
- `.sec/workspace-write-lease/**`、transaction journal、recovery state 与其他 identity-bound control state：不可按“本地缓存”整体删除；其清理、压缩和恢复必须由各自协议证明安全。
- runtime/toolchain materialization：可重建但绑定 package、lock、provider、平台和 generation identity；ambient cache 不能冒充当前实例。

因此 `.sec/**` 不是一种统一生命周期。任何清理器、fixture、worktree hygiene 或发布逻辑都必须先通过机器分类，unknown 默认拒绝删除或复制。

## 跨域引用

Domain 只通过 stable identity 与 revision 关联：

```text
Repository source/artifact
↔ Documentation owner/consumer
↔ Workflow Gate input/result
↔ Agent operation/task
↔ Release artifact/promotion
↔ Product decision/rationale
↔ Evidence claim
↔ Engineering semantic entity/fact
```

禁止通过显示名称、相邻路径、同名字符串或复制整份对象建立隐式关联。跨域 validator 必须检查引用存在、revision 兼容、owner 唯一、循环依赖和 unresolved frontier。

## 单写者与依赖方向

每个 canonical type、state、identity/revision algorithm、pipeline stage、writer、selector、cache truth 和 public facade 只有一个 owner。合法依赖方向是上游 authority/validated state 指向下游 producer和 projection；Adapter、Workbench、AI、Provider、测试、文档和 Backend 不得反向拥有上游语义。

迁移必须明确：

```text
retain → shadow/read-only compare → migrate consumers
→ switch the single writer → invalidate old revisions
→ delete or archive the old owner
```

在 source bytes、diagnostics、副作用、consumer 和 failure parity 未证明前，新旧 writer 不能同时写同一 artifact。

## 生命周期与失败

所有长期状态必须能回答：创建者、owner、revision、可变性、读者、失效规则、持久化边界、并发、清理、恢复与退役。进程退出、请求返回、文件存在或单次测试通过都不自动证明状态已提交、资源已收口或下游可以继续。

跨层失败遵循：

- 上游 validation 失败，后续 producer blocked，不生成猜测输出。
- Projection 失败不回写 canonical state。
- Evidence 缺失或 stale 不改写事实；适用 Gate 要求它时阻止成功。
- 已发布写入失败必须通过 exact prior-state rebuild 证明回滚，无法证明时进入 recovery-required。
- cleanup/readback 失败属于结果的一部分，不能被产品断言通过覆盖。

## 架构演进约束

新增一层、一个 domain 或一个公共写入口前，必须证明它拥有独立对象和生命周期、存在真实消费者、不会建立第二 authority，并给出 migration、compatibility、negative/fault tests 与退出条件。大型未知探索只产生 Evidence；正式结果以聚焦 Work Package 进入主链。
