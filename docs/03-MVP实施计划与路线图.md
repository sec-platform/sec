---
title: MVP 实施计划与路线图
status: active
last-reviewed: 2026-07-06
---

# MVP 实施计划与路线图

本文只维护当前实施阶段、退出条件和主线顺序。产品定义见 `02`；编译器边界见 `05`；IR 规范见 `14`。

## 1. 当前阶段判定

当前工程仍处于 **v0.3 Semantic Core Foundation 重构期**，且尚未满足 v0.3 退出条件。

当前真实形态：

```text
Governed File Compiler 主干
  + Semantic Contract prototype
  + Engineering IR prototype（旁路构建）
  + Architecture / Scenario / State Projection prototype
  + Contract-derived State Transition Generator
  + Slot Mock Synthesis
```

禁止把“类型、builder、projector 或单测文件已经存在”计为 Work Package 完成。完成必须证明对应能力进入唯一编译主链，并由真实纵切面验证。

## 2. 当前最高优先级：语义主权收敛

当前 P0 不是继续增加 Entity、Predicate、View 或 Generator，而是消除多套语义执行路径。

必须收敛到：

```text
Authoring Source / Registry Contracts
  → Semantic Frontend
  → Validated Engineering IR Snapshot
  → Pass Kernel
  → Lowering / Verification / Projection
  → Project / Governance Artifacts
```

以下路径不得继续长期并存：

```text
Contract → IR → Projection
Contract → Semantic Plan → Lowering
Lock / Manifest → ExplainGraph
Lock / Manifest → Workbench View
```

Engineering IR 成为 canonical representation 之前，v0.4 Semantic Mutation、Fact Delta、Impact Propagation 和 AI Semantic Operator 不进入主线。

## 3. 已有能力：保留但重新归位

保留：

- deterministic Resolver 与 Lock 基础。
- Registry source / Block version / compatibility 基础。
- Slot Synthesis Task Envelope v1。
- affected / fast / slow / full 测试执行器基础。
- Verification、Acceptance Coverage、Policy Gate。
- Artifact Provenance。
- ExplainGraph、ReviewSummary、Workbench 基础。
- Repair、Upgrade、Migration、Override 基础。
- CodeBuilder 和 compiler facade 边界。
- Semantic Contract parser / normalizer prototype。
- Engineering IR deterministic builder / index prototype。
- Architecture / Scenario / State projector prototype。

这些模块不是全部重写。后续工作以“接入唯一主链、删除重复解释器、补 canonical identity 与 transaction ownership”为目标。

## 4. v0.3 重构 Work Package 0：Pipeline Kernel

这是新的第一优先级。

实现：

1. 建立唯一 `compileWorkspace` / Pipeline Coordinator。
2. 所有 CLI、Workbench、Reference Refresh、Upgrade 重编译、Repair recovery 通过同一 Pipeline API。
3. 建立 Pass Registry 与依赖图。
4. Pass 状态至少支持 `pending / running / succeeded / failed / skipped`。
5. Pass 开始前统一失效下游状态。
6. Pass failure 统一落 Lock / Journal diagnostics。
7. 引入 compilation transaction identity。
8. Project Baseline / write boundary 绑定 transaction 与 pass ownership。
9. `lock` 与 `emit` 拆成独立 pass，不再由 `lockProject()` 同时标记成功。

退出条件：

- 不存在第二条手写完整编译链。
- Upgrade 不能绕过 Semantic Frontend / IR build。
- 任意 Pass 中断后可安全重跑，不把编译器自身半完成写入误判为人工 drift。
- 下游 pass 不得保留来自旧 input revision 的 succeeded 状态。

## 5. Work Package 1：Canonical Identity 与 IR Validation

实现：

1. App 使用稳定 `app.id`；`app.name` 只作为 label。
2. Engineering IR 增加显式 input revision / semantic revision。
3. Governance artifact、runtime evidence 不进入 semantic revision digest。
4. Fact identity 与 Fact assertion 分离。
5. 每个 assertion 独立保存 authority / confidence / provenance / evidence。
6. 建立 Predicate Signature Registry：合法 subject kinds、object kind、object entity kinds、value schema。
7. 建立 `validateEngineeringIR()`。
8. Projector、Lowerer、Mutation engine 只接受 validated snapshot。
9. Scenario 的 order / await / retry / error handler 归一为 Facts；删除第二 authoritative semantics container，或明确降级为由 Facts 派生的 index。

退出条件：

- 修改 app label 不改变 app identity / graph identity。
- 同一语义输入在不同治理产物阶段得到相同 semantic revision。
- 手工修改 IR 内容但保留旧 revision 必须被拒绝。
- 所有 Predicate/Object kind 组合经过统一 validator。

## 6. Work Package 2：Semantic Linker

当前 Contract loader 只支持单 Contract 本地引用。下一阶段增加 Workspace Semantic Linker。

实现：

1. Contract parse / local normalization。
2. 建立 namespace / contract identity registry。
3. 支持显式 qualified reference / import。
4. Workspace-level entity/responsibility/operation/policy/effect resolution。
5. 检测 duplicate namespace、ambiguous reference、cross-contract conflict。
6. 跨 Block Responsibility 只有通过显式 Contract linkage 才成立。
7. Semantic Policy 与 Verification Policy 建立显式 `ENFORCES / VERIFIED_BY` 映射。

退出条件：

- 文档中的跨 Block Responsibility 能被真实 Schema 表达和 linker 校验。
- 同名 Semantic Policy 与 Verification Policy 不再靠字符串猜测是否同一对象。

