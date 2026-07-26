---
title: 测试架构
status: active
last-reviewed: 2026-07-27
---

# 测试架构

本文定义 SEC 仓库的测试层级、测试事实源和 Testkit 边界。CI lane 见 `test-feedback-and-ci-lanes.md`。

## 1. 稳定模型

测试架构固定为：

- 4 类反馈入口：affected、fast、slow、full。
- 4 个测试层：unit、contract、integration、e2e slow。
- 公共测试事实优先放在 `platform/shared/*-contract.ts` 或紧邻 production builder 的公共 Schema。
- Testkit 保持薄层，不引入第二套业务模型。

测试代码应读起来像规格：测试写不变量和场景，重复执行细节由 Testkit/Builder 统一。

## 2. 测试层

| 层 | 职责 | 禁止 |
| --- | --- | --- |
| `tests/unit` | 纯 Builder、Selector、Index、Formatter、安全边界 | 完整 Workspace/CLI/浏览器流程 |
| `tests/contract` | 公共 CLI/JSON/Package/CI/Error/IR Shape | 复制完整命令表、脚本对象、Slow Suite 列表 |
| `tests/integration` | Workspace Pipeline、Artifact Flow、IR/Projection 集成 | Next build、production server、Playwright、浏览器与真实安装 |
| `tests/e2e` | 明确的慢产品路径、真实Runtime lifecycle和单一浏览器 Smoke | 成为全部业务逻辑测试仓库 |

### IR 测试归属

- Entity/Fact ID、排序、引用完整性、revision digest、index：unit。
- IR public JSON/schema：contract。
- Plan/Lock/Manifest → IR → Projection：integration。
- Ticket observable runtime：unit/integration/API；只保留关键浏览器 smoke。

### 2.1 秒级反馈预算

`fast`表示可在编辑循环中反复使用的计算边界，不表示“给慢测试一个更大的timeout”。warmed开发环境采用以下目标：

| 反馈单位 | 目标 |
| --- | ---: |
| 单个unit/contract focused文件 | 通常`<= 5s` |
| 单个fast integration文件 | 通常`<= 10s` |
| leaf变化的focused fast batch | 通常`<= 10s` |
| focused imports prepare/check | `<= 4s`目标 |
| clean candidate imports freeze | `<= 5s`目标 |
| unchanged hot typecheck | `<= 5s`目标；cold/hosted保持完整检查 |
| 真实Next、server、Playwright或browser acceptance | 明确slow；只在最终Risk/release选择时运行 |

这些数值是编辑反馈 SLO，不是从某一次 wall-clock 结果自动生成的硬 Gate。性能事实分三层：

1. **结构性硬不变量**：selected root数、process spawn数、workspace复制次数、是否启动browser/server、是否命中isolated snapshot、Gate dispatch次数等可确定重算的工作量；违反即失败。
2. **可比较性能基线**：只在专门的性能变更中建立。固定candidate、输入、Bun/TypeScript版本、机器电源状态与warm/cold模式，先warm-up，再至少采集五组独立有效样本；报告median与observed range。宣称优化比例时必须对旧/新实现做同条件交错采样，不能比较两次孤立运行。
3. **单次诊断样本**：只用于定位phase或发现可能的离群点。一次超过目标既不能建立新baseline，也不能单独使candidate失效；最多立即复跑同一最小micro-sentinel一次。不能复现就记录为噪声并停止，能够复现才进入结构归因或正式采样。

CI timeout只是失控熔断器，不是性能基准。不得因为一次慢样本扩大timeout、全面回退、重复整批Gate或制造successor candidate；硬性能Gate应优先断言结构性工作量，只有稳定采样协议明确选择时才使用wall-clock裁决。

Lane归属由确定性工作内容裁决，不由一次duration裁决。以下边界是当前canonical实例：

