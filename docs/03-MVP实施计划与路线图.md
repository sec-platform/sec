---
title: MVP 实施计划与路线图
status: active
last-reviewed: 2026-07-23
---

# MVP 实施计划与路线图

本文只维护当前实施阶段、退出条件和主线顺序。产品定义见 `02`；编译器边界见 `05`；IR 规范见 `14`。

## 1. 当前阶段判定

**v0.3 Semantic Core Foundation 已完成退出审查。** Fact Delta、Impact Propagation、Semantic Mutation SM-0～SM-3、Phase 0 Current Reality Rebase、IR canonical primitives import-cycle removal 与 TEST-H1 fast timeout V9 bootstrap 已进入 `main`。SM-4A trusted authorization ingress candidate 已形成 focused/static evidence，但其 canonical affected aggregate证明 test/runtime dependency bootstrap没有物化 isolated runtime唯一接受的 worktree-local Playwright cache；fresh hosted Ubuntu runner同样只有`bun install`而没有该authority。因此当前唯一正式执行闭包是 **TEST-H2 Runtime Browser Cache V10 Bootstrap**，产品 active next 仍是 **SM-4A Workbench/CLI minimum Semantic Mutation v2 loop**。SM-4B Task Envelope v2 与 SM-4C AI Semantic Operator 不属于 SM-4A。

当前真实形态：

```text
Governed File Compiler 主干
  + Pipeline Kernel Foundation（已进入 main）
  + compilation transaction / journal（已进入 main）
  + compileWorkspace() 统一协调入口（已进入 main）
  + Semantic Contract + Workspace Semantic Link（已进入 Pipeline semantic stage）
  + Canonical / Validated Engineering IR handoff（已进入 Pipeline semantic context）
  + Architecture / Scenario / State canonical Projection
  + IR-owned State Transition Generator + Ticket runtime enforcement
  + Slot Mock Synthesis
```

必须严格区分：

```text
Pipeline Kernel + Semantic Frontend / Linker / Validated IR handoff
+ IR-owned Lowering + Fact-grounded Projection + Verification Closure
= v0.3 Semantic Core Foundation 退出条件已满足
```

禁止把“类型、builder、projector、validator 或单测文件已经存在”计为 Work Package 完成。完成必须证明对应能力进入唯一编译主链，并由真实纵切面验证。

## 2. v0.3 收口：退出审查与组合验证证据

P0-7 Verification / CI Closure 已以 `ci-verification-v3` 本地组合 Full evidence 完成 correctness 收口；Quick / full-fast / budget / Contract Freeze、25/25 slow suites、benchmark / deps / ordered workspace / reference tail 均有可复用证据。PR #93 已 squash merge 为 `9bbdc86`，原 feature branch、专用 worktree、Junction 与临时 evidence 已清理。P0-6 已让 Architecture / Scenario / State Projector 只接受 validated snapshot，并让 ExplainGraph、ReviewSummary 与 Workbench 消费同一 `SemanticViewSet` / Fact identity。

v0.3 exit review 逐项复核了 Authoring Authority、Semantic Frontend、Workspace Semantic Link、Canonical / Validated Engineering IR、Pipeline Coordinator / Semantic Context、IR-owned Lowering、Fact-grounded Projection、transaction-owned integrity 与 Ticket 母例纵切面。冻结审查发现 template sandbox 曾独立重复构造 semantic bundle/context；PR #96 已把该旁路收敛到唯一 `buildWorkspaceSemanticBundle()` 与 canonical context constructor。`Latest-head Full Validation` 由仍有效的昂贵 baseline、intervening-diff 影响判断和 bounded delta evidence 组合绑定到当前 integration tree；它不是一次新的 hosted Full，也不得写成 GitHub status success。完整组合与失效规则由 `docs/test-feedback-and-ci-lanes.md` 持有。

目标主链：

```text
Plan app / acceptance + Policy Source Declarations + Registry Block Manifest / Semantic Contract
  → Semantic Frontend
  → Workspace Semantic Link
  → Canonical Engineering IR
  → validateEngineeringIR()
  → Validated Engineering IR Snapshot
  → Pipeline Semantic Context
  → IR-owned Lowering / Verification / Projection
  → Project / Governance Artifacts
```

Plan 中的 app / acceptance、official / project policy source declarations 与 Registry Manifest / Semantic Contract 共同构成 authoring authority。Lock 只保存 resolver 选择、slot task 与 Pipeline 产生的 resolved execution state，不是平行的业务语义 authoring authority。

以下路径不得回归：

```text
Contract / raw IR → Projection（绕过 validated snapshot）
Contract → Semantic Plan → Lowering
Lock / Manifest → business-semantic ExplainGraph reconstruction
Lock / Manifest → business-semantic Workbench reconstruction
```

v0.4 的 Fact Delta、Impact Propagation、Semantic Mutation 与后续 AI Semantic Operator 必须建立在上述 canonical representation 上；Semantic Mutation 只能回写 Authoring Source，再由 Compiler 重建 IR，不得直接修改 IR 或把 Lock 升格为 authority。后续 SEC-TS 与 Engineering Workspace IR 的分层规划分别由 `docs/architecture/sec-ts-ir-layers.md` 和 `docs/architecture/engineering-workspace-ir.md` 持有。

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
- Semantic Contract parser / normalizer 与 workspace loader。
- **Ticket Semantic Contract**：当前首个真实业务 Semantic Contract 母例，authoritative contract 位于 `platform/registry/official/ticket.basic/contracts/ticket.yaml`。
- **Engineering IR Kernel**：`platform/compiler/ir/**` 下的 deterministic builder、index 与 identity boundary。
- **Fact Provenance**：保存 Fact assertion 的 authority、confidence、provenance 与 evidence；与生成物来源的 Artifact Provenance 分工，不互相替代。
- Architecture / Scenario / State canonical projector。
- **Pipeline Kernel Foundation**：统一 `compileWorkspace()` 协调入口、Pass Registry / dependency、compilation transaction、journal、pass lifecycle 与下游失效基础。

这些模块已通过 v0.3 主线归位到唯一 Semantic Frontend、Pipeline semantic context 与真实 Ticket 纵切面；v0.4 复用这些边界，不重建平行解释器或第二套 semantic context。

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

### 退出审查结论

初始冻结审查基线为 `main@d31a627ff6c41fe14202dd229e4b56aba002e42e`；旁路修复经 PR #96 squash merge 后，最终 integration state 为 `main@07290ccda640db5e285f1d4e198b2721e6d88a8c`。实现事实以代码和 authority 为准；测试事实以 `docs/test-feedback-and-ci-lanes.md` 的可复用 evidence composition 为准。

