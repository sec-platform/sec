---
title: Workbench 与可视化规范
status: active
last-reviewed: 2026-07-04
---

# Workbench 与可视化规范

本文定义 Workbench、Semantic View、Overlay 和结构化 Mutation。IR 以 `14` 为权威，Explain/Review 以 `08` 为权威。

## 1. Workbench 定位

Workbench 是工程编译器的本地理解、Review 和受控操作面。它不是普通 IDE，也不是低代码运行时。

用户应感觉自己面对**一个工程语义空间**；顶部视图切换只是改变投影函数：

```text
G = Engineering IR + selected governance/evidence

Architecture = P_architecture(G)
Scenario     = P_scenario(G, scenario)
Data         = P_data(G, value/entity)
State        = P_state(G, owner/state)
Contract     = P_contract(G, target)
Effect       = P_effect(G, boundary)
Impact       = P_impact(G, change)
```

UI 不读取源码自行计算这些关系。

## 2. Semantic View Contract

Workbench 消费统一投影合同：

```ts
interface SemanticView {
  formatVersion: string;
  viewKind: SemanticViewKind;
  subject?: string;
  nodes: ViewNode[];
  edges: ViewEdge[];
  inspector: InspectorSection[];
  overlays: ViewOverlay[];
}
```

`ViewNode/ViewEdge` 是展示对象，可以包含布局、label、badge、group 等 UI 信息；这些字段不得反向进入 Engineering IR。

同一事实在不同 View 中可被合并、隐藏或重新标注，但必须保留 Fact/Evidence reference 以支持 Inspector 下钻。

## 3. 七类主投影

### Architecture View

默认主画布。主要对象是 Semantic Responsibility、Boundary、Contract、Port 和关键 Effect。

默认节点只显示：

- 名称。
- Role。
- 输入/输出 Port。
- 关键 Badge。

建议 Badge：

```text
[S] stateful
[IO] external effect
[A] async
[P] permission/trust boundary
[!] invariant/risk
[?] inferred
```

Block/Package 可以作为 Assembly/Source mapping 辅助层，不作为默认 Architecture node。

### Scenario View

围绕一个 Entry/Operation/Event/Acceptance 展示局部因果执行链：

- 顺序。
- 条件。
- await。
- fork/join。
- fire-and-forget。
- retry。
- transaction boundary。
- error propagation/handler。

禁止默认展示全局 Call Graph。

### Data View

跟踪一个值/Entity/Field：

```text
source
→ derive
→ validate/sanitize
→ transform
→ serialize
→ persist/sink
```

重点 Predicate：`FLOWS_TO`、`DERIVES_FROM`、`TRANSFORMS_TO`、`VALIDATES`、`SANITIZES`、`SERIALIZES_AS`、`PERSISTS_AS`。

### State View

展示 Owner、Reader、Writer、Mutation、Lifetime、Transition、Concurrency 和 Escape。

重点 Predicate：`OWNS`、`READS`、`WRITES`、`MUTATES`、`INITIALIZES`、`DISPOSES`、`TRANSITIONS_TO`、`ESCAPES`。

### Contract View

展示：input、precondition、output、postcondition、error、effect、idempotency、concurrency、lifecycle requirement。

原生语言 Type 只是 Contract 的一部分。

### Effect / Permission / Trust View

展示 DB、Filesystem、Network、Process、Secret、Clock、Random、External Service 等 Effect，以及 trust state 和 Permission。

AI 产生新 Effect/Permission 边时，必须在 Semantic Diff 中高亮。

### Impact View

输入一个拟议 Fact Delta/Contract Change，输出 direct/transitive impact、verification selection、unknown/dynamic regions。

传播关系至少考虑 `DEPENDS_ON`、`ASSUMES`、`REQUIRES`、`GUARANTEES`、`IMPLEMENTS`、`LOWERS_TO`、`PERSISTS_AS`、`SERIALIZES_AS`。

## 4. Overlay

Overlay 不改变 canonical graph。

### Runtime Evidence

