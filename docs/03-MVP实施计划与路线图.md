---
title: MVP 实施计划与路线图
status: active
last-reviewed: 2026-07-12
---

# MVP 实施计划与路线图

本文只维护当前实施阶段、退出条件和主线顺序。产品定义见 `02`；编译器边界见 `05`；IR 规范见 `14`。

## 1. 当前阶段判定

当前工程仍处于 **v0.3 Semantic Core Foundation 重构期**，且尚未满足 v0.3 退出条件。

当前真实形态：

```text
Governed File Compiler 主干
  + Pipeline Kernel Foundation（已进入 main）
  + compilation transaction / journal（已进入 main）
  + compileWorkspace() 统一协调入口（已进入 main）
  + Semantic Contract + Workspace Semantic Link（已进入 Pipeline semantic stage）
  + Canonical / Validated Engineering IR handoff（已进入 Pipeline semantic context）
  + Architecture / Scenario / State Projection prototype
  + IR-owned State Transition Generator + Ticket runtime enforcement
  + Slot Mock Synthesis
```

必须严格区分：

```text
Pipeline Kernel + Semantic Frontend / IR handoff + IR-owned Lowering 已完成
≠ Projection 已统一消费 canonical semantic snapshot
```

禁止把“类型、builder、projector、validator 或单测文件已经存在”计为 Work Package 完成。完成必须证明对应能力进入唯一编译主链，并由真实纵切面验证。

## 2. 当前收口：Verification / CI Closure exact-head Gate

P0-7 Verification / CI Closure 已以 `ci-verification-v3` 本地组合 Full evidence 完成 correctness 收口；Quick / full-fast / budget / Contract Freeze、25/25 slow suites、benchmark / deps / ordered workspace / reference tail 均有可复用证据。PR #93 已 squash merge 为 `9bbdc86`，原 feature branch、专用 worktree、Junction 与临时 evidence 已清理。P0-6 已让 Architecture / Scenario / State Projector 只接受 validated snapshot，并让 ExplainGraph、ReviewSummary 与 Workbench 消费同一 `SemanticViewSet` / Fact identity。

当前 P0 不是继续增加平行 Semantic Plan、第二套 Generator/Projection 解释器或新的 Pipeline；canonical Engineering IR、validated boundary、transaction-owned Pipeline Semantic Context、Workspace Semantic Link、IR-owned Generator 与 canonical Projection 已经固定，当前任务是把这些不可旁路的语义纵切面纳入稳定 Verification / CI contract。

目标主链：

```text
Authoring Source / Registry Contracts
  → Semantic Frontend
  → Workspace Semantic Link
  → Canonical Engineering IR
  → validateEngineeringIR()
  → Validated Engineering IR Snapshot
  → Pipeline Semantic Context
  → IR-owned Lowering / Verification / Projection
  → Project / Governance Artifacts
```

以下路径不得回归：