| 退出条件 | Canonical implementation | 验证证据 | 结论 / 未解决冲突 |
| --- | --- | --- | --- |
| One Authoring Authority | Plan app / acceptance + official / project policy source declarations + Registry Block Manifest / Semantic Contract；`loadWorkspaceEngineeringIRBuildInput()` 是 workspace semantic input 唯一装载入口 | P0-4 linker integration、Ticket semantic vertical | **PASS**；Lock 只持有 resolved selection / slot execution state，无平行 Semantic Plan authority |
| One Semantic Frontend | `buildWorkspaceSemanticBundle()` 唯一执行 input load、IR build/validate、Generator Plan 与 `SemanticViewSet` 构建；Pipeline adapter 再由 `runWorkspaceSemanticFrontend()` 绑定 transaction | P0-3/P0-4 focused evidence + `v0-3-semantic-frontend-87a0a9e` | **PASS**；template sandbox 已删除重复 builder 链 |
| One Workspace Semantic Link | `platform/compiler/semantic-linker.ts` 把 resolved Contract 依赖写入 canonical Entity / Fact | P0-4 18/18、37/37 与 reference evidence | **PASS**；无 consumer-side relink |
| One Canonical Engineering IR | `buildEngineeringIR()` 与 `platform/shared/engineering-ir/**` 持有 Entity / Fact / Assertion / revision identity | P0-2A vertical + P0-2B regression evidence | **PASS**；无第二 canonical graph |
| One Validated Engineering IR Snapshot | `validateEngineeringIR()` / `buildValidatedEngineeringIR()` 签发 branded、deep-frozen snapshot | P0-2B 23/23 与 boundary type sentinel | **PASS**；Projection/Lowering 不接受 raw IR |
| One Pipeline Coordinator | `compileWorkspace()` 统一协调 resolve → semantic → compose → adapt → verify → lock → emit | P0-3 Pipeline sentinels、ordered workspace Full tail | **PASS**；无第二主 Pipeline |
| One Pipeline Semantic Context | `bindPipelineSemanticContext()` / `createPipelineSemanticContext()` 把 snapshot / Generator Plan / `SemanticViewSet` 绑定同一 transaction/revision | P0-3/P0-6 Pipeline consumer vertical + sandbox sentinel | **PASS**；stale/mismatched revision hard fail |
| IR-owned Lowering | `buildSemanticGeneratorPlan()` + `lowerSemanticTasks()` 只消费 transaction-owned validated context | P0-5 Generator / Ticket runtime focused set | **PASS**；Ticket 状态转换只消费生成的 `NEXT_TICKET_STATUS`，无第二张 transition table |
| Fact-grounded Projection | `buildSemanticViewSet(snapshot)` 派生 Architecture / Scenario / State views；ExplainGraph、ReviewSummary、Workbench 的业务语义关系只消费该 bundle | P0-6 projector/consumer/compatibility evidence | **PASS**；Lock / provenance / policy / coverage 仅可提供治理或物理 overlay，不重建业务语义 |
| Transaction-owned Project Integrity | Pipeline Kernel / journal 与 provenance 共同绑定 transaction ID、revision、generated artifact | P0-3 failure/retry、P0-5 provenance、reference evidence | **PASS**；无跨 transaction snapshot 复用 |
| Latest-head Full Validation | `ci-verification-v3` hosted baseline + 本地剩余 slow batch + exact delta closure + final invalidation audit + semantic frontend delta closure | Quick、full-fast 329/329、Contract Freeze 74/74、25/25 slow、PR #96 affected/6-suite risk/workspace/reference；详见验证账本 | **PASS（组合证据）**；不是 latest-head hosted status success |

Ticket 母例由命名 slow suite `e2e-ticket-semantic-vertical`（`tests/e2e/semantic-runtime-contract.test.ts`）覆盖同一真实纵切面：Contract → Linker → canonical / validated IR → transaction context → Generator Plan → generated runtime contract → runtime enforcement → provenance → Architecture / Scenario / State views。`ticket-service.ts` 的状态转换执行只消费生成的 `NEXT_TICKET_STATUS`，不手写第二张 transition table。该 suite 已在 P0-7 25/25 slow composition 与 PR #96 的 6-suite semantic frontend 风险批次中通过。

`validateResolvedTemplates()` 是非权威的隔离 template sandbox adapter：它复制已解析 workspace 输入后复用 `buildWorkspaceSemanticBundle()` 与 `createPipelineSemanticContext()`，只负责 compose/typecheck 预检，不拥有第二套 frontend、Pipeline coordinator 或业务语义 authority。PR #96 的 head `3649ac63e11bc6f336bf69d48e33f9810ec0996a` 与 squash merge `07290ccda640db5e285f1d4e198b2721e6d88a8c` tree 一致；持久 evidence 位于 `docs/evidence/v0-3-semantic-frontend-verification.json` 与 `docs/evidence/v0-3-semantic-frontend-risk-batch.json`。

v0.3 的语义能力退出条件均为 **PASS**，状态因此更新为 **COMPLETED**。Phase 0 后续发现的 `ir-identity.ts → ir-revision.ts → ir-identity.ts` import cycle 已由 IR-H1 / PR #135 在 `main@5f70db3` 消除，并保持 canonical bytes不变；TEST-H1 / PR #136 已在 `main@8aa2d2d` 固定fast timeout与v9 identity。当前engineering closure只补齐test/runtime browser cache materialization与v10 trust-root identity；它不撤销已验证的产品能力，也不得借机改变selector、Evidence schema、Gate顺序或产品revision。

## 13. v0.4：Semantic Operations

状态：SM-0～SM-3、Phase 0 文档/控制面 closure、IR canonical primitives cycle removal与Affected Fast Timeout V9 Bootstrap **COMPLETED**；Runtime Browser Cache V10 Bootstrap **ACTIVE PREREQUISITE**；产品 **ACTIVE NEXT = SM-4A**。

只有 v0.3 完成后进入：

1. Fact Delta canonical contract：固定 fact identity、before/after revision、deterministic diff、transaction ownership 与 verification/invalidation contract。
2. Impact Propagation。
3. Semantic Mutation。
4. SM-4A Workbench/CLI minimum product adapter。
5. 在 Source Ownership、SEC-TS IR/Lowering 与完整 Workbench 的前置合同满足后，进入 SM-4B Task Envelope v2。
6. SM-4C AI Semantic Operator。

AI 仍不得直接写 IR。Semantic Mutation 回写 Authoring Source，由 Compiler 重建 IR。

