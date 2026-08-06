---
title: 自主开发治理
status: stable
domain: development-governance
last-reviewed: 2026-08-06
---

# 自主开发治理

本文拥有 SEC 仓库开发的事实源、计划分层、Role/Operation/Skill 边界、Issue/Work Package/PR/Evidence 生命周期、A0/Worker/Reviewer 权责、成熟轮子采用、可验证续跑和工程自主治理目标。具体启发式闭包只存在于 `.agents/skills/**`；机器可判断的规则必须下沉到代码合同。

## 自主治理责任

SEC 的产品、架构、实现、测试、文档、CI、Review、分支和主干状态必须持续一致。维护者或 A0 不能只机械执行用户最后一句命令，也不能等待用户发现工程全局冲突。

每次任务都必须判断是否出现：

- 产品目标与实现方向不一致；
- roadmap 依赖颠倒或横切设施抢占产品主线；
- canonical owner重复、缺失或被 Proposal/Evidence/Projection竞争；
- 同类缺陷重复，说明共享抽象、状态 owner、fixture、selector或门禁缺失；
- 已有成熟轮子、标准或平台原语，却在Core重复实现通用机械能力；
- 外部库私有类型、AST、ID、默认行为或品牌模型泄漏进Semantic Core；
- 当前 `main` 已包含结果而旧 PR/branch/plan仍声称未完成；
- 活动 Work Package、rolling plan、Issue 或文档已被新事实取代；
- Skill/Agent/context机制复制机器规则或污染上下文；
- 已正确 candidate 只剩 merge/closeout，而不是继续制造修改。

发现这些情况时，工程动作可以是设计重算、最小修复、Provider/Adapter隔离、成熟轮子采用、合并、关闭、归档、删除重复实现或确认无修改；不能为了保持“持续开发”而制造无证据变化。

## 当前规则与目标机制

- **当前可强制规则**：`main` authority、一个 formal active Work Package、single writer、frozen manifest、exact candidate Evidence、独立 Review、merge readback 和 branch hygiene。
- **已实现但尚未成为默认并行运行时**：并行 Work Package resolver（V3 schema、pairwise conflict resolver、global exclusive resource registry）。
- **已冻结的目标架构**：Agent Operation Compiler、Integration Queue、Development Run Kernel、Run State/Event/Transition、统一 Evidence references 和自动 feedback service。

目标设计不能被文档、Issue、Skill prose 或模拟对象升格为当前能力。在 Integration Queue、Run Kernel、外部 Run State 与自动 feedback service进入 `main` 前，默认继续使用一个 formal active Work Package 和可验证的 manual-shadow 续跑。

## 事实与授权顺序

```text
latest main + live Git/GitHub facts
→ docs/authority.json and canonical domain owners
→ product / system architecture / roadmap
→ AGENTS.md universal router
→ trusted repository orientation or full audit
→ selected frozen Work Package
→ typed Operation / Task Envelope
→ relevant source, contracts and tests
→ exact-head Evidence and independent Review
→ merge → new-main readback → cleanup → replan
```

`main` 是唯一正式产品事实。Branch、Issue、PR body、聊天、计划、Project 看板、审计报告、代码图、Completion Report 和模型记忆只提供导航、候选、决策或 Evidence，不能证明结果已进入主干。

Resolver 无法确定 default ref、target repository/workspace、active pointer、manifest bytes/digest、PR base/head、review/CI 或 authority owner时 fail closed。

## 计划与记录分层

- **`docs/product.md`**：产品问题、边界、用户结果和长期成功判据。
- **`docs/system-architecture.md`**：总体对象、两条主链、authority flow、单写者和跨域依赖。
- **`docs/roadmap.md`**：唯一稳定 capability DAG、阶段进入/退出和反转条件。
- **Canonical domain docs/code**：领域对象、长期不变量、公共合同和机器规则。
- **GitHub Issue**：真实问题、依赖、竞争方案、决策、验收和反证；不是运行日志或第二 roadmap。
- **Rolling plan**：当前包与接下来二至五个条件化候选；不是永久 backlog或稳定架构。
- **Work Package Manifest**：被激活交付闭包的 frozen scope、authority、ownership、Gate 和退出合同。
- **Operation / Task Envelope**：一个执行者在 manifest 内的单角色、单 operation、单 seam授权。
- **Pull Request**：一个 exact candidate diff及其 Review 表面。
- **Checks/Artifacts/Evidence**：绑定 exact input/environment 的物理证明。
- **Development Run State（目标 owner）**：run、event、transition、resume和下一合法动作；未实现前由外部 Git/PR/manifest/Evidence重算。
- **GitHub Project**：Issue/PR的可视化投影。
- **`main`**：完成后的唯一产品结果。

