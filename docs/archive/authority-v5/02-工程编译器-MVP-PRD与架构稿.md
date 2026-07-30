---
title: 工程编译器产品与总体架构
status: active
last-reviewed: 2026-07-28
---

# Engineering Compiler 产品与总体架构

本文是产品定位和总体架构权威。字段、Schema 和实现细节以 `05–11`、`14` 为准。

## 1. 产品定位

产品工作名 `SpecEngineer`，最终品类描述为 Engineering Workspace Compiler；仓库和 CLI 当前使用 SEC。

SEC 是本地优先的工程工作区编译器：读取产品意图、工程规格、Block Contract、策略、验收、受治理源码或既有 workspace evidence，冻结 canonical Workspace Input Snapshot；其业务语义进入统一 Engineering IR，再经确定性多层 IR/Pass 形成独立 validated domains 与聚合 Validated Engineering Workspace Snapshot，并由此生成源码、测试、文档、Gate、Agent、Release 和 Evidence 投影。

SEC 不是：

- 通用 IDE。
- 低代码运行时。
- 模板市场。
- 自由式整仓 AI 编码器。
- 仅从源码逆向生成调用图的代码知识图工具。

## 2. 核心价值

当前已落地语义主链与长期产品链分别是：

```text
Specification
  → Semantic Contract
  → Engineering IR
  → Composition / Synthesis
  → Verification
  → Explainable Artifact
  → Upgrade / Impact / Review

Product Intent / Existing Workspace
  → Canonical Workspace Input Snapshot
  → Engineering IR + independently validated workspace domains
  → Validated Engineering Workspace Snapshot
  → Application IR
  → Behavior IR
  → Target Program IR（SEC-TS v1 为 TypeScript Program IR）
  → Validated target Compilation Snapshot
  → Source / Test / Docs / Gate / Agent / Release Projections
  → Verification / Provenance / Workbench
  → Semantic Mutation / Rollback / Recovery
```

平台要降低的是三类成本：

1. **理解成本**：把分散在源码中的关键工程事实投影为 Architecture、Scenario、Data、State、Contract、Effect、Impact 视图。
2. **实现成本**：通过 Block、Generator 和受限 Synthesis 复用工程能力。
3. **维护成本**：通过 Fact Provenance、Semantic Diff、Verification 和 Upgrade/Migration 控制长期漂移。

## 3. 分层架构

### Authoring / Import Layer

开发者声明工程意图和受治理实现：`source/app.yaml`、`source/model/**`、`source/code/**`、`source/patches/**`、私有 Block 和 Mutation。既有 TypeScript workspace 通过 Attach/Lift/Adopt/Normalize 导入，未知与 opaque region 保持显式。

### Semantic Contract Layer

Block 和 Workspace 声明 Entity、Operation、State、Event、Policy、Permission、View、Effect、Port、Acceptance 等语义。

### Semantic Frontend / Engineering IR

Parser、Normalizer、Alignment、Resolver 将多种 Authoring Source 归一为版本化 Engineering IR。IR 由 Semantic Entity、Semantic Fact、Scenario 和 Provenance 构成。

### Engineering Workspace domains / Validated Snapshot

Canonical Workspace Input Snapshot 只冻结本次 authoring/import inputs 与 source revisions；它不是 validated IR。Repository、Documentation、Workflow/Gate、Agent Operations、Release、Product Decision 与 Evidence 各自形成独立 validated domain；最终 Validated Engineering Workspace Snapshot 只组合 Engineering IR 在内的各 domain revision 与跨域一致性。规划合同见 `docs/architecture/engineering-workspace-ir.md`，不得形成巨型 optional object 或第二套 Engineering IR。

### Application / Behavior / Target Program IR

Validated Engineering IR 经 Target Profile 与 Type Algebra lowering 为 Application IR、Behavior IR 和 TypeScript Program IR。每层独立 version、validate、freeze、digest；后层不得重新解释前层 authoritative semantics。规划合同见 `docs/architecture/sec-ts-ir-layers.md`。

最终架构只允许完整 `Validated Engineering Workspace Snapshot` 作为 target lowering 输入。实施迁移期间，现有 validated Engineering IR 可作为显式标记的 provisional input；Workspace domains进入主链后，必须由唯一 Workspace Snapshot builder 原位 reconcile并使旧 target snapshot失效。该迁移不能产生第二 filesystem loader、第二 revision authority、第二 writer或平行 target-program pipeline。

### Compilation & Verification Layer

确定性 Pass 负责 Resolve、Lower、Generate、Compose、Verify、Lock、Emit；AI 只能在 Task Envelope 授权的综合、对齐或修复任务中运行。Task Envelope v2 与 AI Semantic Operator 是后续阶段，不是当前 SM-4A 的组成部分。

### Artifact Layer

输出真实源码、测试、文档、Gate、Agent、数据库 Schema、部署/发布文件和稳定治理 Artifact。

### Projection & Platform Layer