### Fact Delta / Impact Propagation Work Packages

| ID | Work Package | 状态 | 退出条件 |
| --- | --- | --- | --- |
| FD-0 | canonical contract design | **COMPLETED** | `docs/14` 固定 fact-set scope、transaction-referenced endpoint 与 caller ownership boundary、validated-only boundary、deterministic classification、validity v1 边界、diagnostics 与 verification/invalidation contract |
| FD-1 | pure Fact Delta kernel | **COMPLETED** | 类型、唯一 Compiler producer、additive facade、test ownership、Contract Freeze 与 focused/risk evidence 已满足退出条件 |
| FD-2 | Impact Propagation canonical contract design | **COMPLETED** | `docs/14` 已固定 endpoint-specific seed/closure、versioned direction registry、unknown/dynamic authority、snapshot/index ownership、verification recommendation 与 empty Fact Delta 语义 |
| FD-3 | pure Impact Propagation kernel | **COMPLETED** | 唯一纯 producer、独立 rules/types/tests/ownership/Contract Freeze 与 focused/risk evidence 已满足退出条件；未把 Impact 回写 Delta 或接入产品 consumer |

FD-1 Work Package implementation contract：

- **Base**：FD-0 authority merge 后的 latest `main`。
- **Architectural goal**：实现 `buildFactDelta(from, to)` 纯函数；只消费带 transaction audit reference 的最小 endpoint context 内的 `ValidatedEngineeringIRSnapshot`，输出 deterministic、deep-frozen、`scope: "fact-set"` 的 v1 delta；真实 transaction ownership 由 canonical caller 负责，kernel 不作无法从 snapshot 证明的承诺。
- **Owned files**：在 `platform/shared/engineering-ir/` 新建 `delta-types.ts` 并 additive export；在 `platform/compiler/ir/` 新建 `build-fact-delta.ts` 并从 compiler facade additive export；新增 `fact-delta.test.ts` unit / contract tests；更新 semantic test-impact ownership、Contract Freeze registry 与本 Work Package evidence / authority status。
- **Allowed minimal seam expansion**：仅 additive export、独立 `fact-delta` test owner 和 `semantic.fact-delta` Contract Freeze target。
- **Forbidden**：修改现有 Fact/Assertion/Validated Snapshot shape、semantic revision algorithm、Builder/Validator/IR index；接入 Pipeline stage、Workspace、Lock、Projection、ReviewSummary、Workbench、Impact 或 Mutation；生成 stable artifact。
- **Acceptance**：实现 `docs/14` 全部 precondition、classification、ordering、freeze 和 stable diagnostic；compile-time 拒绝 raw IR/Lock/Projection；不修改输入；entity-only semantic change 可产生空 Fact arrays；`validToRevision` 在 v1 hard fail。
- **Required evidence**：一次 focused unit/contract batch；`test:affected`、Contract Freeze、changed-import/typecheck；若 compiler public facade 使 selector 命中 slow consumer，只批量补 selector 要求的 suite。复用仍有效的 v0.3 full-fast、其余 slow、workspace 与 reference evidence，不重跑全矩阵或 GitHub Actions。
- **Reconciliation point**：FD-1 merge 后重新读取 `main`，先建立 Impact Propagation contract / DAG；不得把 expected mutation DSL 或 transitive impact 塞进 Fact Delta。

### FD-1 退出审查

`buildFactDelta(from, to)` 已作为 Compiler / IR boundary 的唯一纯 producer 实现，shared type、compiler facade、独立 `fact-delta` test owner 与 `semantic.fact-delta` Contract Freeze target 已闭合。实现不读取 Workspace、不接 Pipeline stage、不写 Lock/Projection/Artifact，也未修改既有 Fact/Assertion/Snapshot shape、Builder、Validator、revision algorithm 或 IR index。

退出证据为组合 exact-delta evidence：focused/contract 49/49、Contract Freeze 77/77、affected fast 162/162、typecheck、changed-import、独立 digest expected vectors 与 frozen review 全部 PASS；selector 要求的 `e2e-graph`、`e2e-local-views`、`e2e-ticket-semantic-vertical` 3/3 在 exact production head 通过。最终 head 只在该 production head 上追加 Contract Freeze expected vectors 与本退出记录，因此复用三项 slow evidence，不重跑 full-fast、其余 22 个 slow suites、workspace/reference chain 或 GitHub Actions。完整 head/base、duration、mechanical import closure 与失效规则位于 `docs/evidence/v0-4-fact-delta-kernel-verification.json` 和 `docs/evidence/v0-4-fact-delta-risk-batch.json`。

### FD-2 退出审查与 FD-3 implementation contract

FD-2 冻结的关键裁决是：from/to 图分别传播，addition/removal 不共享 union graph；Entity/Fact seed 可传播，Assertion-only seed 只形成局部治理/证据影响；四条 executable relation direction 使用独立 rule registry，其他 active relation 停在 unknown frontier；v1 没有合法 dynamic producer；`VERIFIED_BY` 只产生 Acceptance/selector 推荐，实际执行和 CI test mapping 仍归 Verification authority。现有 Upgrade impact、ReviewSummary aggregation、Workbench diff、ExplainGraph traversal、changed-file test selection 与 external graph evidence 均不得升格为 canonical semantic Impact。

FD-3 Work Package implementation contract：

- **Base**：FD-2 authority merge 后的 latest `main`。
- **Architectural goal**：实现 `buildImpactPropagation({ delta, from, to })` 纯函数；以 canonical Fact Delta 和两个 transaction-referenced validated snapshots 为唯一输入，在 kernel 内派生两个只读 index，输出 deterministic、deep-frozen、endpoint-specific `SemanticImpactPropagation`。
- **Owned files**：新增 shared semantic-impact types、Compiler semantic-impact rule registry 与唯一 producer；从 shared/compiler facade additive export；新增 focused unit / contract tests；新增独立 `impact-propagation` test owner 与 `semantic.impact-propagation` Contract Freeze target。
- **Allowed minimal seam expansion**：仅 additive facade、dedicated ownership、Contract Freeze registry 和验证 evidence；不得修改现有 Predicate Signature Registry 来承载传播方向。
- **Forbidden**：修改 Fact/Assertion/Validated Snapshot shape、Builder、Validator、semantic revision algorithm、IR index shape 或 Fact Delta；接入 Pipeline stage、Workspace、Lock、Projection、ReviewSummary、ExplainGraph、Workbench、Mutation、AI Task Envelope、stable artifact、Upgrade impact 或 CI test selector。
- **Acceptance**：满足 `docs/14` 的 endpoint binding、entity merge-join、seed level、rule revision、authority frontier、BFS cycle/tie-break、uncertainty、verification recommendation、diagnostics、digest、ordering、freeze 与 compile-time rejection；expected reachability 和 digest vectors 不调用 production traversal/rules/sort helper 计算。
- **Required evidence**：一次 focused unit/contract batch、changed-import/typecheck、`test:affected` 与完整 Contract Freeze；compiler facade 若使 selector 命中 slow consumer，只批量运行 selector 实际要求的 suite。继续复用仍有效的 v0.3/FD-1 full-fast、其余 slow、workspace/reference 与 GitHub Actions 证据。
- **Reconciliation point**：FD-3 merge 后从新 `main` 重新计算 Semantic Mutation contract；初始 kernel 不接产品 consumer。