Dynamic SHA、run、failure tail 和临时候选不复制进 stable docs。Evidence 可以保存架构裁决、实验和历史计划，但不得自称当前状态源或长期路线 owner。

## 成熟轮子与通用基础设施治理

SEC只应自行拥有自己的工程语义、authority、identity、Contract、Effect、Permission、Transaction、Verification和Migration。解析器、类型检查器、图算法、缓存、schema validator、进程/路径工具、浏览器、数据库驱动、密码学、云SDK等通用机械能力优先使用成熟、可靠、可验证的轮子或标准平台原语。

“轮子优先”不是“发现开源仓库就必须采用”。正式裁决必须以真实consumer和同条件Evidence为基础。

### Capability Census

新增或扩大自定义通用基础设施前，Work Package必须提供最小充分的 capability census：

```text
problem / real consumer
→ required capability and contract
→ current internal implementation and cost
→ mature external candidates / standards / platform primitives
→ exact versions, license, security and maintenance
→ real trial / A-B / corpus evidence
→ coverage, failure, unknown and integration cost
→ whether a thin Adapter is sufficient
→ minimum justified self-built surface
→ duplicate code / dependency / path to remove
→ rollback, revalidation and retirement conditions
```

没有上述Evidence时，不得以“更可控”“以后可能需要”“AI写起来容易”或“自己实现更统一”为由扩大自研面积。

### 采用决策

候选决策只能是明确状态：

- adopt mature substrate/provider；
- wrap with thin Adapter；
- absorb proven design into SEC unique owner；
- retain current focused implementation with evidence；
- defer with trigger；
- reject with rationale；
- retire/remove duplicate。

真实试用发现工具噪声高、覆盖不足、输出不可定位、维护/安装/安全成本过高，可以成为拒绝或限定使用的Evidence。品牌知名、功能列表更长、下载量高或多个工具输出一致都不能替代SEC自己的验证。

### Provider Boundary

具体库、编译器API或外部工具必须通过唯一Provider/Adapter边界接入：

- consumer依赖SEC-owned contract，不依赖Provider私有DTO、AST Node、Symbol/Type对象、随机ID或品牌状态机；
- package/version/Target/coverage/freshness/failure和resource boundary显式；
- external output先视为不受信input并canonicalize/validate；
- Provider只拥有其能力和Evidence，不拥有Engineering Semantic authority、Implementation Resolution、Impact、Verification Result或publish decision；
- Provider升级、替换和退役有consumer census、parity和旧路径删除。

禁止在Semantic Core、Application/Behavior IR、Operation/Mutation、Impact或Verification truth中散布：

```text
if library === ...
if providerVersion >= ...
import provider-private AST/type/model
reconstruct semantic meaning from package name
trust provider default behavior as Contract
```

库特定代码只能位于Provider、Adapter、Backend recipe、Migration、conformance fixture或明确Target package边界。

### 语言与 Compiler API

同一语言工具链的能力必须拆分管理：

- CLI checker；
- syntax parser；
- Program/TypeChecker与module resolution；
- Language Service；
- source transform/printer；
- formatter；
- build/runtime executable。

不能让一个`typescript`、`ts-morph`或其他品牌包名隐式拥有全部能力和版本authority。Core不能直接依赖Compiler API私有对象；直接import必须收敛在声明的Language/Backend Provider边界。迁移到新版本或新实现时逐能力做parity和retirement，禁止全仓散落版本分支。

### Reference Provider

SEC可以为基础能力提供少量Reference Provider，用于：

- 验证Semantic Contract和IR是否足够完整；
- 提供最小、可解释、可离线的conformance oracle或fallback candidate；
- 在生态不存在可靠实现时闭合真实consumer。