ExplainGraph、ReviewSummary、SemanticView、Workbench、CLI、IDE/MCP Adapter 从 IR 与治理 Artifact 投影信息。Projection 不拥有新事实。

## 4. 本地产品形态

### SEC CLI

主执行入口，运行在开发者机器或 CI Runner。CLI 调用相同 compiler facade 和合同，不维护独立业务规则。Semantic Core 保持 runtime-neutral；Host Runtime、Bun Toolchain、生成 Target 与 package layout 的独立权威见 [运行时权威、包布局与独立 CLI 分发](13-独立工具分发与打包规划.md)。Node 22/24 是待物理 Gate 闭合的公开 baseline，不是当前支持声明。

### Local Workbench

本地 Web 操作面，用于多视图理解、风险审查、Mutation 预览和受控编译。Workbench 不直接写 `project/**` 或 `control/**`。

### Local AI/MCP Adapter

向外部 Agent 暴露只读 Semantic View/Context Packet 和未来 Task Envelope 操作入口。当前 Task Envelope 仍主要服务 Slot Synthesis；外部工具 Evidence 不得提升为 authoring truth。

### Registry

分发官方、私有和未来远程 Block。Registry 的长期主资产是 Contract + Generator + Verification + Migration，而不是文件模板数量。

## 5. Canonical 数据关系

```text
authoring sources + imported evidence
                 ↓
canonical workspace inputs
                 ↓
validated workspace domains + Engineering IR
                 ↓
validated Engineering Workspace Snapshot
                 ↓
 Application IR → Behavior IR → Target Program IR
                         ↓
          validated target Compilation Snapshot
        /              |               \
 Compiler         Verification       bounded AI proposal
        \              |               /
 source/test/docs/gate/agent/release projections
                         ↓
              review / workbench / evidence
```

硬边界：

- `Engineering IR` 是 canonical semantic representation。
- `graph.lock.json` 锁定解析/装配状态，不替代 IR。
- `provenance.json` 当前负责 Artifact Provenance；Fact Provenance 属于 IR。
- `ExplainGraph` 负责“为什么当前工程状态如此”的治理解释。
- 外部 graph/provider 只能成为 Evidence/Overlay。
- Application/Behavior/Target Program IR 与 Workspace domain 的规划 owner 分别位于 `docs/architecture/**`；当前代码存在不能被推断为这些层已经实现。

## 6. Block 与 Responsibility

Block 负责：

```text
distribution
version
trust
upgrade
asset ownership
```

Semantic Responsibility 负责：

```text
architecture role
state ownership
operation responsibility
impact propagation
human understanding
```

一个 Block 可声明多个 Responsibility；一个 Responsibility 在有明确 Contract 的情况下可跨 Block。Workbench 的 Assembly View 可以显示 Block 卡片，但 Architecture View 必须以 Responsibility 和 Boundary 为主要对象。

## 7. 支持范围

优先适配：

- B2B SaaS。
- 管理后台与控制面。
- 工单、CRM/ERP 子域。
- 内部工具。
- AI Agent 应用层。

中期扩展：多服务应用、多数据库目标、移动/Web 产品。

谨慎适配：数据库内核、编译器后端、实时渲染、高性能数值内核。此类系统使用 Kernel/Hybrid 模式，只治理接口、Effect、Ownership、Benchmark 和 Verification Boundary，不强行把内部算法降级为通用业务 IR。

## 8. 非目标与禁止方向

- 不为 `Customer`、`Ticket`、`Order` 增加核心编译器专用分支。
- 不把所有自定义逻辑强塞进 Slot；复杂开发者源码可作为 Governed Source 或 Opaque Boundary 接入。
- 不允许 ExplainGraph 扩张成事实母图。
- 不允许 Workbench 前端独立计算工程语义。
- 不允许 AI 直接修改 canonical IR 或 governance artifact。
- 不在 Semantic Representation 稳定前继续用巨型业务 Demo 放大文件装配抽象。
- 不把执行 SEC 的 Host、仓库 Toolchain 与生成项目 Target 合并为一个 runtime 选择，也不以 Bun 下的成功替代 Node/Bun 各自的物理证据。

## 9. 产品成功的工程判据

1. `Ticket` 语义纵切面能从 Contract 构建 IR 并 Lower 到至少一条完整运行链。
2. 同一 IR 能生成至少 Architecture、Scenario、State 三类不同投影。
3. Fact Provenance 能区分 authoritative、derived、observed、inferred。
4. Semantic Mutation 能经预条件、Fact Delta、Verification 和回滚边界合流。
5. AI 能以小 Context Packet 完成受限任务，且不能扩大自身权限。
6. 新增同类业务实体无需修改 compiler core 的业务名称分支。
7. 同一 workspace facts 能确定性生成源码、测试、文档、Gate、Agent 与 Release 投影，且不存在第二 writer/authority。
8. Brownfield 未知区域显式，只有完整表示并验证的模块才可 Normalize。