FD-2 的 docs-only verification、frozen review 与失效边界记录在 `docs/evidence/v0-4-impact-propagation-contract-design.json`。

### FD-3 退出审查

`buildImpactPropagation({ delta, from, to })` 已作为独立 Semantic Impact domain 的唯一纯 producer 实现。kernel 重算并精确核对 canonical Fact Delta，在内部派生 validated index，分别对 from/to 图执行确定性传播；完整 v1 action 表和四条 executable edge tuple 均由独立 rule registry 冻结。shared type、compiler/shared facade、`impact-propagation` test owner 与 `semantic.impact-propagation` Contract Freeze target 已闭合。实现未修改 IR/Fact Delta/Index shape，未接 Pipeline、Workspace、Lock、Projection、ReviewSummary、ExplainGraph、Workbench、Mutation、Artifact、Upgrade 或 CI selector。

退出证据绑定 exact implementation head `4811feac5b43916741dcc948d0b3720d6f638627`：focused unit/contract 48/48、affected fast 171/171、Contract Freeze 82/82、typecheck、changed-only import、patch hygiene 与独立 frozen review 全部 PASS；canonical selector 要求的 10 个 slow suites 10/10 PASS，失败数 0，测试后 tracked tree clean。Frozen review 发现并关闭了两个合同缺口：所有 v1 predicate action drift 现在稳定触发 `IMPACT-003`；non-definite Fact root 不再借权威 mapping 升级为 runnable recommendation，同时 assertion-only seed 仍保留 recommendation 能力。因为最终追加内容仅是本 evidence/roadmap 记录，production 与 contract blobs 保持 exact，继续复用 v0.3 full-fast、未选择 slow suites、ordered workspace/reference tail、benchmark/dependency 与 GitHub Actions 证据。完整 blob、head/base、duration 与失效规则位于 `docs/evidence/v0-4-impact-propagation-kernel-verification.json` 和 `docs/evidence/v0-4-impact-propagation-risk-batch.json`。

下一 reconciliation point 是从 FD-3 merge 后的新 `main` 重新读取 authority、代码、open PR/Issue 与有效 evidence，先设计 Semantic Mutation canonical contract；不得把 mutation DSL、source edit、AI envelope 或产品 consumer 反向塞入 Impact kernel。

### Semantic Mutation Work Packages

| ID | Work Package | 状态 | 退出条件 |
| --- | --- | --- | --- |
| SM-0 | canonical contract design | **COMPLETED** | `docs/14` 已冻结 request/plan/result v2、单一首版 operation registry、source ownership、restricted expectation、diagnostic precedence、transaction/CAS/rollback/recovery 与 Verification ownership；`00/09/11/12` 只保留各自 owner 摘要 |
| SM-1 | pure request/plan/result kernels | **COMPLETED** | 纯 normalization、condition/expectation matcher、plan/result invariant 与 Contract Freeze 已落地；没有 Workspace IO、source adapter、consumer 或 live apply |
| SM-2 | source adapter and edit-plan boundary | **COMPLETED** | 固定 authoring index、真实 loaded provenance、唯一 writable owner resolver、固定 allowlist path、realpath/reparse policy、deterministic edit plan、byte CAS 与 rollback manifest 已落地 |
| SM-3 | isolated apply coordinator | **COMPLETED** | 跨进程 lease、isolated rebuild、actual Delta/Impact、Verification union、atomic publish、verified rollback/recovery journal 与 exact production seam 已满足退出条件 |
| IR-H1 | canonical primitives import-cycle removal | **COMPLETED** | PR #135 已进入 `main`；identity/revision 双向 import消除，canonical bytes不变，dependency-cruiser零环 |
| TEST-H1 | affected fast timeout V9 bootstrap | **COMPLETED** | PR #136 已以人工trust-root bootstrap进入`main@8aa2d2d`；concurrent/serial fast invocation共享180秒有界默认timeout，V1 identity为v9 |
| TEST-H2 | runtime browser cache V10 bootstrap | **ACTIVE PREREQUISITE** | project-runtime实际执行并绑定external Node 22+，拒绝Bun/低版本/非Node/不可执行/execPath漂移；project-local registry failure fatal，只有成功选择但physical executable缺失才安装；doctor、test bootstrap与non-isolated runtime verifier复用该owner，V1 revision/artifact推进到v10 |
| SM-4A | Workbench/CLI minimum product loop | **PRODUCT ACTIVE NEXT** | 只接 `add-state-transition`；共享 trusted adapter、CLI plan/apply/query/recover、Workbench State View/API、HTTP trust boundary 与真实 vertical 闭合 |
| SM-4B | Task Envelope v2 | **DEFERRED** | 在 SEC-TS 主链与完整 Workbench 前置条件满足后，冻结 semantic target/operation/must-preserve/verification minimum；不复制 Mutation authority |
| SM-4C | AI Semantic Operator | **DEFERRED** | 只消费 SM-4B Envelope/Context Packet 并提交 bounded proposal；无直接 writer、无自行扩权 |

### SM-0 退出审查与 SM-1 implementation contract

SM-0 的关键裁决是：Semantic Mutation 是独立 Authoring Source transaction，不是 View Mutation、IR patch、Fact Delta patch、Repair、Upgrade 或 Pipeline journal 的别名。Proposal 与 trusted platform context 分离；caller 不能提交 filesystem path、actual `FactDelta` / Impact、risk、required passes、rollback 或 verification reduction。首版 registry 只冻结 `add-state-transition`，且只有平台能从 loaded contract provenance 唯一解析到 non-registry writable owner 时才可 ready；official Registry Ticket contract 仍不可写，`source/model/**` 文件也只有经固定 authoring index 被 canonical frontend 真实装载并产生 exact IR provenance 后才能成为 owner，不能把同名 copy 当作 writable mirror。