```text
Contract / raw IR → Projection（绕过 validated snapshot）
Contract → Semantic Plan → Lowering
Lock / Manifest → business-semantic ExplainGraph reconstruction
Lock / Manifest → business-semantic Workbench reconstruction
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
- **Ticket Semantic Contract**：当前首个真实业务 Semantic Contract 母例，authoritative contract 位于 `platform/registry/official/ticket.basic/contracts/ticket.yaml`。
- **Engineering IR Kernel**：`platform/compiler/ir/**` 下的 deterministic builder、index 与 identity boundary。
- **Fact Provenance**：保存 Fact assertion 的 authority、confidence、provenance 与 evidence；与生成物来源的 Artifact Provenance 分工，不互相替代。
- Architecture / Scenario / State projector prototype。
- **Pipeline Kernel Foundation**：统一 `compileWorkspace()` 协调入口、Pass Registry / dependency、compilation transaction、journal、pass lifecycle 与下游失效基础。

这些模块不是全部重写。后续工作以“让 canonical Engineering IR 进入唯一 Pipeline semantic context、删除重复解释器、完成 transaction ownership 与真实纵切面”为目标。

## 4. P0-1 Pipeline Kernel Foundation — COMPLETED

状态：**COMPLETED**。

### Prerequisite

- v0.3 进入重构前的 Governed File Compiler 主干。

### 已完成基础设施

1. 建立统一 `compileWorkspace()` / Pipeline Coordinator。
2. 建立 Pass Registry 与 stage dependency。
3. Pass 生命周期支持 `pending / running / succeeded / failed / blocked / skipped`。
4. Pass 开始前统一失效下游状态。
5. Pass failure 统一记录 transaction / journal diagnostics。
6. 引入 compilation transaction identity。
7. Pipeline transaction 支持 start / commit / fail journal lifecycle。
8. `lock` 与 `emit` 作为独立 stage 执行。
9. Workbench compile 已通过 `compileWorkspace()` 进入 canonical pipeline coordinator。

### 退出条件

以下 Foundation 条件已由 `main` 满足：

- 存在统一 `compileWorkspace()` Pipeline Coordinator。
- Stage dependency 与 owned / invalidated pass lifecycle 由 Pipeline Kernel 统一管理。
- 编译运行具有 transaction identity 与 journal lifecycle。
- Stage failure 会阻塞或失效受影响的下游 pass state。
- `lock` 与 `emit` 不再是同一 stage。

### 明确不代表

P0-1 完成只说明 **Pipeline execution infrastructure 已建立**。它不证明：

- Semantic Frontend 已是 Pipeline 必经阶段。
- Engineering IR 已是 Pipeline canonical semantic handoff。
- Lowerer 已只消费 validated IR。
- Projection / ExplainGraph / Workbench 已停止重新解释旧语义容器。

这些语义主权问题由 P0-2A 至 P0-6 依次解决。

## 5. P0-2A Canonical IR Invariants — COMPLETED

状态：**COMPLETED**。

### Prerequisite

- P0-1 Pipeline Kernel Foundation — COMPLETED。

### 实现

1. App 使用稳定 `app.id`；`app.name` 只作为 label。
2. Engineering IR 增加显式 input revision / semantic revision，并定义各自 digest 输入集合。
3. Governance artifact、runtime evidence 不进入 semantic revision digest。
4. Fact identity 与 Fact assertion 分离。
5. 每个 assertion 独立保存 authority / confidence / provenance / evidence。
6. 建立 Predicate Signature Registry：合法 subject kinds、object kind、object entity kinds、value schema。
7. 固定 canonical Entity / Fact ordering 与 deterministic digest 规则。
8. Scenario 的 order / await / retry / error handler 归一为 Facts；删除第二 authoritative semantics container，或明确降级为由 Facts 派生的 index。
9. 明确 IR 中 canonical data、derived index、governance metadata 的所有权边界。

### 退出条件

- 修改 app label 不改变 app identity / graph identity。
- 同一语义输入在不同治理产物阶段得到相同 semantic revision。
- Governance artifact 或 runtime evidence 变化不改变 semantic revision。
- 相同 Entity / Fact 集合仅改变输入顺序时，canonical digest 不变。
- Fact assertion provenance 变化不会伪造新的 Fact identity；Fact semantic payload 变化必须产生相应 identity / revision 变化。
- 每个 Predicate/Object kind 组合具有唯一 signature authority。
- Scenario authoritative semantics 不再同时存在于 Facts 与第二独立容器。
- `main` 中不存在另一个与上述规则竞争的 canonical identity / digest 定义。

以上退出条件由 PR #86（`main@cf57927aff75081679bb0f8f17eb6631ea58eaab`）收敛。实现与目标验证证据由 `docs/14-Engineering IR与语义事实规范.md`、P0-2A vertical tests 和 `docs/test-feedback-and-ci-lanes.md` 中的验证复用账本共同持有。

## 6. P0-2B Validated IR Boundary

状态：**COMPLETED**。

### Prerequisite

- P0-2A Canonical IR Invariants 退出条件全部满足。

### 实现

1. 建立 `validateEngineeringIR()`。
2. Validator 校验 input revision / semantic revision 与 canonical digest 一致性。
3. Validator 统一校验 Entity identity、Fact identity、Fact assertion、Predicate Signature。
4. 建立显式 `ValidatedEngineeringIRSnapshot` 边界；未经 validator 的普通 IR 不得伪装为 validated snapshot。
5. 新增 IR-native semantic consumer 时，只允许接收 validated snapshot。
6. 对现存仍直接读取 Contract、Plan、Lock 或 Manifest 的 legacy semantic consumer 建立明确 owner Work Package；不得在 P0-2B 为满足类型形式而提前伪装成 IR consumer。
7. Validator diagnostics 使用稳定错误码并保留可追溯的 entity / fact / predicate 定位信息。

### 退出条件

- 手工修改 IR 内容但保留旧 revision 必须被拒绝。
- 非法 Entity identity、Fact identity 或 Predicate/Object kind 组合经过统一 validator 拒绝。
- 普通 `EngineeringIR` 不能直接进入新增 IR-native semantic consumer。
- validated snapshot 只能由 canonical validator 成功路径产生。
- 现存 legacy semantic consumers 均被明确归属到 P0-3、P0-5 或 P0-6，不存在“先要求 Lowerer 消费 validated snapshot、后续才把 Lowerer 改为 IR-owned”的执行依赖环。

以上退出条件由 PR #88 收敛。实现、focused tests 与验证复用判断分别由 `docs/14-Engineering IR与语义事实规范.md`、`tests/unit/validated-engineering-ir.test.ts` 与 `docs/test-feedback-and-ci-lanes.md` 持有。

## 7. P0-3 Semantic Pipeline Spine

状态：**COMPLETED**。

### Prerequisite

- P0-2B Validated IR Boundary 退出条件全部满足。

### 实现

1. 在 `compileWorkspace()` 主链建立唯一 Semantic Frontend stage / semantic pipeline spine。
2. 当前 Ticket 母例必须经过 `Contract parse → local normalize → IR build → validateEngineeringIR()`。
3. 将 `ValidatedEngineeringIRSnapshot` 放入显式 Pipeline Semantic Context，由后续 IR-native pass 通过 context 获取。
4. Pipeline Kernel 负责 semantic context 的 transaction / revision ownership；旧 input revision 的 semantic snapshot 不得跨 transaction 复用为 succeeded state。
5. CLI、Workbench、Reference Refresh、Upgrade 重编译、Repair recovery 的完整编译路径不得建立第二条手写 Semantic Frontend。
6. 允许 legacy Lowering 在 P0-5 完成前继续存在，但必须标记为 transitional consumer；不得把它描述为 canonical semantic authority。
7. Semantic Frontend failure 必须通过现有 Pipeline Kernel lifecycle 阻塞下游 mutating stage。

### 退出条件

- Ticket 的 canonical compile path 必经 Semantic Frontend 与 `validateEngineeringIR()`。
- `compileWorkspace()` 的 semantic pipeline context 能提供当前 transaction 对应的 validated snapshot。
- 不存在第二条手写完整 Semantic Frontend。
- Upgrade / Repair / Workbench 等完整重编译入口不能绕过 canonical Semantic Frontend。
- 任意 Semantic Frontend 中断后可安全重跑，不把旧 semantic revision 的 downstream succeeded state 继续视为有效。
- 此阶段不要求 legacy Lowerer 已 IR-owned；该退出条件只建立“validated IR 已进入 Pipeline”，不提前吞并 P0-5。

以上退出条件由 `tests/integration/semantic-pipeline-spine.test.ts`、Pipeline/Workbench/Upgrade focused tests、reference full compile 与 `docs/test-feedback-and-ci-lanes.md` 中的 P0-3 delta evidence 共同证明。

## 8. P0-4 Workspace Semantic Linker

状态：**COMPLETED**。

### Prerequisite

- P0-3 Semantic Pipeline Spine 退出条件全部满足。

### 实现

1. 保留 Contract parse / local normalization。
2. 建立 namespace / contract identity registry。
3. 支持显式 qualified reference / import。
4. 在 Semantic Frontend 内建立 Workspace Semantic Link phase。
5. Workspace-level entity / responsibility / operation / policy / effect resolution。
6. 检测 duplicate namespace、ambiguous reference、unresolved reference、cross-contract conflict。
7. 跨 Block Responsibility 只有通过显式 Contract linkage 才成立。
8. Semantic Policy 与 Verification Policy 建立显式 `ENFORCES / VERIFIED_BY` 映射。
9. Linker 输出进入 canonical IR build / validation；不得生成第二 authoritative semantic graph。

### 退出条件

- 文档中的跨 Block Responsibility 能被真实 Schema 表达和 linker 校验。
- 同名 Semantic Policy 与 Verification Policy 不再靠字符串猜测是否同一对象。
- duplicate namespace、ambiguous / unresolved reference、cross-contract conflict 具有确定性 diagnostics。
- 相同 workspace semantic input 在不同文件枚举顺序下产生相同 link result 与 semantic revision。
- Linker 只扩展 canonical Semantic Frontend，不建立旁路 Pipeline 或第二 authoritative semantics container。

## 9. P0-5 IR-owned Generator / Ticket Enforcement

状态：**COMPLETED**。

### Prerequisite

- P0-4 Workspace Semantic Linker 退出条件全部满足。

### 实现

1. Generator declaration 使用 discriminated union 或 per-kind schema registry。
2. `GeneratorPlan` 只从 validated IR + generator declarations 构建。
3. Generator 成为 IR Entity。
4. 生成 `CONSUMES / LOWERS_TO / GENERATES / VERIFIED_BY` Facts。
5. Lowerer 改为 IR-owned consumer，只接受 `ValidatedEngineeringIRSnapshot` / IR-derived `GeneratorPlan`，不再重新读取 Semantic Contract 解释业务语义。
6. 第一条母例只保留 `generate-state-transition-map`。
7. Ticket service 的状态变更必须消费同一 generated transition contract，禁止 Contract 与 runtime service 各自维护状态机。
8. Generator / lowerer 产物绑定当前 transaction、semantic revision 与 Artifact Provenance。

### 退出条件

```text
Ticket Contract
  → Semantic Frontend
  → Workspace Semantic Link
  → Validated IR
  → Generator Plan from IR
  → Runtime transition contract
  → Ticket service enforcement
  → positive + forbidden-transition verification
```

并且：

- Lowerer 不再读取 Semantic Contract 解释业务语义。
- `GeneratorPlan` 无法由未验证 IR 构建。
- 必须证明 `open → closed` 在 Contract 禁止时 runtime 同样拒绝。
- Ticket runtime 不存在第二套手工维护的状态转换 authority。
- 生成物 provenance 可追溯到 semantic revision、Generator entity 与 compilation transaction。

## 10. P0-6 Semantic Projection Takeover

状态：**COMPLETED**。

### Prerequisite

- P0-5 IR-owned Generator / Ticket Enforcement 退出条件全部满足。

### 接管顺序

1. Architecture View。
2. Scenario View。
3. State View。

### 实现要求

- Projection 只消费 `ValidatedEngineeringIRSnapshot`。
- Projection 不创造 authoritative relations。
- Architecture View 至少覆盖 Responsibility / Boundary / Contract-or-Port / Effect / Permission。
- Scenario View 的 `PRECEDES / AWAITS / RETRIES / HANDLES` 必须来自 Facts。
- Authority overlay 不使用 strongest-wins 把整个 target 染成 authoritative；必须暴露 mixed / inferred / conflict 状态。
- ExplainGraph、ReviewSummary 与 Workbench semantic view 改为消费统一 semantic projection / Fact identity，不再从 Lock / Manifest / Contract 重新解释业务语义。
- Workbench 读取统一 `SemanticView`，legacy governance tabs 只作为兼容视图保留。

### 退出条件

- Workbench 至少真实消费三种 `SemanticView`。
- ExplainGraph 不再重新解释 Semantic Contract / ownership / effect。
- 同一 Fact 在 Architecture / Scenario / State View 中引用同一 Fact ID。
- Projection path 不接受未 validated IR。
- 删除或明确降级所有与 canonical projector 竞争的 semantic interpretation path。

完成事实：

- `SemanticViewSet` 按 Architecture → Scenario → State 生成，绑定同一 input/semantic revision 并 deep-freeze；Pipeline Context 与 Lock 持有同一 projection revision。
- Architecture 直接保留 IR 的 Responsibility / Boundary / Port / Effect / Permission Entity 与 Fact 边，不再把 operation relation 折叠成 responsibility authority。
- Scenario 的 `PRECEDES / AWAITS / RETRIES / HANDLES` 保留 canonical Fact 方向、值与 Fact ID；raw/tampered IR 不能进入 Projector。
- Authority overlay 暴露 `uniform / mixed / inferred / conflict`、全部 authority 与 confidence range，不再输出 target-level strongest-wins authority。
- ExplainGraph 已移除 Manifest semantic reconstruction；ReviewSummary 与 Workbench 直接消费统一 projection，legacy governance 内容只保留物理文件、coverage、policy、repair、upgrade 等兼容层。

## 11. P0-7 Verification / CI Closure

状态：**COMPLETED；PR #93 已合并，验证与清理闭环完成**。

### Prerequisite

- P0-6 Semantic Projection Takeover 退出条件全部满足。

### 实现

1. Contract Verification 使用稳定 `contractId` 注册，不依赖 test title regex。
2. Test Impact source classification 覆盖 TypeScript、Manifest、Semantic Contract YAML、Source Model。
3. Test ownership 从架构 owner / pass / contract 显式声明生成，路径正则只作 fallback。
4. PR Quick 使用 canonical `test:affected`。
5. PR Risk 运行受影响 slow suites。
6. Full Validation 必须运行完整 fast suite + 完整 slow suites + workspace pipeline。
7. `run-full` label 存在时，PR synchronize 必须对最新 head 重跑 Full Validation。
8. Ordered workspace pass 失败后停止后续 mutating pass；`always()` 只用于 diagnostics / artifact collection。
9. CI Contract 验证 step order、trigger freshness 和 exact head SHA，不只检查 command string 是否出现在 YAML。
10. 增加 Ticket semantic vertical slice gate，覆盖 canonical frontend、validated IR、linker、IR-owned generator、runtime enforcement、projection 与 provenance。

### 完成事实

- Contract Freeze 以稳定 `contractId → test file` 注册并整文件运行，不再解析 test title。
- Test Impact 显式分类 TypeScript、Manifest、Semantic Contract YAML 与 Source Model；architecture owner、Pipeline pass 与 Contract identity declaration 优先于路径 fallback。
- PR Quick 的唯一 fast selector 是 `test:affected`；PR Risk 运行 impact-selected slow suites；Full 运行 canonical affected evidence、完整 fast、完整 slow registry 与 ordered workspace chain。
- `run-full` label 保留时，PR `synchronize` 取消旧 head run 并验证最新 head；没有 `run-full` 的 synchronize 不启动 hosted runner。
- CI Contract revision `ci-verification-v3` 结构化校验 trigger、PR/release step order、current base freshness、exact checkout/head/status wiring 与 `always()` diagnostics 边界。
- Ticket semantic vertical 已成为命名 slow suite，在一次真实母例中覆盖 validated snapshot、跨 Contract link、Generator、runtime enforcement、三种 projection 共享 Fact ID 与 provenance。
- P0-7 closeout 复用 hosted Quick / full-fast / budget / Contract Freeze 与 12 个 slow PASS，本地批量补齐其余 13 个 slow suites，并在 exact delta head 验证 canonical port → legacy pin compatibility 与 Prisma SQLite engine boundary；25/25 slow suites 均有有效 PASS。
- 本地 Full tail 已按 benchmark → deps → resolve → compose → adapt → verify-all → lock → explain → reference 顺序串行 fail-fast 通过；reference refresh 仅增加 22 个 pin alias 节点和 22 条兼容边，未删除 canonical graph 内容。

### 退出条件

- latest PR head 同时有 Quick / Risk / Full correctness evidence。
- 没有 fast test 只依赖 affected selector 而永远不进入 full gate。
- Workflow 与 CI Contract 不允许手工漂移。
- Ticket semantic vertical slice 在 Full Validation 中是强制门禁。
- 任一 canonical semantic path 被旁路、任一 consumer 回退到未 validated IR、或 Ticket runtime 与 generated contract 漂移时，CI 必须失败。

## 12. v0.3 完成定义

必须同时满足：

```text
One Authoring Authority
+ One Semantic Frontend
+ One Workspace Semantic Link
+ One Canonical Engineering IR
+ One Validated Engineering IR Snapshot
+ One Pipeline Coordinator
+ One Pipeline Semantic Context
+ IR-owned Lowering
+ Fact-grounded Projection
+ Transaction-owned Project Integrity
+ Latest-head Full Validation
```

并完成 Ticket 母例真实纵切面：

```text
Ticket Contract
  → Semantic Frontend
  → Workspace Semantic Link
  → Engineering IR
  → validateEngineeringIR()
  → Validated IR Snapshot
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

## 13. v0.4：Semantic Operations

只有 v0.3 完成后进入：

1. Fact Delta。
2. Impact Propagation。
3. Semantic Mutation。
4. AI Task Envelope v2。
5. AI Semantic Operator。

AI 仍不得直接写 IR。Semantic Mutation 回写 Authoring Source，由 Compiler 重建 IR。

## 14. 后续阶段

v0.3 稳定后：

1. Work Tracking 完整纵切面。
2. Private Registry 版本 / Trust 治理。
3. 两个独立团队 Block 生命周期验证。
4. PostgreSQL 正式目标。
5. Enterprise Business Process Hub 压力母例。
6. 多目标 / 多栈。

## 15. 当前禁止事项

在 v0.3 退出前，不把以下工作设为主线：

- 重新建设另一套 Pipeline Kernel。
- Workbench 新视觉效果。
- 新增更多业务 Block。
- 新增第二种业务母例。
- Enterprise Business Process Hub。
- 自动 L3 重构。
- 整仓 Autonomous Agent。
- Fact Delta / Semantic Mutation 的正式实现。
- AI Semantic Operator。
- stable `engineering-ir.json` 持久化。

## 16. 当前唯一执行顺序

严格执行：

```text
P0-1  Pipeline Kernel Foundation                         COMPLETED
  ↓
P0-2A Canonical IR Invariants                            COMPLETED
  ↓
P0-2B Validated IR Boundary                              COMPLETED
  ↓
P0-3  Semantic Pipeline Spine                            COMPLETED
  ↓
P0-4  Workspace Semantic Linker                          COMPLETED
  ↓
P0-5  IR-owned Generator / Ticket Enforcement            COMPLETED
  ↓
P0-6  Semantic Projection Takeover                       COMPLETED
  ↓
P0-7  Verification / CI Closure                          COMPLETED
  ↓
ci-verification-v3 local combined Full                   PASSED
  ↓
P0-7 bounded final invalidation audit                    PASSED
  ↓
PR #93 merge / implementation cleanup                    COMPLETED
  ↓
v0.3 exit review
```

P0-7 是最后一个实现 Work Package。本次经用户明确授权，以绑定 exact head/base、明确失效边界的本地组合 Full 替代新的 hosted Full；这不应表述为 latest-head hosted status success。最终 bounded audit 又在合并树上运行 canonical affected selector、Contract Freeze 74/74 与 4 个受 ExplainGraph additive compatibility change 影响的 slow consumers，关闭了 intervening-diff 解释缺口。完整命令、duration、原始 batch JSON 与复用规则见验证账本。

禁止再以“哪个测试红就局部修哪个测试”的方式推进主线。