Reference Provider不能以“原生”之名免除安全、性能、维护和negative tests，也不能无限扩张为自己的HTTP、ORM、数据库、浏览器、密码学或云生态。存在成熟高质量实现时，Reference只保留其基准职责或退役。

### 自定义实现退出门

自定义通用实现只有在以下之一成立时可长期保留：

- 它表达SEC独有authority/semantic/transaction/verification contract；
- 外部候选经真实Evidence证明无法满足关键合同；
- 薄Adapter不足以补齐；
- 自研面积被限制在最小边界；
- 具有owner、测试、版本、迁移、替代和退役条件。

一旦成熟轮子、标准原语或上游API达到parity，必须执行consumer迁移和duplicate removal，不能以“备用”名义长期保留双实现，除非存在真实failover contract和定期physical proof。

## Agent Operation System

最终开发运行时固定为：

```text
Universal Policy
→ explicit Agent Role
→ typed Operation Envelope
→ exactly one Primary Skill
→ deterministic services / contracts / tools
→ typed outcome and legal next transition
→ external Run State / Evidence
```

### Role

Role 是执行者身份、职责和可申请权限上限，不是 workflow：

- **Integrator / A0**：事实重算、work selection、control plane、Gate custody、integration、merge和closeout；
- **Worker**：在 frozen envelope 的 branch-write边界内实现；
- **Reviewer**：对 exact candidate 独立只读审查；
- **Auditor**：对 exact revision 做事实、architecture、repository或Evidence census；
- **Maintainer**：在文档、toolchain、provider、agent-system等明确治理 envelope内工作。

Role不能通过加载 Skill扩大权限。子 Agent 不继承父 Agent 的 Role、Skill、path或capability，必须显式签发 Envelope。

### Operation Envelope

一次 operation 至少绑定：

- repository、exact main/base/target/candidate identity；
- Role、operation kind、Primary Skill；
- authority reads/writes；
- path reads/writes与forbidden surface；
- required capabilities、trust class和resource bounds；
- inputs、expected outputs和completion claims；
- Verification obligations；
- stop、reload、reconcile和expiry conditions。

最终可执行权限是交集：

```text
Role maximum
∩ Operation Envelope grant
∩ repository/domain policy
∩ tool/provider capability
∩ current state transition
```

Skill只能声明 required capabilities，不能扩大交集。

### Primary Skill

一次 operation只有一个 Primary Skill。跨阶段工作通过 typed transition顺序推进：

```text
orient
→ audit | diagnose | design | implement | review | integrate | govern | no-change
```

禁止同时加载多份 Primary Skill共同解释一个状态转换。Impact、Gate selection、Work Package parser、permission intersection、Failure/Epoch、Evidence reuse和merge legality等机器规则不重复写入 Skill prose。

Skill只保留需要 Agent 判断的：触发/不触发、输入、分析方法、工具选择、解释、停止和 typed outcome。详细 schema、枚举、命令和平台矩阵引用 canonical code或按需 reference，避免长流程连续加载重复正文污染 context。

### Deterministic services

以下能力必须由唯一代码 owner 提供：

- repository snapshot resolver；
- work selector；
- Work Package / Integration conflict resolver；
- Change Closure compiler；
- impact/test/Gate selector；
- permission evaluator；
- candidate epoch/failure classifier；
- Verification aggregator；
- Evidence/Run State；
- publication、merge、readback和cleanup owner。

产品Implementation Resolver、Block Resolver、Dependency materializer和Provider catalog分别由其canonical产品领域拥有；Development Skill或Agent不得在仓库开发流程中复制这些算法或用搜索结果/模型判断代替机器结果。

Skill可以消费和解释 service结果，但不能重新实现算法或输出竞争状态。

## A0、Worker、Reviewer 与 Auditor

### A0 / Integrator 独占

- 最新事实、产品目标、canonical architecture和rolling DAG重算；
- active Work Package选择、candidate invalidation和proof reset；
- authority/resource/write-set冲突裁决；
- Gate custody、independent Review、integration和merge order；
- new-main readback、Issue/PR收口、branch/worktree/workflow hygiene；
- 发现全工程设计冲突时建立聚焦 architecture convergence，而不是等待用户拆解；
- 发现成熟轮子、自研重复、Provider泄漏或版本迁移缺口时，主动路由到唯一owner并建立最小可执行迁移，不只留聊天建议。