SM-1 Work Package implementation contract：

- **Base**：SM-0 authority merge 后的 latest `main`。
- **Architectural goal**：实现 mutation-specific 纯 request normalization、restricted condition/expectation matcher、plan/result builders 与 invariant validator；冻结 `contractVersion: "2"`、`semantic-mutation-operations-v1`、exact match、stable diagnostics/revision/ordering/deep-freeze，但不执行 source resolution 或 IO。
- **Owned files**：优先新增 mutation-specific shared types、Compiler `semantic-mutation` operation registry、request normalizer、condition/expectation matcher 与 plan/result invariant modules；从 `platform/compiler/index.ts` additive export；新增 dedicated unit/contract tests、独立 test-impact owner、`semantic.mutation` Contract Freeze target 与 evidence。
- **Allowed minimal seam expansion**：只允许 mutation-specific types/modules、compiler facade additive export、dedicated ownership 与 Contract Freeze registry；若 shared consumer 尚不存在，不修改宽泛 `platform/shared/types.ts` barrel。
- **Forbidden**：Workspace/filesystem IO、path helper、YAML writer、source adapter、live transaction、Pipeline stage/journal、Workbench/API/CLI/AI consumer、Repair、Upgrade、Fact Delta/Impact/IR/Validated Snapshot/Index/Projection/Lock shape、semantic revision algorithm、official Registry contract、stable artifact 与 CI selector语义。
- **Acceptance**：proposal 与 trusted context 类型不可混淆；unsupported operation 和 caller-supplied authority 字段 fail closed；conditions/expectations 只接受冻结 DSL；exact matcher 对未声明 Entity/Fact/Assertion drift hard fail；operation/diagnostic/output stable order、digest 与 deep-freeze 有独立手写 vectors；terminal result 不允许 partial success 或把 recovery-required 表述为普通 reject。
- **Required evidence**：一次 focused unit/contract batch、changed-only import/typecheck、`test:affected` 与完整 Contract Freeze；compiler facade 若使 selector 命中 slow consumer，只批量运行 selector 实际要求的 suite。继续复用仍有效的 FD-3 full-fast、未选择 slow、workspace/reference 与 GitHub Actions 证据，不重跑全矩阵。
- **Reconciliation point**：SM-1 merge 后从新 `main` 重算 source ownership/path/CAS DAG，再设计 SM-2；不得提前为当前 official Ticket contract 发明 writable `source/model/**` mirror 或把 impure executor 塞入纯 kernel。

### SM-1 退出审查

SM-1 已实现 mutation-specific shared types 与纯 Compiler kernels：严格 request normalization、两阶段 preflight/plan 边界、condition/expectation exact matcher、首版 `add-state-transition` operation registry、保守 Verification planning policy，以及 plan/result builder 与 invariant validator。`contractVersion: "2"`、operation/expectation/policy revision、diagnostic precedence、risk floor、required Verification union、terminal-only status、digest、ordering与 deep-freeze 均由独立 contract vectors 冻结。结果 invariant 重新核对 exact plan、base/staged endpoint、Fact Delta、Impact、source digest、Verification requirement/execution revision；digest-correct 的 unknown status、wrong stage/binding、额外 Entity/Fact/Assertion drift 均 fail closed。

实现保持纯边界：没有引入 Workspace/filesystem/path/YAML/source adapter、live transaction、Pipeline/Workbench/API/CLI/AI consumer、Repair、Upgrade 或 stable artifact；没有修改 Fact Delta、Impact、IR、Validated Snapshot、Index、Projection、Lock shape，也没有修改宽泛 `platform/shared/types.ts`。shared/compiler facade、`semantic-mutation` test owner 与 `semantic.mutation` Contract Freeze target 已闭合。

退出证据绑定 exact implementation head `c0e3d93ceaf6ac03b5e98e299176f8c1a0848665` 与 tree `6508831df479e329c116203c574970757fffa20b`：focused Semantic Mutation 13/13（包含于 canonical affected batch）、affected fast 165/165、Contract Freeze 89/89、typecheck、changed-only imports、patch hygiene 与独立 frozen review 全部 PASS；selector 唯一要求的 `e2e-graph`、`e2e-local-views` 两条 slow suite 共 6/6 tests PASS，失败数 0，测试后 tracked tree clean。第一次 implementation head 因 changed-only imports gate 失败而整体失效；机械 import 排序被 amend 后，全部 canonical gate 已在新头重跑。最终只追加本路线图与两份 evidence，recorded production/contract/authority blobs 保持 exact；不重跑 full-fast、其余 slow、workspace/reference chain 或 GitHub Actions。完整 argv、时间、duration、changed-path digest、blob、raw evidence digest 与失效/复用账本位于 `docs/evidence/v0-4-semantic-mutation-kernel-verification.json` 和 `docs/evidence/v0-4-semantic-mutation-risk-batch.json`。

下一 reconciliation point 是 SM-1 merge 后从新 `main` 重新读取 source ownership、path containment、realpath/reparse、byte CAS 与 rollback authority，设计 SM-2；不得从当前纯 preparation shell 推断已有 writable owner 或 live apply 能力。

### SM-2 退出审查

SM-2 已把 Authoring Source 接入唯一 workspace semantic input：canonical frontend 对 Authoring Source 只读取固定 `source/model/semantic-contracts.yaml` 索引，并把 Registry 与 Authoring contract 的真实 source kind/revision 和 loaded contract provenance 随 validated snapshot 一并传出。未被该 loader 装载的 mirror 不具有 authority；`workspace-registry` / `compiler-registry` 始终 read-only。Resolver 从 base IR 的 authoritative contract provenance 重算唯一 source，固定 owner ID 的 percent-encoding、`semantic-contract-yaml-v1` adapter 与 segment-aware `allowedPathPrefixes`，且 v1 多 operation 必须汇聚到一个 authoring file。

Source boundary 已冻结 canonical POSIX lexical containment、realpath、symlink/junction/reparse、Windows case-fold/device/ADS、duplicate canonical path/hardlink identity 与 stable-read TOCTOU 防护。YAML adapter 以 AST 只添加并排序 exact transition，保留 UTF-8 BOM、LF/CRLF、comments 与 final-newline 形态；edit plan 绑定 preflight/request/authorization/registry/source/path revisions、before/staged byte digests 和 rollback manifest，replay 先执行 before-byte CAS 并重算 transform。SM-2 只形成 deterministic source edit plan 和不可变 rollback metadata，没有创建 lease/staging、执行 canonical rebuild/Fact Delta/Impact/Verification、写 live source、publish、rollback 或 recovery journal；这些生命周期仍全部属于 SM-3。