| 能力 | fast owner | slow owner |
| --- | --- | --- |
| managed Git hooks | `tests/unit/install-git-hooks.test.ts`只读tracked hook合同 | `tests/e2e/install-git-hooks.test.ts`运行真实repo、commit、linked worktree与hook lifecycle |
| SM-3 durable terminal | `tests/unit/semantic-mutation-apply.test.ts`保留identity、redaction与一次最小durable chain | 既有`tests/e2e/semantic-runtime-contract.test.ts`统一运行runtime lowering、reparse、race、legacy audit、retention与全量durable I/O |
| Windows AppContainer | `tests/unit/windows-appcontainer-executor.test.ts`验证ABI、protocol、bundle与owner publication | `tests/e2e/windows-appcontainer-executor.test.ts`运行native sandbox、host/runtime residue和MAX_PATH acceptance |
| Pipeline closure与write lease | `tests/integration/pipeline-kernel.test.ts`和`pipeline-workspace-write-lease.test.ts`保留capability、blocked、journal、process与lease micro-sentinel | 既有`tests/e2e/pipeline.test.ts`拥有完整compose/emit completion proof与真实compile reentrant lease |
| Overview与verified semantic projection | `tests/integration/overview.test.ts`只保留missing-artifact CLI边界；`semantic-core-vertical.test.ts`从一个validated in-memory snapshot验证projection | 既有`tests/e2e/summary.test.ts`共享一次locked+explained Workspace；`semantic-runtime-contract.test.ts`拥有verified Workspace到architecture/scenario/state的闭环 |
| Windows browser launch path | `tests/unit/windows-browser-launch-path.test.ts`验证projection、target-swap race、path与fail-closed合同 | 既有`tests/e2e/runtime-host.test.ts`运行production Windows ACL和private host-root lifecycle |
| Dev Runner与本地Gate选择 | `tests/contract/dev-runner-contract.test.ts`保留package/CLI公共入口，direct import与`verification.ts`声明选择模块sentinel | 只有`import-organizer`与managed-hook dependency等更窄owner选择各自真实Git慢验收；整个`platform/dev-runner/**`不得触发通用baseline slow suites |
| Project runtime与repository contract | compiler dependency generation、project dependency state、generated project base、repository tooling、documentation authority与Task Envelope分别拥有独立文件；纯temp-root runtime tests进入普通concurrent shard，`repository.runtime` Contract Freeze只绑定轻量repository contract | `tests/e2e/runtime-host.test.ts`唯一拥有真实Next/server/Playwright/browser lifecycle；runtime authority变化只选择该exact slow owner |

这些slow owner即使某次运行偶然很快也不得进入fast；它们的真实Git、durable filesystem或native host副作用是稳定分类事实。反过来，fast owner单次超出目标也只触发最小phase诊断，不能凭一个样本迁层。

Slow文件内的昂贵共享setup必须按能力惰性创建或限定在局部suite，不能用文件级`beforeAll`迫使无关的named sentinel也启动完整Pipeline。共享locked Workspace的suite必须登记为`runtime-heavy`；共享只减少同一slow owner内部的重复setup，不改变slow归属，也不能让并行case共享mutable state。

需要真实Git、临时仓库或Language Service的fast component test必须把fixture lifecycle视为测试架构：不可变seed最多初始化一次，每个场景使用独立copy，互不共享working tree、index、lock或publication state；独立场景可有界并发，但必须由代码中的单一semaphore限制并断言peak，不得依赖Bun默认并发或用无限并发掩盖重复工作。seed、copy与外部alias都必须在失败路径清理。该优化只减少fixture与调度成本，不得mock或复制被测Git/TypeScript语义。

Fast runner的结构顺序固定为`bounded concurrent shard batches → bounded-parallel process isolation → exclusive process isolation`。同一进程内不安全不等于跨进程必须串行：只依赖module global或独立临时Workspace的文件可进入有界并行；会修改repository worktree、host profile、共享server/runtime lifecycle的owner保持独占。多个concurrent shard也只能按`fast-test-policy.ts`的单一有界cap并行，失败batch必须等待已启动siblings收口并阻止后续batch。分类、shard容量、两类并发cap与最大默认process waves只由该policy拥有，并由完整inventory的结构测试证明每个文件恰好一次、无遗漏且不超过wave预算；wall-clock不参与该hard invariant。

测试文件不能用“integration”名称或一次较慢duration申请exclusive。只有process-global mock、真实repository mutation、共享server/host runtime、不可隔离ambient cache等确定性状态冲突才能登记；所有I/O只落在独立`withTempWorkspace`根且runner/cache由参数注入的文件必须进入普通concurrent shard。一个文件混合多个owner时先按acceptance拆分，再判断每个新文件的调度，禁止为保留历史文件名而继承exclusive。

`test:fast`无selector时只运行默认编辑反馈inventory。包含完整Workspace compile、durable recovery、server/runtime lifecycle、真实repository worktree或完整upgrade transaction的文件由`DEFAULT_FAST_TEST_EXCLUSION_REGISTRY`从默认inventory排除；这不是删除覆盖，也不改变其test-impact身份。affected/Risk显式选中这些owner时仍运行原文件，`test:full`仍包含完整fast inventory和全部slow registry。禁止在runner复制第二份排除列表，禁止用排除掩盖无owner测试；每个排除项必须有确定性work-content reason、仍被完整inventory发现，并由结构测试证明default、explicit affected与full三条路径。