调用次数、实际路径、错误率、latency、branch observation、runtime trace。

### Provenance / Authority / Confidence

每个可展示 Fact 标明：

- authority。
- provenance source。
- confidence（若适用）。
- evidence count/reference。

AI inference 不得和 compiler/contract fact 使用同样视觉语义。

### Semantic Diff

显示：

```text
+ fact
- fact
~ semantic value
! new effect
! new permission
! invariant conflict
? inferred fact needs review
```

## 5. Unified Inspector

固定信息组：

1. IDENTITY
2. ROLE
3. CONTRACT
4. OWNED STATE
5. DATA
6. EFFECTS
7. ERRORS
8. LIFECYCLE
9. CONCURRENCY
10. PERMISSIONS
11. RELATIONS
12. EVIDENCE

空组可折叠，但字段归属保持稳定，避免每类节点使用完全不同的详情 UI。

## 6. Explain/Review 兼容视图

现有 Source View、Slot Rule View、Graph View、Review View 保留。

定位：

- Source View：Authoring/Artifact navigation。
- Slot Rule View：Slot/Task 写入边界。
- Graph View：ExplainGraph 治理拓扑兼容面。
- Review View：ReviewSummary 风险聚合。

它们不直接等于七类 Semantic View。迁移期间 Workbench 可以同时存在 legacy governance tabs 与 semantic tabs。

## 7. 图上操作

所有写入必须：

```text
UI operation
→ structured mutation
→ dry-run
→ precondition check
→ authoring source adapter
→ rebuild IR
→ compare actual Fact Delta
→ verification
→ accept/reject
→ regenerate views
```

Workbench 禁止直接写：

- `project/**`。
- `control/**` canonical/governance artifact。
- Engineering IR JSON。

## 8. Mutation 分层

### View Mutation v1

现有 `add-block/remove-block/bind-slot/unbind-slot/add-acceptance/...` 继续用于 `source/app.yaml`。

### Semantic Mutation v2

目标结构：

```ts
interface SemanticMutation {
  id: string;
  baseRevision: string;
  preconditions: SemanticCondition[];
  operations: SemanticOperation[];
  expectedFactDelta: FactDeltaExpectation;
  riskLevel: RiskLevel;
  requiredPasses: string[];
  verification: VerificationSelector[];
  rollback: RollbackHint;
}
```

第一批 Semantic Operation：

- add/remove Block（兼容映射）。
- connect typed port。
- add/update Contract Entity/Operation。
- add state transition。
- add permission requirement。
- add effect declaration。

Move State Ownership 等高风险操作在 Impact/Fact Delta 稳定后开放。

## 9. UI 架构

建议主界面：

```text
┌─────────────────────────────────────────────────────────┐
│ Architecture | Scenario | Data | State | Impact         │
├───────────────┬───────────────────────────────┬─────────┤
│ Search/Entry  │                               │Semantic │
│ Scenario      │        SEMANTIC CANVAS        │Inspector│
│ Catalog       │                               │         │
├───────────────┴───────────────────────────────┴─────────┤
│ Runtime ☑   Effects ☑   Authority ☑   Diff ☐          │
└─────────────────────────────────────────────────────────┘
```

现有 Vis.js 画布、Drawer、SSE compile、Mutation API 可以复用。不要在 IR 稳定前继续把视觉动画和样式作为主线。

## 10. 外部图工具

Graph-It-Live、GitNexus、Graphify、CodeQL/CPG 等只作为 Evidence Provider。

Provider Adapter 可以产生：

- code-context。
- impact-hint。
- architecture-boundary。
- semantic-pattern suggestion。
- runtime/navigation evidence。

不得直接覆盖 IR Fact、ExplainGraph 或驱动 Mutation apply。

## 11. 实施顺序

1. Engineering IR v1。
2. Fact Provenance。
3. Architecture Projection。
4. Scenario Projection。
5. State Projection。
6. Unified Inspector。
7. Semantic Diff/Impact。
8. Semantic Mutation。
9. Data/Contract/Effect 完整投影。
10. UI 体验强化。