退出证据绑定 exact implementation head `117159714b4707e26b5a611e07b0865aabec07b6` 与 tree `e1e612e6fa5eb799231ede7a8bae422818350ff8`：focused Semantic Mutation owner batch 75/75、807 assertions；affected fast 195/195；Contract Freeze 94/94；typecheck、changed-only imports 与 patch hygiene 全部 PASS。Canonical selector 要求的 `e2e-graph` 5/5、`e2e-ticket-semantic-vertical` 1/1、`e2e-local-views` 1/1 共 7/7 tests PASS，测试后 tracked tree clean。独立 frozen review 发现并关闭了 opened-handle 未绑定 pre-inspection target identity 与 hardlink alias 未 fail-closed 两个 blocker，最终 review PASS、无 blocker。首次未设置 `SEC_AFFECTED_TESTS_BASE` 的 affected run 选择 0 files，原 `12b6234` 与中间 `7e5be0a` evidence 也因上述 blocker 明确失效；最终 exact-head run 使用 `SEC_AFFECTED_TESTS_BASE=origin/main`。Docs/evidence closeout 不修改任何 recorded production/contract blob，继续复用既有 full-fast、未选择 slow suites、workspace/reference chain 与 GitHub Actions 证据，不重跑全矩阵。完整 head/base、argv、duration、blob ledger、raw evidence digest 与失效规则位于 `docs/evidence/v0-4-semantic-mutation-source-adapter-verification.json` 和 `docs/evidence/v0-4-semantic-mutation-source-adapter-risk-batch.json`。

下一 reconciliation point 是 SM-2 merge 后从新 `origin/main` 重算 lease、transaction directory、isolated rebuild、Verification execution、atomic publish、rollback/recovery journal 与 replay DAG；不得把 SM-2 edit plan 描述成已经 apply，也不得在 SM-3 前接 Workbench、CLI、AI 或 live mutation consumer。

### SM-3 implementation contract

- **Base**：SM-2 squash merge 后的 `origin/main@49f96d75cd90a4e5b43db5f8b4dfedebb0f3017f`。
- **Architectural goal**：实现唯一 isolated apply coordinator：通用 cross-process workspace writer lease、deterministic retained transaction directory/staged transaction、lease内 fresh preflight/source plan、base/source/expected-plan CAS、same-volume staging/backup、canonical staged rebuild、actual Delta/expectation/Impact、Verification-owned conservative execution、atomic single-file publish、live full downstream rebuild、verified rollback、crash recovery与replay/query/retention。
- **Owned files**：Mutation-specific transaction/record/publish modules，`platform/orchestrator/semantic-mutation-orchestrator.ts`，Verification-owned local adapter，generic `platform/shared/workspace-write-lease.ts` 与 Pipeline reentrant lease seam，mutation-specific shared types，Compiler additive facade，唯一 `semantic-mutation` test owner，独立 `semantic.mutation-apply` Contract Freeze target、focused tests与evidence。
- **Required shared seam**：所有 live workspace writers至少经 canonical `compileWorkspace()` 或同一 generic writer lease；Pipeline不依赖 Mutation，Mutation持 token reentrant调用 live rebuild。Downstream closure只读取现有 Pipeline registry，不复制pass order。Workbench/CLI product adapter 属于 SM-4A；Task Envelope 与 AI 分别属于 SM-4B/SM-4C。
- **Verification contract**：使用 `semantic-mutation-verification-report-v1` report schema、`semantic-mutation-local-verification-v2` adapter revision 与真实 `reportRevision`；完整 requirement union保守映射到一次 isolated verify-all，逐requirement记录 execution。当前本地个人使用 profile 由 host 进程内唯一 canonical `Bun.build()` 生成 runner bundle，再只监督一个独立 verifier child；不存在 Worker、第二 helper process、第二 builder、browser host alias 或 IPC/CDP 控制面。Child 只在 retained staging workspace 中运行 host-path-free bundle，使用完整替换环境与空 `PATH`，并由 writer lease、超时、bounded output、child-tree closure 和 artifact binding 共同约束。Windows 因 libuv 长路径限制可让 manifest-bound trusted absolute bootstrap 从短 volume-root 初始 cwd 启动，但 bootstrap 必须从自身固定位置推导唯一 staging root，并在任何 progress、loader 或 verifier import 前 fail closed 地切换到该 cwd；其他平台直接以 staging cwd 启动。通过的 isolated artifact set 只能签发一个 Verification-owned、one-shot staged proof：proof exact 绑定 source/project input、input/semantic/plan revision、完整 requirement、execution/report 与 raw artifacts，并在 live publish 后再次校验；Pipeline 只经 Verification façade消费它，不导入 Mutation-specific compiler internals。该 profile 不把 runner 当作不可信代码，也不宣称提供网络或恶意代码安全沙箱；Windows AppContainer 只保留为 optional hardening backlog，不是本 P0 收口或 SM-3 退出条件。未知/缺失/non-runnable/non-isolated、wrong plan/endpoint/source/union/report binding均在publish前以010拒绝；不得复用 changed-file selector或旧report冒充semantic verification。
- **Recovery/replay contract**：`.sec/semantic-mutation/v1` immutable generation journal，状态 `prepared → authoring-committed → verified | rolled-back | recovery-required`；fixed crash digest matrix、request identity/revision collision、retained exact replay、256 terminal retention、active/recovery-required不自动清理、query contract全部冻结。普通合同拒绝以显式 apply outcome返回，不靠throw。
- **Forbidden**：修改Fact Delta/Impact/IR/Projection shape或revision、把Pipeline journal/Workbench mutex/Repair/Upgrade backup冒充Mutation authority、非原子copy fallback、caller注入path/lease/staging/Verification evidence、接Workbench/API/CLI/AI consumer、修改official Registry contract、运行GitHub Actions或全slow/full矩阵。
- **Acceptance**：真实child-process lease contention/orphan recovery；dry-run/apply plan revision稳定且lease内重算；publish前所有failure保持live bytes/derivatives不变；publish后mismatch执行committed-digest CAS rollback并精确恢复base；第三方write/restore/rebuild/journal失败进入durable recovery-required；exact replay不二次apply；四种terminal lifecycle、record chain、retention/query、diagnostic脱敏与early-stage call-count均有deterministic vectors。
- **Required evidence**：完整实现后一次focused owner batch；独立frozen review集中关闭blocker；冻结implementation head后只运行一次canonical affected、完整Contract Freeze、changed-only imports/typecheck，以及selector实际要求的slow batch。默认风险簇为`e2e-graph`、`e2e-local-views`、`e2e-ticket-semantic-vertical`、`e2e-verify-lock`；若generic Pipeline seam使selector增加pipeline suites，则同批追加。复用未被blob交集失效的full-fast、其余slow、workspace/reference与GitHub Actions旧证据，不重复全矩阵。
- **Reconciliation point**：SM-3 merge后从新main重算 SM-4A；不得把 Task Envelope v2 或 AI Operator 提前混入最小产品 adapter。

