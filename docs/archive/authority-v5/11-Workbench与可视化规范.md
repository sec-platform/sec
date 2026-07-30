---
title: Workbench 与可视化规范
status: active
last-reviewed: 2026-07-22
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

v1 operation registry 只含 `add-state-transition`。Block、port、Contract Entity/Operation、permission、effect、ownership 与 cascade 操作必须等后续 registry revision；旧 View Mutation operation 不因名称相近自动获得 v2 权限。SM-3 executor 已进入 `main`，当前产品 next SM-4A 只接该一个 operation；在 SM-4A 合并前，现有 Mutation API 不得宣称提供 Semantic Mutation v2。

### SM-4A shared adapter 与 transport

CLI 与 Workbench 必须消费同一个 platform-owned product adapter：

```text
CLI command ───────┐
                   ├→ raw transport DTO validation
Workbench HTTP ────┘  → trusted local policy draft
                      → Mutation-owned authorization ingress
                      → canonical Mutation facade plan/apply/query/recover
                      → product DTO / stable error projection
```

Adapter 只独占 raw transport DTO、trusted local product policy draft，以及产品错误/结果投影与脱敏。当前 canonical authorization normalizer/revision builder 在 Mutation kernel 内，SM-2 owner token 与 writable path-prefix policy 在 source registry 内，均未作为产品构造入口公开；因此 SM-4A 必须先由 Mutation/Compiler owner 串行暴露一个 additive authorization ingress，复用这些算法并返回 normalized context。`authorizationRevision` 仍由 `14` 的 builder 计算并由 planner 重算，canonical request/plan/result revisions 仍归 SM-1 kernel，owner-token/path-policy algorithm 与 actual source/path resolution 仍归 SM-2 source adapter。CLI、HTTP route 和 product adapter 都不生成 `allowedSourceOwnerIds` / `allowedPathPrefixes` 或重算这些结果，也不计算 risk、required Verification、Fact Delta、Impact、rollback 或 terminal state。相同 workspace、proposal 与 policy 通过两种 transport 必须由 canonical facade 返回 byte-identical request/plan binding。

依赖方向固定为 Workbench server/CLI → product adapter → Compiler/Semantic Mutation public facade。新 adapter 不放入 legacy Workbench mutation module；Pipeline、Fact Delta、Impact、Verification 与 Mutation kernel 都不得反向导入 product adapter。现有 Pipeline 对 legacy Workbench mutation 的兼容依赖不能被扩张成新环，后续迁移应删除该旁路而不是添加 adapter。

### Local HTTP trust boundary

Workbench 是本地产品不等于任意网页可以调用。所有 mutating routes 必须满足以下组合之一：

- server 只 bind loopback，并严格校验 same-origin/`Origin` 与预期 Host；或
- 每次启动生成不可预测、进程生命周期内有效的 capability，并在每个 mutating request 上校验；仍必须限制 bind/Host，capability 不写入日志或持久 artifact。

不得对写 route 使用 wildcard CORS，也不得因 GET/health 可跨域而放宽 mutation。缺失/伪造 Origin、跨站表单或 fetch、DNS rebinding Host、错误 capability、非 loopback 暴露都必须在读取 workspace 内容或构造 plan 前拒绝。错误响应只返回 stable product diagnostic，不泄露绝对路径、source bytes、secret、journal payload 或内部 stack。

SM-4A HTTP surface 至少分离：plan（只读 live workspace）、apply（要求 `expectedPlanRevision`）、query 与 recover。Workbench accepted 后重新读取 canonical projection；不能再调用第二条独立 compile/write 路径。Task Envelope v2 和 AI caller 属于 SM-4B/SM-4C，不得接入该 local trust shortcut。

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

1. Engineering IR、Fact Provenance、Architecture/Scenario/State Projection 与 Impact 基础已进入 `main`。
2. SM-4A：共享 product adapter、CLI 与 Workbench State View 的 `add-state-transition` plan/apply/query/recover，并关闭 local HTTP trust boundary。
3. Source Ownership、SEC-TS 多层 IR/Lowering 后补齐 Data/Contract/Effect 等完整投影。
4. 完整 Workbench 后才进入 SM-4B Task Envelope v2 与 SM-4C AI Semantic Operator。
5. 最后进行视觉体验强化；不得用 UI polish 代替 product transaction 闭环。