每次fast run必须绑定一个安全的run-owned mutable test-workspace namespace。所有child共享该namespace，mutable workspace仍由`mkdtemp`隔离；版本化immutable template cache与其lock位于namespace外的唯一共享根，创建完成后只读复用，普通run cleanup不得删除并重复初始化。parent runner在success、test failure、planner failure与spawn exception之后统一清理mutable namespace；child hook只是提前回收，不能替代parent ownership。cleanup失败必须使run失败，残留不能留给下一次Gate；显式`clean:test-workspaces`才删除完整root与template cache。

fast文件超过十秒时必须先按phase计时。若耗时来自build、server readiness、browser、安装、网络或真实workspace复制，应把该acceptance迁入已有slow owner，同时在fast层保留不启动生产进程的合同/micro-sentinel；不得通过缓存偶然命中、增大timeout或删除覆盖来宣称变快。Contract Freeze只允许快速合同成员，不能无条件启动真实Runtime。

Typecheck的warm加速只能使用TypeScript原生incremental invalidation；`.tmp/typecheck`可随时删除且不进入Git、artifact或Evidence。changed source、compiler version、compiler options或build-info损坏不得产生false PASS；任何疑义直接删除该derived目录并回到cold check。

Import organizer只把selected targets与项目声明文件作为Language Service roots；target的import closure、configured lib/types、unused判断和最终edits仍由TypeScript解析。Candidate只有在Git canonical clean-filter比较确认tracked working tree相对index无delta且不存在untracked path时才复用physical context；任一Git可见差异必须回到隔离full-index snapshot。`core.autocrlf`等checkout表示允许physical CRLF/LF bytes与index blob不同，因此physical context只提供非权威的module-resolution底座，selected targets始终由exact staged blobs覆盖，最终candidate bytes仍只来自index。该优化不得改变完整base→index选择、index lock、atomic publication或working-tree byte preservation。

## 3. 事实源

主要事实源：

- `test-budget-contract.ts`：测试发现、fast/slow 分类、slow suite model。
- `test-impact-contract.ts`：变更到 affected test 的选择。
- `ci-contract.ts`：CI lane contract。
- `runtime-dependency-spec.ts`：生成运行时依赖。
- `*-schema.ts` / production contract builder：公共数据 shape。

规则：

- 测试不得复制 slow suite IDs、glob、完整 CI command array、完整 package scripts。
- 优先测试“count 与 list 一致、sorted unique、lane boundary、coverage invariant”等语义不变量。
- Import Graph 能表达的 impact 不再额外维护 semantic owner table。
- Cross-domain 风险才使用显式 semantic impact rule。

## 4. Testkit

当前核心 primitive：

- `tests/testkit/contracts.ts`：合同不变量。
- `tests/testkit/cli.ts`：CLI text/JSON/compact JSON。
- `tests/testkit/workspace.ts`：Workspace 场景创建、清理和 Pipeline。

新增 Testkit helper 的门槛：必须替换至少多个真实重复点、减少测试代码，或把一个公共不变量集中到唯一实现。

Testkit 不能自己维护 Product/IR Schema。

## 5. Playwright 边界

Playwright 只证明生成 Runtime 的浏览器 Smoke：

- Next App 能启动。
- 登录路径可用。
- 一个关键页面可打开。
- 一个租户隔离路径可通过浏览器验证。

业务状态机、Contract、Fact Delta 和 Impact 不放进浏览器矩阵。

真实Next build、server lifecycle与Playwright request/browser必须由`tests/e2e`且登记在`test-budget-contract.ts`的slow suite拥有。`tests/integration`只能验证生成配置、argv/environment、lifecycle builder和cleanup合同，不得实际启动这些production children。

## 6. 依赖策略

当前测试栈：

- Bun test。
- `bun:test` mocking。
- Zod 仅用于公共边界。
- ts-morph 用于 AST/import graph。
- Playwright 用于单一 Runtime browser smoke。
- Bun snapshot 只用于稳定协议 JSON。

不通过增加 Jest/Vitest/Sinon/happy-dom 等近义工具解决测试结构问题。

## 7. 新能力测试清单

任何新 compiler capability 至少检查：

1. 同输入是否确定性。
2. 重复执行是否幂等。
3. ID/排序是否稳定。
4. Invalid input 是否产生稳定错误域。
5. Public shape 是否可解析/序列化。
6. 是否意外复制事实源。
7. 是否需要 integration 闭环。
8. 是否扩大 slow/browser 边界。

## 8. 完成标准

- 测试表达不变量而不是复制实现。
- Testkit 只负责执行 primitive。
- Playwright 不进入 affected/fast。
- Contract Freeze不启动Next、production server或Playwright。
- fast integration在warmed环境保持十秒内目标；超出即作为分层/fixture复用缺陷调查。
- Slow suite 数据只由代码 Registry 维护。
- 改一个事实源不要求同步三份数组和文档。
