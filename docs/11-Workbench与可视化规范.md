---
title: Workbench 与可视化规范
status: active
last-reviewed: 2026-07-13
---

# Workbench 与可视化规范

本文定义 Workbench、Semantic View、Overlay，以及 View Mutation UI / Semantic Mutation adapter。IR 与 Semantic Mutation canonical contract 以 `14` 为权威，Explain/Review 以 `08` 为权威。

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

输入一个 canonical Fact Delta 与其两个 validated endpoints，展示 direct/transitive impact、verification recommendation、unknown/dynamic regions。精确 seed、传播方向、endpoint basis、path、digest 与 v1 dynamic 边界以 `14` 为唯一权威；Workbench 不自行遍历或补选验证。

初始 v1 对 `DEPENDS_ON`、`REQUIRES`、`IMPLEMENTS`、`LOWERS_TO` 执行已冻结方向；`GUARANTEES` 停在 value frontier，`ASSUMES`、`PERSISTS_AS`、`SERIALIZES_AS` 仍为 reserved。其他关系只显示 canonical unknown frontier，不能按名称猜测方向。

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

所有 Semantic Mutation 写入必须：

```text
UI operation
→ SemanticMutationRequestV2
→ platform plan / dry-run（不写 live workspace）
→ review derived plan / risk / Impact / verification
→ apply with expectedPlanRevision
→ accepted / rejected / rolled-back / recovery-required
→ regenerate views from accepted revision
```

Workbench 禁止直接写：

- `project/**`。
- `control/**` canonical/governance artifact。
- Engineering IR JSON。

## 8. Mutation 分层

### View Mutation v1

现有 `add-block/remove-block/bind-slot/unbind-slot/add-acceptance/...` 继续作为 legacy `source/app.yaml` View Mutation。当前 `applyViewMutations()` 会直接重写 Authoring Source，缺少 transaction-referenced base、source-byte CAS、canonical actual Fact Delta/Impact、跨进程排他、原子 publish 与 verified rollback，因此它不是 Semantic Mutation v2 实现，也不得被 Workbench 或 Compiler facade 升格为 canonical mutation authority。

现有 graph mutation dry-run 只预测 ExplainGraph 节点/边，不是 canonical semantic delta；现有 Workbench 进程内 mutex、Pipeline journal 和直接写 mutation JSON 的 API 也分别不等于 workspace lease、write-ahead recovery journal 或受信 proposal validator。迁移前 v1 与 v2 必须保持名称、endpoint 和报告类型分离。

### Semantic Mutation v2

Workbench 只是 `14` 第 18 节 `SemanticMutationRequestV2` 的 caller 和 plan/result renderer：它可以收集 operation 参数、增加条件/verification、展示 source owner、actual delta、Impact、diagnostics 与 terminal status；不能提交 path、伪造 `FactDelta`、覆盖派生风险/required passes/rollback，也不能在 UI 中把 blocked plan 改成 ready。

v1 operation registry 只含 `add-state-transition`。Block、port、Contract Entity/Operation、permission、effect、ownership 与 cascade 操作必须等后续 registry revision；旧 View Mutation operation 不因名称相近自动获得 v2 权限。Workbench adapter 在 SM-3 executor 完成后单独接入，接入前现有 Mutation API 不得宣称提供 Semantic Mutation。

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

现有 Vis.js 画布、Drawer 与 SSE 展示壳可以复用；现有直接写 mutation/source 的 API 只能在改造成 `14` 的 proposal/apply adapter 后复用。不要在 transaction contract 落地前继续把视觉动画和样式作为主线。

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
