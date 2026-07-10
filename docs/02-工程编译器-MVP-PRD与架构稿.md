---
title: 工程编译器产品与总体架构
status: active
last-reviewed: 2026-07-04
---

# Engineering Compiler 产品与总体架构

本文是产品定位和总体架构权威。字段、Schema 和实现细节以 `05–11`、`14` 为准。

## 1. 产品定位

产品工作名 `SpecEngineer`，底层品类描述为 Engineering Compiler；仓库和 CLI 当前使用 SEC。

SEC 是本地优先的工程语义编译器：读取工程规格、Block Contract、策略、验收和受治理源码，构建统一 Engineering IR，经确定性 Pass 与受限 AI Pass 生成项目并形成 Verification、Provenance、Review 和 Workbench 投影。

SEC 不是：

- 通用 IDE。
- 低代码运行时。
- 模板市场。
- 自由式整仓 AI 编码器。
- 仅从源码逆向生成调用图的代码知识图工具。

## 2. 核心价值

最小价值链：

```text
Specification
  → Semantic Contract
  → Engineering IR
  → Composition / Synthesis
  → Verification
  → Explainable Artifact
  → Upgrade / Impact / Review
```

平台要降低的是三类成本：

1. **理解成本**：把分散在源码中的关键工程事实投影为 Architecture、Scenario、Data、State、Contract、Effect、Impact 视图。
2. **实现成本**：通过 Block、Generator 和受限 Synthesis 复用工程能力。
3. **维护成本**：通过 Fact Provenance、Semantic Diff、Verification 和 Upgrade/Migration 控制长期漂移。

## 3. 六层架构

### Authoring Layer

开发者声明工程意图和受治理实现：`source/app.yaml`、`source/model/**`、`source/code/**`、`source/patches/**`、私有 Block 和 Mutation。

### Semantic Contract Layer

Block 和 Workspace 声明 Entity、Operation、State、Event、Policy、Permission、View、Effect、Port、Acceptance 等语义。

### Semantic Frontend / Engineering IR

Parser、Normalizer、Alignment、Resolver 将多种 Authoring Source 归一为版本化 Engineering IR。IR 由 Semantic Entity、Semantic Fact、Scenario 和 Provenance 构成。

### Compilation & Verification Layer

确定性 Pass 负责 Resolve、Lower、Generate、Compose、Verify、Lock、Emit；AI 只能在 Task Envelope 授权的综合、对齐或修复任务中运行。

### Artifact Layer

输出真实源码、测试、数据库 Schema、部署所需文件和稳定治理 Artifact。

### Projection & Platform Layer

ExplainGraph、ReviewSummary、SemanticView、Workbench、CLI、IDE/MCP Adapter 从 IR 与治理 Artifact 投影信息。Projection 不拥有新事实。

## 4. 本地产品形态

### SEC CLI

主执行入口，运行在开发者机器或 CI Runner。CLI 调用相同 compiler facade 和合同，不维护独立业务规则。

### Local Workbench

本地 Web 操作面，用于多视图理解、风险审查、Mutation 预览和受控编译。Workbench 不直接写 `project/**` 或 `control/**`。

### Local AI/MCP Adapter

向外部 Agent 暴露只读 Semantic View/Context Packet 和 Task Envelope 操作入口。外部工具 Evidence 不得提升为 authoring truth。

### Registry

分发官方、私有和未来远程 Block。Registry 的长期主资产是 Contract + Generator + Verification + Migration，而不是文件模板数量。

## 5. Canonical 数据关系

```text
source/** + registry contracts
          ↓
   Semantic Frontend
          ↓
     Engineering IR
       /     |      \
      /      |       \
Compiler  Verification  AI Runtime
   ↓          ↓            ↓
project/**  evidence    bounded proposal
      \        |          /
       \       |         /
        governance artifacts
                 ↓
      projections / workbench
```

硬边界：

- `Engineering IR` 是 canonical semantic representation。
- `graph.lock.json` 锁定解析/装配状态，不替代 IR。
- `provenance.json` 当前负责 Artifact Provenance；Fact Provenance 属于 IR。
- `ExplainGraph` 负责“为什么当前工程状态如此”的治理解释。
- 外部 graph/provider 只能成为 Evidence/Overlay。

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

## 9. 产品成功的工程判据

1. `Ticket` 语义纵切面能从 Contract 构建 IR 并 Lower 到至少一条完整运行链。
2. 同一 IR 能生成至少 Architecture、Scenario、State 三类不同投影。
3. Fact Provenance 能区分 authoritative、derived、observed、inferred。
4. Semantic Mutation 能经预条件、Fact Delta、Verification 和回滚边界合流。
5. AI 能以小 Context Packet 完成受限任务，且不能扩大自身权限。
6. 新增同类业务实体无需修改 compiler core 的业务名称分支。