A0不替Worker修改同一owner seam，也不把所有发现塞进一个巨型implementation package。

### Worker

Worker只在 frozen Envelope 和 owned seam内实现，不自授权跨 owner、扩大路径、降低 Verification、触发 hosted Gate或合并。发现 root assumption、owner、scope或architecture不成立时停止并返回 Reconciliation Delta，不在局部代码继续堆例外。

引入或自研通用能力时，Worker必须引用已冻结的capability census/Provider decision；不得临时安装工具改变candidate环境，不得把库私有模型泄漏进Core，也不得在没有migration的情况下新增长期双实现。

### Reviewer

Reviewer只读 exact base/head/tree、authority、Evidence和真实diff。它寻找范围越界、第二owner、遗漏consumer、弱化assertion、临时probe、自证、生成物漂移和无法恢复路径。Head变化立即使Review stale；Reviewer不替Worker改码。

涉及外部库或自研基础设施时，Reviewer还必须检查：真实consumer、替代候选、版本/许可证/安全、Adapter边界、direct import graph、duplicate removal、fallback真实性、升级/退役和package/lock唯一writer。

### Auditor

Repository orientation只建立当前任务最小充分事实。用户要求全仓、重大架构变化、重复系统缺陷或authority/code/test/CI无法解释时，Auditor对全部tracked paths、owner、entry、state、dependency、verification和unknown做exact-revision census。Audit只产生Evidence和聚焦findings，不取得产品authority。

审计发现稳定缺口时，A0必须将其融合到canonical owner、roadmap或focused Issue/Work Package；不能让重大设计长期只存在于聊天或叙事报告。若当前active scope冲突，应建立ordered successor并保留失效/激活条件，而不是越权修改当前frozen candidate。

## Work Package

Manifest 冻结：

- base/default-ref constraints；
- authority reads/writes 与 owner；
- owned/permitted/forbidden paths；
- global exclusive resources和physical capabilities；
- dependencies、conflicts、ordered relations；
- acceptance、tests、profile和Evidence；
- completion、migration、readback和cleanup。

Pointer只保存manifest path、raw blob digest和选择模式。Pointer、branch、PR或candidate存在都不是执行/合并授权。

完整程序路线不写入一个Work Package。一个包只实现当前阶段中可独立验证、迁移和readback的纵向闭包，但不能降低canonical终态。

完成必须区分：design contract-frozen、implementation entered main、physical verification、package/deployment和product-supported。

Stacked successor可以基于当前exact candidate形成可审查tree，但在前序进入新main并readback前不得激活、复用Review/Evidence或宣称merge-ready。激活时必须从then-latest main重新冻结base、manifest、scope和Evidence。

## 并行工作

当前默认：一个 formal active Work Package。只读 research、census和Evidence发现可以并行，但不能同时写 canonical owner、`docs/work/**`、package/lock、workflow、Skill registry或同一 state/artifact。

目标并行 resolver只有机器证明以下全部成立后才允许同一 Integration Epoch 内多个正式包：

- authority write-set、canonical types和writer不重叠；
- owned/forbidden paths兼容；
- producer/consumer和migration顺序明确；
- state/artifact/global resource不冲突；
- package/lock、control plane、docs/work、AGENTS/Skill registry和workflow有唯一writer；
- 每包可独立验证、提交、回滚和失效；
- integration order和virtual-merge Evidence可确定重算。

关系只能是 `parallel-safe | ordered | write-conflict | resource-conflict | unresolved`；unknown/unresolved不解释为安全。

Branch是演进路线，不是等待机械合并的功能包。并行正式结果通过ordered successor或A0从latest main重建收敛，不能机械合并所有分支。

## Branch 与 PR 生命周期