### SM-3 退出审查

SM-3 已闭合唯一 isolated apply coordinator：generic cross-process writer lease 与 Pipeline exact reentrant token、retained isolated transaction、lease 内 fresh replan 与 base/source/plan CAS、same-volume staging/backup、staged canonical rebuild、actual Fact Delta / expectation / Impact、Verification-owned requirement union 与一次 isolated `verify-all`、atomic publish、live downstream rebuild、completion proof、committed-digest rollback，以及 immutable generation journal / replay / query / 256 terminal retention / durable recovery-required 均由 canonical owner 实现。Workbench/CLI product consumer 仍未接入，属于 SM-4A；AI 与 Task Envelope consumer 分别属于 SM-4C/SM-4B。

import/runtime 根因也已作为工程协议闭合：`.shared-deps` 是唯一 runtime dependency owner；11 个 dependency/devDependency package manifest 由同一冻结列表驱动 shared install、capability publication、prebound readiness、copy 与 launch proof，逐项要求非空 manifest、精确 `name` 与非空 installed `version`，不完整安装不发布 ready stamp。解析器不再缓存依赖树尚未就绪时的错误 fallback；production sentinel 不再覆盖 `dependencyModules` 或复制 compiler-owned source。Git lifecycle hook 的 deployed generation 绑定当前 `process.execPath`，内部 gate snapshot 则禁用 checkout hook并固定 Git long-path materialization，因此 import 准备不再依赖调用方 PATH、临时目录深度或隐式 worktree side effect。

退出证据绑定 exact implementation head `53709496e6d0195f764612905420de025f8f443d` 与 tree `c9d929b05bdfc7598eb0cc634e0dfed238b5ab91`。唯一新 production identity 在 `bf702a5036dc4f32242c57b50b5fbc472b8fd66c` / tree `b43a7367021ef2e1e4ab8f44f4c67e03a76171fc` 运行一次并以 1/1 PASS、0 fail、约 130.7 秒证明 canonical import/runtime closure、single builder、resume、bootstrap、runner、controlled failure、Job settlement 与 cleanup；其后只变化 CI/snapshot/hook verification infrastructure，production 与 sentinel blobs 未变，因此不重跑该 identity。组合证据还包括 Windows lifecycle 45/45、三个 deterministic apply siblings 3/3、Contract Freeze 124/124、V7 residual base 的 321 个未受影响 PASS 加 V8 exact owner 43/43、typecheck、changed-only imports 与 patch hygiene。完整命令、head/tree/blob、失败身份退役、证据复用与失效规则位于 `docs/evidence/v0-4-semantic-mutation-exit-closure-2026-07-19.json`。

SM-3 状态因此更新为 **COMPLETED**。Windows AppContainer 仍是 optional hardening，`capabilityComplete:false`；本退出不宣称恶意代码或网络安全沙箱能力。IR-H1与TEST-H1均已进入`main`；SM-4A ingress在v9 replay后的affected又暴露canonical browser cache没有由test bootstrap物化，因此必须先以TEST-H2/v10人工bootstrap闭合该前置，再从新`main`重放并重冻ingress。公共DTO、路由schema、canonical authorization payload与排序算法保持单写者，不提前混入Task Envelope v2或AI Semantic Operator。

2026-07-23 reconciliation事实：TEST-H1 / PR #136 已以人工bootstrap squash merge为`main@8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2`。SM-4A v9 candidate `bca9102` 的focused owner batch、typecheck、dependency architecture、docs、imports与Contract Freeze通过；canonical affected唯一失败title首先因worktree-local revision1217 Playwright cache缺失而返回blocked diagnostics。物化cache后一次exact-title尝试与覆盖repo、LOCALAPPDATA和USERPROFILE的递归扫描竞争磁盘并在300秒超时，后续artifact-read是teardown次生错误，只能记为`INVALID_ENV_CONTAMINATED`。Hosted Ubuntu workflow同样没有canonical cache materialization，故TEST-H2成为新的串行前置；candidate及其计划仍不构成产品完成证据。

同日TEST-H2架构复审进一步否决“PATH文件存在即Node authority”的初版假设：Bun的`process.versions.node`不是external Node证明，registry `executablePathOrDie()`又会把Node/require/registry failure误判为cold cache并下载。physical-cold-path复审还证明缺失leaf会让`.shared-deps`父junction或cache中间junction绕过旧检查，把lock/download写出worktree。当前修正实际执行并绑定同一个Node 22+ physical executable，由非抛出的registry expected path严格区分fatal authority failure与唯一cold condition，并在lock前、lock内和真实spawn前逐段验证root到expected executable的类型、reparse与realpath containment；direct/preload 34/34（137 assertions）、managed runner 21/21和v10 policy 69/69仅证明未提交修正树，不是exact-head或`main`完成证据。

### SM-4A minimum product contract

