---
title: MVP 实施计划与路线图
status: active
last-reviewed: 2026-07-13
---

# MVP 实施计划与路线图

本文只维护当前实施阶段、退出条件和主线顺序。产品定义见 `02`；编译器边界见 `05`；IR 规范见 `14`。

## 1. 当前阶段判定

**v0.3 Semantic Core Foundation 已完成退出审查。** 当前进入 **v0.4 Semantic Operations**；Fact Delta canonical contract 与纯 kernel 已完成，当前唯一 active next 是 Impact Propagation canonical contract 设计。

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

v0.4 的 Fact Delta、Impact Propagation、Semantic Mutation 与 AI Semantic Operator 必须建立在上述 canonical representation 上；Semantic Mutation 只能回写 Authoring Source，再由 Compiler 重建 IR，不得直接修改 IR 或把 Lock 升格为 authority。

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

所有退出条件均为 **PASS**，未发现 unresolved architecture conflict。v0.3 状态因此更新为 **COMPLETED**；后续不得以 v0.3 收口为名继续修改已经正确的代码。

## 13. v0.4：Semantic Operations

状态：**ACTIVE NEXT（FD-2 Impact Propagation canonical contract 设计）**。

只有 v0.3 完成后进入：

1. Fact Delta canonical contract：固定 fact identity、before/after revision、deterministic diff、transaction ownership 与 verification/invalidation contract。
2. Impact Propagation。
3. Semantic Mutation。
4. AI Task Envelope v2。
5. AI Semantic Operator。

AI 仍不得直接写 IR。Semantic Mutation 回写 Authoring Source，由 Compiler 重建 IR。

### Fact Delta Work Packages

| ID | Work Package | 状态 | 退出条件 |
| --- | --- | --- | --- |
| FD-0 | canonical contract design | **COMPLETED** | `docs/14` 固定 fact-set scope、transaction-referenced endpoint 与 caller ownership boundary、validated-only boundary、deterministic classification、validity v1 边界、diagnostics 与 verification/invalidation contract |
| FD-1 | pure Fact Delta kernel | **COMPLETED** | 类型、唯一 Compiler producer、additive facade、test ownership、Contract Freeze 与 focused/risk evidence 已满足退出条件 |
| FD-2 | Impact Propagation canonical contract design | **ACTIVE NEXT** | 固定 direct/transitive impact、unknown/dynamic region、snapshot/index ownership、verification selection 与 empty Fact Delta 语义；设计进入 main 前不实现产品 kernel |
| FD-3 | Impact Propagation kernel | **BLOCKED BY FD-2** | 不得绕过 FD-2 authority freeze，也不得把 Impact 结果回写 Fact Delta |

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

## 14. 后续阶段

完成第 13 节 v0.4 顺序后，再进入：

1. Work Tracking 完整纵切面。
2. Private Registry 版本 / Trust 治理。
3. 两个独立团队 Block 生命周期验证。
4. PostgreSQL 正式目标。
5. Enterprise Business Process Hub 压力母例。
6. 多目标 / 多栈。

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

Fact Delta、Impact Propagation、Semantic Mutation、AI Task Envelope v2 与 AI Semantic Operator 只能按第 13 节顺序推进；后项不得绕过前项的 canonical contract、transaction ownership 与 verification evidence。

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
v0.4 FD-2 Impact Propagation contract design               ACTIVE NEXT
```

P0-7 是 v0.3 最后一个实现 Work Package。本次经用户明确授权，以绑定 exact head/base、明确失效边界的本地组合 Full 替代新的 hosted Full；这不应表述为 latest-head hosted status success。最终 bounded audit 又在合并树上运行 canonical affected selector、Contract Freeze 74/74 与 4 个受 ExplainGraph additive compatibility change 影响的 slow consumers，关闭了 intervening-diff 解释缺口。v0.3 exit review 只组合与裁决仍有效证据，不重跑 full-fast、25-suite slow matrix、workspace chain 或 GitHub Actions。完整命令、duration、原始 batch JSON 与复用规则见验证账本。

禁止再以“哪个测试红就局部修哪个测试”的方式推进主线。
