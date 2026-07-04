---
title: 工程编译器实施计划与路线图
status: active
last-reviewed: 2026-07-04
---

# 工程编译器实施计划与路线图

本文只决定阶段、优先级、进入/退出条件。Schema 以实现级规范为准。

## 1. 总原则

当前采用**收敛型开发**：先稳定表示，再扩张业务；先形成可验证闭环，再增加操作面。

优先级：

```text
Canonical Representation
  > Correctness Contract
  > Compiler Pipeline
  > AI Control
  > Projection / Review
  > New Vertical Features
  > UI Polish
```

## 2. 阶段状态

| 阶段 | 状态 | 目标 |
| --- | --- | --- |
| A 文档与边界冻结 | done | 形成分层规范和 Workspace/AI/Block 边界 |
| B v0.1 首条闭环 | done | Customer Admin：规格→Block→Slot→验收 |
| C v0.2 工程治理 | done | Verification、Provenance、Repair、Upgrade、Policy、Explain、Review、Workbench 基础 |
| D v0.3 Semantic Core Foundation | **active** | Engineering IR、Fact Provenance、第一条 Semantic Contract/Lowering 闭环 |
| E v0.4 Semantic Operations | next | Semantic Mutation、Fact Delta、Impact、AI Semantic Operator |
| F v0.5 Team/Registry | later | 私有 Registry 正式治理、CI 团队使用、多团队 Block 生命周期 |
| G v1+ Platform | later | 多目标、远程 Registry、托管验证、Marketplace、跨栈 |

## 3. 当前事实

已完成并应保持兼容：

- CLI 主链和四根 Workspace。
- Registry、Block、Pin、Slot 和文件装配。
- Slot Synthesis Task Envelope。
- affected/fast/slow/full 测试反馈模型。
- Verification、Acceptance Coverage、Policy Gate。
- Artifact Provenance。
- ExplainGraph、ReviewSummary、Workbench 基础。
- Repair、Upgrade、Migration、Override 基础。
- CodeBuilder 和 compiler facade 边界。
- Workbench Mutation → `source/app.yaml` 回写闭环。

这些能力是 v0.3 的输入，不重写为第二套系统。

## 4. v0.3：Semantic Core Foundation

### Work Package 1：Engineering IR Kernel

实现：

- `platform/shared/engineering-ir-types.ts`
- `platform/compiler/ir/build-engineering-ir.ts`
- `platform/compiler/ir/index-engineering-ir.ts`
- compiler facade 导出
- unit/contract tests

第一版只归一当前已存在的 App、Block、Capability、Pin、Slot、Acceptance、Policy、Artifact 事实。目标是让 IR 真实进入代码，不急于增加业务语义种类。

退出条件：相同输入确定性生成稳定排序的 IR；IR Entity ID 和 Fact ID 可重复；ExplainGraph 可以逐步从 IR 投影而不改变现有公开合同。

### Work Package 2：Fact Provenance

每条 Fact 支持：

- authority：authoritative / derived / observed / inferred
- sources：authoring path、manifest、compiler rule、analysis/runtime/tool reference
- confidence：只用于非绝对推导强度，不代替 authority
- evidence：可回看证据引用
- revision validity

退出条件：平台能解释至少三条关键 Fact“为什么成立”；AI/provider 的高 confidence 不能覆盖 authoritative Contract。

### Work Package 3：Ticket Semantic Contract

以已有 `ticket/basic` 为唯一母例，声明最小：

- `Ticket` Entity。
- `Ticket.status` State。
- create/transition/list/comment Operations。
- TicketCreated/TicketStatusTransitioned Events。
- tenant scope Policy/Permission。
- database read/write Effects。
- TicketLifecycle、TicketStateMachine、TicketQuery、TenantScopeGuard Responsibilities。

不做 Enterprise Business Process Hub，不新增大规模业务块。

退出条件：Contract → IR → 至少一条 Generator/Lowering → project artifact → verify 闭环通过。

### Work Package 4：前三个 Semantic View

顺序：

1. Architecture View：Responsibility、Boundary、Contract、Effect。
2. Scenario View：关键 Operation/Scenario 顺序、await/failure/retry。
3. State View：Owner、Reader、Writer、Mutation、Transition。

Workbench 只读取统一 `SemanticView` 投影合同；Vis.js/Canvas/Drawer/SSE/Mutation Server 可以复用。

退出条件：同一 IR 产生三种视图，三者不能各自读取源码推断语义。

## 5. v0.4：Semantic Operations

实现顺序：

1. IR revision snapshot / digest。
2. Fact Delta：added / removed / changed facts。
3. Impact propagation：按 Contract、Ownership、Assumption、Lowering、Verification 边传播。
4. Semantic Mutation：precondition、operation、expected fact delta、risk、required passes、rollback。
5. AI Task Envelope v2：允许受限 semantic-alignment / contract-edit / repair proposal。

AI 仍不得直接写 IR。所有 Semantic Mutation 必须回写 Authoring Source，再由编译器重建 IR。

## 6. v0.5 以后

只有满足以下条件后，才重新进入业务规模扩张：

- Engineering IR 在至少一个真实纵切面稳定。
- Fact Provenance 可审查。
- 三视图共用同一 Projection API。
- Semantic Diff/Impact 能解释真实变更。
- 一个完整 Block 升级周期没有破坏 semantic identity。

然后依次推进：

1. Work Tracking 完整纵切面。
2. 私有 Registry 版本/信任治理。
3. 两个独立团队的 Block 生命周期验证。
4. PostgreSQL 正式目标。
5. Enterprise Business Process Hub 压力母例。
6. 多目标/多栈。

## 7. 当前禁止事项

在 v0.3 退出前，不把以下工作设为主线：

- 新的 Workbench 视觉特效。
- 给 ExplainGraph 添加 State/Data/Call 等母图语义。
- 巨型业务 Demo。
- 大量新增文件型 Block。
- 自动 L3 重构。
- 让外部 graph provider 驱动 Mutation。
- AI 整仓自主修改。

允许做阻塞性 Bug、性能回归、CI 稳定性和既有公开合同修复。

## 8. 每个工作包的完成定义

任何工作包只有同时满足以下条件才算完成：

1. 类型/Schema 有唯一权威定义。
2. Builder/Pass 为纯逻辑或明确隔离 IO。
3. 关键不变量有 Unit/Contract Test。
4. CLI/Artifact/Projection 暴露边界明确。
5. `docs:doctor`、typecheck、affected/fast 测试按影响运行。
6. Reference Workspace 如受影响必须刷新并做 drift check。
7. 删除或改写旧的重复概念，不只叠加新术语。