- **Architectural goal**：让本地用户通过 CLI 与 Workbench 的同一个 trusted product adapter plan/apply/query/recover 现有 `add-state-transition`，并看到 source owner、actual Delta、Impact、Verification 与 terminal result。
- **Shared owner**：一个 platform-owned product adapter 只负责 raw transport DTO validation、trusted local product policy draft，以及产品错误/结果投影；CLI 与 HTTP server 都只能作为 transport shell。SM-4A 的第一个串行 seam 由 Mutation/Compiler owner 暴露 additive authorization ingress：复用现有 authorization normalizer/revision builder，并经 SM-2 registry 获取 canonical owner token 与 writable path-prefix policy，再把 normalized context 交给既有 preflight/plan/apply。SM-1 继续独占 canonical request/plan/result revisions，SM-2 继续独占 owner-token/path-policy algorithm 与 actual source/path resolution；新 adapter 不生成 `allowedSourceOwnerIds` / `allowedPathPrefixes` 或复制这些算法。
- **Dependency direction**：CLI/Workbench server → product adapter → Compiler/Semantic Mutation public facade。新 adapter 不放入 legacy Workbench mutation owner，Pipeline 不导入 adapter 或 Mutation，避免 Workbench ↔ Pipeline ↔ legacy mutation cycle。
- **HTTP trust boundary**：mutating routes 必须仅接受受信本地 caller。至少满足 loopback bind + strict same-origin/Origin policy，或每次启动生成并校验不可预测 capability；禁止以 wildcard CORS 暴露写操作。错误响应不得泄露未授权 filesystem path、source bytes、secret 或内部 stack。
- **Scope**：operation registry 仍只有 `add-state-transition`；plan 不写 live source；apply 强制 expected plan revision 并在 lease 内 fresh replan；query/recover 只消费 canonical journal/outcome；accepted/rejected/rolled-back/recovery-required 可区分。
- **Product vertical**：Workbench State View 与 CLI 对相同 workspace/request/policy 得到 byte-identical canonical request/plan/result binding；accepted 后只由 canonical rebuild 生成 projection，不触发第二次独立 `/api/compile`。
- **Legacy**：`/api/mutations`、`applyViewMutations()` 与 graph dry-run 保持明确 v1/legacy，迁移完成后降级或退役；在此前不得宣称它们是 Semantic Mutation v2。
- **Forbidden**：扩 operation catalog；修改 `docs/14` 第 18 节 canonical contract/revisions；让 product adapter 生成 authorization/source-owner token/path prefix 或 canonical revision；重排 Pipeline；复制 Verification、lease、source resolver 或 journal；实现 Task Envelope v2/AI；修改 CI/import/hook trust-root。
- **Required evidence**：shared adapter contract/property、CLI/HTTP positive/negative/security、Workbench State View、terminal lifecycle、legacy separation、一个真实 product vertical、affected/typecheck/Contract Freeze/changed-only imports；复用未被 diff 失效的 SM-3 evidence。
- **Stop/recompute**：若 additive authorization ingress 无法保持现有 Mutation contract/revisions 与 SM-2 owner/path semantics，HTTP trust 需要全局 server redesign，或必须修改 Pipeline order、Verification schema、writer lease/source owner，则停止该包并从最新 `main` 重算。

### SM-4B / SM-4C 边界

SM-4B 才实现 Task Envelope v2 的 semantic target、allowed operation、must-preserve、Context Packet 与 Verification minimum；SM-4C 才让 AI 在该 Envelope 内提交 proposal。二者在 `docs/09-AI Runtime、任务信封与治理规范.md` 保持规划状态，不是 SM-4A exit 条件。SM-4A 的 local trusted adapter 不得伪造未来 envelope，也不能被 AI 直接调用以绕过授权。

## 14. 后续阶段

SM-4A 后的主线按前置合同推进：

1. Blockless Semantic Source Ownership；
2. Target Profile 与 Semantic Type Algebra；
3. Application IR、Behavior IR 与 TypeScript Program IR；
4. Generic TypeScript Lowering 与反特化 adapters；
5. 完整 Workbench；
6. SM-4B Task Envelope v2 与 SM-4C AI Semantic Operator；
7. Engineering Workspace domains 与 Snapshot；
8. Nexus Corpus/Parity/Migration；
9. TypeScript Brownfield Attach/Lift/Adopt/Normalize；
10. Work Tracking、Registry Trust、PostgreSQL、多目标/多栈与生产化。

层级合同分别见 `docs/architecture/**` 和 `docs/governance/nexus-absorption-and-conformance.md`。Nexus exact-tree Census 可只读并行，但不成为第二 active package，也不阻塞 SM-4A 可见产品。

## 15. 当前禁止事项

进入 v0.4 后仍禁止：

- 重新建设另一套 Pipeline Kernel。
- Workbench 新视觉效果。
- 新增更多业务 Block。
- 新增第二种业务母例。
- Enterprise Business Process Hub。
- 自动 L3 重构。
- 整仓 Autonomous Agent。
- stable `engineering-ir.json` 持久化。

Fact Delta、Impact Propagation 与 Semantic Mutation SM-0～SM-3 已完成。SM-4A、Source Ownership、SEC-TS 多层 IR/Lowering、完整 Workbench、SM-4B 与 SM-4C 必须按第 14 节前置关系推进；后项不得绕过 canonical contract、transaction ownership 与 verification evidence。

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
v0.3 exit review                                          PASSED
  ↓
v0.3 Semantic Core Foundation                             COMPLETED
  ↓
v0.4 Fact Delta canonical contract design                 COMPLETED
  ↓
v0.4 FD-1 pure Fact Delta kernel                           COMPLETED
  ↓
v0.4 FD-2 Impact Propagation contract design               COMPLETED
  ↓
v0.4 FD-3 pure Impact Propagation kernel                    COMPLETED
  ↓
v0.4 SM-0 Semantic Mutation canonical contract design       COMPLETED
  ↓
v0.4 SM-1 pure request/plan/result kernels                  COMPLETED
  ↓
v0.4 SM-2 source adapter and edit-plan boundary             COMPLETED
  ↓
v0.4 SM-3 isolated apply coordinator                         COMPLETED
  ↓
Phase 0 Current Reality Rebase                               COMPLETED
  ↓
IR-H1 canonical primitives import-cycle removal              COMPLETED
  ↓
TEST-H1 affected fast timeout V9 bootstrap                   COMPLETED
  ↓
TEST-H2 runtime browser cache V10 bootstrap                  ACTIVE PREREQUISITE
  ↓
SM-4A trusted authorization ingress replay                    PAUSED NEXT
  ↓
v0.4 SM-4A shared adapter + CLI/Workbench vertical           PRODUCT ACTIVE NEXT
  ↓
Blockless Source Ownership → Target Profile/Type Algebra    PLANNED
  ↓
Application/Behavior/TypeScript Program IR + Lowering       PLANNED
  ↓
Full Workbench → SM-4B Task Envelope v2 → SM-4C AI          PLANNED
```

P0-7 是 v0.3 最后一个实现 Work Package。本次经用户明确授权，以绑定 exact head/base、明确失效边界的本地组合 Full 替代新的 hosted Full；这不应表述为 latest-head hosted status success。最终 bounded audit 又在合并树上运行 canonical affected selector、Contract Freeze 74/74 与 4 个受 ExplainGraph additive compatibility change 影响的 slow consumers，关闭了 intervening-diff 解释缺口。v0.3 exit review 只组合与裁决仍有效证据，不重跑 full-fast、25-suite slow matrix、workspace chain 或 GitHub Actions。完整命令、duration、原始 batch JSON 与复用规则见验证账本。

禁止再以“哪个测试红就局部修哪个测试”的方式推进主线。