- `feat/*`：正式产品能力；
- `fix/*`：正式缺陷修复；
- `refactor/*`：不改变外部语义的结构重构；
- `docs/*` / `chore/*`：文档和工程维护；
- `spike/*`：大型未知探索，默认不合并；
- `validation/*` / `diagnostic/*`：验证、故障隔离和Evidence，默认不合并；
- `integration/*`：仅在两条真实、大型、并行产品线需要临时总装时使用。

Squash merge后按最终tree、contracts和行为结果判断内容是否进入 `main`，不能仅用commit ancestry或ahead/behind判断遗漏。

Git branch承载代码演进；GitHub Actions的workflow_dispatch/matrix/job/artifact承载测试参数和Evidence。禁止长期创建一次性远端测试分支。

PR Ready只表示允许进入Review/Gate调度，不表示required Evidence已通过。Head/base/manifest/profile变化会使绑定旧identity的Review/Evidence失效。

## Impact 与验证选择

修改公共contract、canonical authority、state owner、pipeline、runtime boundary、Provider/Adapter、Implementation Resolution或未知影响前，先消费统一Impact和test/Gate selector；当前能力不足时降级到 exact imports、public API、runtime entry、owner、consumer、dependency closure和test-impact census。不得临时安装工具改变candidate环境。

开发中先运行当前 failing/focused sentinel；candidate稳定后运行由变化类型和Impact选择的local closure；Frozen后由A0触发required hosted Gate。不是每个Work Package固定全跑同一套重门禁。

相同未失效 Gate identity复用；输入和failure fingerprint未变时不重复确定性失败。无法证明不受影响不是“无需测试”。

## Failure、重试与 Proof Reset

Failure首先分类：root cause、owner、violated invariant、minimal reproduction、exact inputs、invalidated Evidence、cleanup state和unique next action。

环境瞬态只有在因果输入明确变化时受限重试。重复运行同一失败、扩大timeout、清缓存碰运气、删除断言或创建successor branch而不改变root input都不构成修复。

同一 Work Package重复出现同类 frozen invalidation时必须 proof reset：回到 reproduction、authority、state ownership、test architecture或scope重算。再犯同类根因时进入 redesign-required，而不是无限局部修补。

当重复问题跨Work Package出现时，必须检查共享对象、协议、Fixture、Runner、Skill、Provider boundary和CI是否缺少唯一owner或合同，并在roadmap对应上游阶段治理。

## 可验证续跑

上下文压缩、进程退出、会话/Agent/worktree切换后的目标是：只依赖外部权威状态，重新计算同一合法 next transition；不是恢复模型未外化的隐藏思维。

当前 Run Kernel未实现时：

- 每次恢复重新读取 main、PR/Issue、manifest、branch/worktree、dirty state、CI/Review和failure Evidence；
- 未提交/未外化的“已经做过”视为unknown；
- current operation、last completed transition、next action和stop condition写入受控外部记录；
- identity、instruction、authority或trust fence不一致时停止，不猜测继续；
- Skill正文按需加载，旧阶段正文不因已经读过而继续取得authority。

目标 Run Kernel只拥有run/capsule/event/transition和resume verification。Epoch/Failure、Verification Result、Evidence、Work Package和Integration各由自己的domain owner拥有，禁止建立第二状态机。

## Merge 与收口

变化只有同时满足以下条件才进入 `main`：

1. 仍是有效产品能力、修复或必要维护；
2. `main`尚未包含其有效结果，且未被更新实现取代；
3. canonical authority、public contract、migration和architecture一致；
4. exact base/head/tree/manifest/profile清楚；
5. required CI/Evidence/independent Review通过；
6. 无unresolved thread、有效REQUEST_CHANGES、probe、临时日志入口或artifact drift；
7. merge order、conflict和consumer切换已理解。

满足时及时合并，不为表现“仍在开发”继续修改正确candidate。大型实验历史优先squash经过验证的最终状态。

Merge后确认产品结果真实进入新 `main`；关闭 absorbed、superseded、mirror、probe和diagnostic PR/Issue；归档manifest；删除已完成使命且工具权限允许安全删除的branch/worktree/workflow；复核开放PR/Issue/CI，并从产品、架构和roadmap重新计算rolling plan。

工具不能物理删除或执行某项操作时必须准确说明边界，不能把“已审查、已关闭、内容已包含”表述成“分支已删除、操作已完成”。