## 7. Work Package 3：IR-owned Generator / Lowering

当前 Generator v1 只有 state-transition-map，且 Lowering 直接读取 Contract。必须改为 IR-owned lowering。

实现：

1. Generator declaration 使用 discriminated union 或 per-kind schema registry。
2. `GeneratorPlan` 从 validated IR + generator declarations 构建。
3. Generator 成为 IR Entity。
4. 生成 `CONSUMES / LOWERS_TO / GENERATES / VERIFIED_BY` Facts。
5. Lowerer 不再重新读取 Semantic Contract 解释业务语义。
6. 第一条母例只保留 `generate-state-transition-map`。
7. Ticket service 的状态变更必须消费同一 generated transition contract，禁止 Contract 与 runtime service各自维护状态机。

退出条件：

```text
Ticket Contract
  → Semantic Frontend
  → Validated IR
  → Generator Plan from IR
  → Runtime transition contract
  → Ticket service enforcement
  → positive + forbidden-transition verification
```

必须证明 `open → closed` 在 Contract 禁止时 runtime 同样拒绝。

## 8. Work Package 4：Semantic Projection 接管 View

顺序：

1. Architecture View。
2. Scenario View。
3. State View。

要求：

- Projection 只消费 validated IR snapshot。
- Projection 不创造 authoritative relations。
- Architecture View 至少覆盖 Responsibility / Boundary / Contract-or-Port / Effect / Permission。
- Scenario View 的 PRECEDES / AWAITS / RETRIES / HANDLES 必须来自 Facts。
- Authority overlay 不使用 strongest-wins 把整个 target 染成 authoritative；必须暴露 mixed/inferred/conflict 状态。
- Workbench 读取统一 `SemanticView`，legacy governance tabs 作为兼容视图保留。

退出条件：

- Workbench 至少真实消费三种 SemanticView。
- ExplainGraph 不再重新解释 semantic Contract / ownership / effect。
- 同一 Fact 在三种视图中引用同一 Fact ID。

## 9. Work Package 5：Verification 与 CI 闭环

实现：

1. Contract Verification 使用稳定 `contractId` 注册，不依赖 test title regex。
2. Test Impact source classification 覆盖 TypeScript、Manifest、Semantic Contract YAML、Source Model。
3. Test ownership 从架构 owner / pass / contract 显式声明生成，路径正则只作 fallback。
4. PR Quick 恢复 canonical `test:affected`。
5. PR Risk 运行受影响 slow suites。
6. Full Validation 必须运行完整 fast suite + 完整 slow suites + workspace pipeline。
7. `run-full` label存在时，PR synchronize 必须对最新 head 重跑 Full Validation。
8. Ordered workspace pass 失败后停止后续 mutating pass；`always()` 只用于 diagnostics / artifact collection。
9. CI Contract 验证 step order、trigger freshness 和 exact head SHA，不只检查 command string 是否出现在 YAML。

退出条件：

- latest PR head 同时有 Quick / Risk / Full correctness evidence。
- 没有 fast test 只依赖 affected selector而永远不进入 full gate。
- Workflow 与 CI Contract 不允许手工漂移。

## 10. v0.3 完成定义

必须同时满足：

```text
One Authoring Authority
+ One Semantic Frontend
+ One Validated Engineering IR Snapshot
+ One Pipeline Coordinator
+ IR-owned Lowering
+ Fact-grounded Projection
+ Transaction-owned Project Integrity
+ Latest-head Full Validation
```

并完成 Ticket 母例真实纵切面：

```text
Ticket Contract
  → validated semantic link
  → Engineering IR
  → state transition Facts
  → Generator Plan
  → generated runtime contract
  → ticket service enforcement
  → verification
  → Artifact Provenance
  → Architecture / Scenario / State View
  → Workbench consumption
```

任何环节存在旁路，不算完成。

## 11. v0.4：Semantic Operations

只有 v0.3 完成后进入：

1. Fact Delta。
2. Impact Propagation。
3. Semantic Mutation。
4. AI Task Envelope v2。
5. AI Semantic Operator。

AI 仍不得直接写 IR。Semantic Mutation 回写 Authoring Source，由 Compiler 重建 IR。

## 12. 后续阶段

v0.3 稳定后：

1. Work Tracking 完整纵切面。
2. Private Registry 版本 / Trust 治理。
3. 两个独立团队 Block 生命周期验证。
4. PostgreSQL 正式目标。
5. Enterprise Business Process Hub 压力母例。
6. 多目标 / 多栈。

## 13. 当前禁止事项

在 v0.3 退出前，不把以下工作设为主线：

- Workbench 新视觉效果。
- 新增更多业务 Block。
- 新增第二种业务母例。
- Enterprise Business Process Hub。
- 自动 L3 重构。
- 整仓 Autonomous Agent。
- Fact Delta / Semantic Mutation 的正式实现。
- AI Semantic Operator。
- stable `engineering-ir.json` 持久化。

## 14. 下一执行顺序

严格执行：

```text
P0-1  Pipeline Kernel
→ P0-2 Canonical Identity / IR Validation
→ P0-3 Semantic Linker
→ P0-4 IR-owned Generator / Ticket enforcement
→ P0-5 Semantic Projection takeover
→ P0-6 Verification / CI closure
→ latest-head full validation
→ v0.3 exit review
```

禁止再以“哪个测试红就局部修哪个测试”的方式推进主线。
