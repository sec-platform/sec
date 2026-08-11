---
title: 自主开发治理
status: stable
domain: development-governance
last-reviewed: 2026-08-11
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
- **当前T2候选冻结的目标合同**：VerificationSession、producer-owned Action、Review-Stable Barrier、MainHealth与单次IntegrationAuthorization；只有进入new main并由首个ordinary candidate canary通过后才是active capability。
- **更后继的目标架构**：Agent Operation Compiler、Integration Queue、统一Hermetic Runtime/resource scheduler、完整Evidence DAG/CAS和自动feedback service。

目标设计不能被文档、Issue、Skill prose 或模拟对象升格为当前能力。T2 new-main canary完成前，默认继续使用一个formal active Work Package和可验证的manual-shadow续跑；候选Session只能作为待验证SUT，不能授权自身。后继Integration Queue、统一runtime与自动feedback也分别以其真实consumer和new-main Evidence激活。

## 事实与授权顺序

```text
latest main + live Git/GitHub facts
→ docs/authority.json and canonical domain owners
→ product / system architecture / roadmap
→ AGENTS.md universal router
→ trusted repository orientation or full audit
→ selected frozen Work Package + trusted scope authorization
→ typed Operation / Task Envelope
→ candidate implementation + producer-owned Action plan
→ canonical parent dispatch-plan artifact + exact-ActionKey hosted producer
→ exact-head Review-Stable Barrier
→ hosted Evidence + fresh Review readback
→ single-use IntegrationAuthorization
→ trusted hosted integration critical section
→ expected-head merge → candidate-tree parity → idempotent remote closeout readback
→ new-main trust reload → replan
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
- **VerificationSession（T2 target owner）**：run、event、transition、resume和下一合法动作的唯一目标运行状态机；它只引用而不重定义Result、Evidence、Review、MainHealth、Work Package或Integration authority。普通resume只query、join或dispatch hosted transition，不持有physical merge/closeout capability。进入new main且ordinary canary通过前，真实下一动作仍从live Git/PR/manifest/Evidence重算。
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
→ zero or one applicable trusted Skill
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
- Role、operation kind、Skill applicability decision；
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

### Task Capsule

Task Capsule 由独立 `TaskCapsuleCompiler` 从 typed planning context、owner bindings、root
cause、scope proposal、Impact 与 Verification obligations 纯编译；相同输入必须得到 byte-identical
Capsule。Phase A Capsule 是 Operation 的不可变 **unbound planning content**，不是 current state、
Work Package 副本、聊天摘要、issuer receipt、effect grant 或 VerificationSession 子对象。

Task Capsule 唯一拥有其内容 schema、编译规则和 revision。Operation Envelope 与
VerificationSession 只能保存 `taskCapsuleRef`、`taskCapsuleDigest`、`taskCapsuleRevision`，并在
使用前验证引用；不得复制 Capsule 字段后形成第二 owner，也不得由 Session event 或 Skill prose
改写 Capsule。work selection、owner、scope 或 obligations 变化时重新编译 Capsule 并使引用旧
revision 的下游 decision stale。

当前 machine owner 是 `platform/shared/agent-task-capsule-contract.ts`；它纯编译
`sec-task-capsule-v1` 并拥有 operation role/kind vocabulary、严格 parser、canonical ordering、revision
与完整 digest。该 schema 强制 `authorityStatus=unbound-planning-content`、`effectAuthority=none`、
`scopeGrantId=null`；Work Package 只能以 `proposalRef/proposalDigest/projectionId` 进入 planning context，
禁止把 manifest、pointer、candidate tree、freeze/recovery journal 或普通 self-digest命名为 authorization、
activation receipt 或 ScopeGrant。Skill registry 只校验 Capsule 中的候选 guidance ID，不反向拥有
operation identity。

`scripts/codex/task-capsule.ts` 在 Phase A 只提供 content verification 与一个显式关闭的 production seam。
所有 public Task Capsule projection、Read Plan compile 与 Skill production selection 在真实 issuer接入前
统一返回 typed `trusted-activation-authority-unavailable`；不存在 candidate journal positive path、raw
Capsule/envelope、caller authority fields、测试 mint seam或兼容alias。freeze journal 只拥有 crash recovery、
CAS 与 consistency projection，绝不是 authority credential。只给 journal增加 issuer 字段、普通 digest、
本地文件或同用户 ACL 不构成修复：在没有进程隔离、受保护凭证库或签名信任根时仍可由candidate重算。

下一 #346 authority/canary slice 必须由独立 document-control/A0 owner签发 durable、issuer-bound 且绑定
exact repository、trusted base、candidate head/tree、manifest path/digest 与 control-byte digests 的 receipt。
Task Capsule adapter只能消费与live revalidate该receipt，不能签发或从candidate facts推断issuer；control
bytes必须先按 raw bytes 比较，再以 fatal UTF-8 解码后进入parser。直到该 owner 进入 new main，现行
A0/Work Package operation authorization仍是唯一 effect grant，unbound Capsule不得驱动production读取、
Skill、executor、Gate、Review或merge。Root-Cause Preflight、其他role、外部capability/resource/gate或
多任务orchestration在各自provenance producer接入前同样fail closed。

### Operation Read Plan（Issue #346）

独立 pure `OperationReadPlanCompiler` 消费 #205 的 exact content-addressed Task Capsule
并产出 `sec-operation-read-plan-v1`。Capsule 的同一个 digest 必须完整覆盖 role、operation
kind、goal、owner facts、scope、capability/resource/gate、Verification obligations、Skill candidates、
exact trusted base/head 与 Work Package proposal/projection；Read Plan 不接受这些字段的平行 caller claims，
也不重新定义 #205 的完整 Capsule schema或取得 Root-Cause Preflight owner。它不是模型缓存、prompt、
聊天摘要或新的状态机，而是一次 Operation 的最小读取闭包，至少拥有：

```text
requiredRefs
conditionalRefs
forbiddenSources
maxSkillBodies = 0 | 1
unresolvedFrontier
readReceipts
invalidationInputs
```

`requiredRefs` 的每项绑定 `ref + canonical owner + revision + reasonCode`。Agent 先消费这些引用，
不得为了“熟悉工程”默认读取 assistant memory、聊天历史、旧 PR/Issue comments、全部开放 Issue、
全仓文档或全部 Skill 正文。只有一个显式 `unresolvedFrontier` 尚未闭合时，才允许读取该 frontier
列出的 `conditionalRefs`；conditional ref 必须反向绑定同一 frontier，禁止 unrestricted search。

同一 source ref 在一个有效 operation context 中只能出现一次。`readReceipts` 绑定 planned ref ID、
canonical owner、exact revision、content digest 与 reason。它们只证明
读取了哪些 exact bytes，不证明内容正确，也不把外部 memory 提升为 authority。owner revision、
goal、scope、Skill candidate set、Verification obligations、Work Package 或 trusted main 任一变化，
对应 `invalidationInputs` 变化并使旧 Capsule/Read Plan/Skill decision stale。相同 path/blob 已有 fresh
receipt 时，执行器传递 ref、relevant symbols 和 delta 即可，不重复把全文塞入上下文。

机器入口是 `platform/shared/agent-operation-read-plan-contract.ts` 与
`scripts/codex/operation-read-plan.ts`。pure compile/verify 只证明 canonical bytes 与 digest 完整性，不把
caller 输入升级为 authority；production `compile` 只接受仅含 schema 的 authority-free closure request，
但在issuer receipt owner接入前必须返回上述typed blocked结果。caller不能提供Capsule、ref、owner、
revision、receipt、frontier、forbidden-source policy 或 invalidation，也不能通过直接调用Skill selector
绕过blocked seam。

未来 trusted adapter 只在issuer-bound Capsule之上从 trusted base blobs、exact receipt-bound manifest、
scope与mandatory deny baseline派生repository-only required refs；每个repository ref必须落入Capsule read
scope，external ref必须由exact authorized resource覆盖。Skill selector必须重新执行同一trusted observation
并要求整个Capsule与scope-bearing Read Plan closure byte-exact相等，才重算quarantine blob revisions。
raw envelope、caller-selected comparison pair、candidate-only manifest或candidate-self-issued authority入口
始终不存在。不得在读取Skill body后反推或改写Read Plan。缓存实现可以替换或完全不存在，正确性只依赖
issuer receipt、Capsule、plan、read receipt与invalidation contract。

Read Plan 同时绑定 `current-physical-state-authoritative-v1`：非 Agent-owned scope 中的明确
maintainer/user 改动是新的外部事件，旧 observation 立即 stale，当前物理状态成为 authoritative。
无冲突时接受当前状态；冲突时返回 typed `external-maintainer-mutation`。本层 pure resolver 只分类
`accept-current | conflict | recovery-authority-required | operation-owned-cas-eligible`，永远不签发 effect
authority。恢复旧状态只有三类独立 executor 可以在重新验证 principal、request/receipt provenance、
resource identity、preimage/current revision、expiry 与 CAS 后执行：用户明确请求恢复；回滚本 Agent
自身已证明的越权 mutation；operation-owned resource 的匹配 CAS。protected interactive root 始终在
candidate write authority 之外，裸枚举或 claim 不能授权恢复，也不能用 `git fsck`、dangling-object
forensic、checkout 或“上下文恢复”默认复活旧 index/tree。

### Skill Applicability（zero-or-one trusted guidance）

运行时 Skill 选择必须是 zero-or-one、trusted、operation-scoped（Issue #275）。
跨阶段工作通过 typed transition顺序推进：

```text
orient
→ audit | diagnose | design | implement | review | integrate | govern | no-change
```

每个 operation 由 `sec-skill-applicability-decision-v1`
（唯一代码 owner：`platform/shared/agent-skill-contract.ts`）裁决，状态：

```text
applicable | none-required | ambiguous | stale | conflict | not-applicable | unresolved
```

- `applicable`：加载唯一 trusted Skill；
- `none-required`：只在 Universal Policy + WorkPackage/Operation + issuer-bound Task Capsule 下执行，
  简单读取、格式修复或已明确 Operation 不得被迫加载 catch-all Skill；
- `ambiguous`：多个候选且无唯一 operation 证据，不得按文件顺序/ID/最新修改选取；
- `conflict`：Skill 要求超出授权 write/read path、resource、tool、Gate 或 authority，
  Skill 不得扩大交集；
- `stale`：goal、role、operation kind、WorkPackage proposal/receipt、Task Capsule、candidate 集合
  或 trusted revision 变化使旧 decision 失效；
- `not-applicable` / `unresolved`：operation 不进入 Skill 空间或输入不完整，停止写入。

Decision V1 至少绑定：trusted main/control revision、target candidate/workspace
reference、Role、operation kind、intent/goal digest、WorkPackage/Operation
proposal/receipt ref、Task Capsule ref、trusted registry 的 candidate Skill IDs、
selected Skill ID or null、trusted/candidate Skill blob revision、trigger evidence、
exclusion results、capability availability、authority/scope/resource conflicts、
reason codes 与 invalidation conditions。

path coverage（`resolveSecMarkdownSkillCoverage` / `resolveSecRepositoryHeuristicSkills`）
只作候选提示，不是 runtime selector。candidate 修改 `AGENTS.md`、`.agents/**`、
Skill registry、router 或 applicability 代码时，decision 与 Review 绑定 trusted
base/main 版本；candidate 内容只作为 SUT 差异，不得自授权。

Impact、Gate selection、Work Package parser、permission intersection、Failure/Epoch、
Evidence reuse和merge legality等机器规则不重复写入 Skill prose；Skill 正文文本永远
不能扩大 machine authorization。Skill 只保留需要 Agent 判断的：触发/不触发、输入、
分析方法、工具选择、解释、停止和 typed outcome。详细 schema、枚举、命令和平台矩阵
引用 canonical code或按需 reference，避免长流程连续加载重复正文污染 context。

当前可执行 Skill 集合为八个：七个终态 durable judgement owner，加上一个在 #205 pure
Task Capsule compiler 与 #346 issuer-bound consumer完成真实cutover前仍不可删除的 transitional owner：

```text
sec-repository-audit
sec-architecture-evolution
sec-worker-development
sec-exact-head-review
sec-failure-recovery
sec-external-capability-governance
sec-heuristic-governance
sec-task-delegation
```

其余 repository behavior 不得为“有 owner”而制造 Skill：orientation 与 Work Package lifecycle
由 document control plane 拥有，resume/A0 orchestration 由 VerificationSession 拥有，impact/Gate
selection 由 test-impact/Requirement selector 拥有，documentation 由 authority registry/docs-doctor
拥有，toolchain 由 runtime dependency
spec/manifest-lock 拥有，trust transition 由 TCB closure 拥有，CI/merge 由 Integration Transaction
拥有。delegation 当前仍由 `sec-task-delegation` 拥有不可纯计算的收益/隔离判断；只有 #205 的
Task Capsule compiler 与独立issuer成为真实production链、完成consumer cutover与canary后，才把该 route
迁移为 deterministic 并删除第八个 Skill。精确 route 与 canonical ref 只由
`SEC_REPOSITORY_BEHAVIOR_ROUTES` 维护；本段只定义边界。

retired Skill ID/file 不保留 alias、stub 或 prose compatibility。新增行为先判断 deterministic 或
heuristic：前者进入现有 machine owner，后者才允许在当前八个 owner 中扩展；只有触发、权限、停止和
判断闭包都无法归入现有 Skill 时才可提议新 ID，并同时声明 consumer、成本与退役条件。

### Deterministic services

以下能力必须由唯一代码 owner 提供：

- repository snapshot resolver；
- work selector；
- Task Capsule compiler；
- Work Package / Integration conflict resolver；
- Change Closure compiler；
- impact/test/Gate selector；
- permission evaluator；
- candidate epoch/failure classifier；
- Verification aggregator；
- Action/Evidence state 与 VerificationSession；
- NextTransition composition resolver；
- publication、merge、readback和cleanup owner。

产品Implementation Resolver、Block Resolver、Dependency materializer和Provider catalog分别由其canonical产品领域拥有；Development Skill或Agent不得在仓库开发流程中复制这些算法或用搜索结果/模型判断代替机器结果。

Skill可以消费和解释 service结果，但不能重新实现算法或输出竞争状态。

NextTransition composition resolver 只消费 owner 已形成的 WorkDecision、FailureDecision、
ImpactDecision、ActionState、SessionState、ReviewFreshness、ProviderAvailability 和
IntegrationState。它不能自行选择 work、分类 failure、扩缩 Impact、裁决 Review 或签发 merge
authorization；输入缺失或互相冲突时只能 `blocked`，不能猜测一个下一 phase。

### Development control-plane 七项终态裁决

成熟工程团队需要下表中的**能力**，不需要七套重叠的 bespoke workflow。SEC 的准入标准不是
“流程越多越专业”，而是每个持久 surface 都必须有不可由已有事实纯计算的真实状态、唯一 writer、
生产 consumer、crash/concurrency 语义、迁移与删除条件。只做导航、组合或投影的能力必须是 pure
compiler/resolver 或 derived view，不能升格为 state machine。

| Surface | 实际作用 | 终态 | 自动化边界 | 完成/退役条件 |
| --- | --- | --- | --- | --- |
| General Run Kernel proposal | 汇总 run/capsule/transition 的早期设计输入 | **retire**；不实现第 2 个 coordinator | useful contracts 分别进入 TaskCapsuleCompiler、VerificationSession、Action/Evidence、Integration owner；`NextTransitionCompiler` 只纯组合 typed decisions | 所有目标 consumer cut over，proposal/Skill/agent projection 的 Run Kernel authority 引用为零后归档 |
| `current-state.yaml` + active pointer + rolling plan | resolver 稳定配置、exact candidate selection、A0/人的近期投影 | **retain/adapt**；三个文件不是三个状态机 | parser/freeze owner 机器维护；candidate 为 `ProspectiveControlProjection`，live main 为 `ActiveMainControlState`，rolling plan 从选择结果派生 | candidate 投影失败不再污染 main；无 writer 会手工维护竞争 active truth；consumer contract 全部切换 |
| `VerificationSession` 大实现/大测试 | 唯一 run/event/transition/resume coordinator | **retain/split**；不重写、不另建 Session | public contract 不变，内部按 pure decision、provider observation、Git/closeout、crash/recovery、hosted partitions 拆分；fast selector永不选择 slow/hosted partition | 每个 partition 有独立 Action/consumer/test-impact，普通 focused edit 不再触发整文件分钟级测试 |
| `check:affected` / selector | 把 delta 映射到最小充分验证 | **evolve** 为 Requirement/subject closure | `Impact → tri-state Requirement → ActionKey → reuse/failure-reuse/join/execute/block`；unknown 保守扩大或 block | file-name fallback 只处理 unsupported closure；已知 unrelated/fresh Action 不再物理启动 |
| `check:full` | release/nightly、selector calibration、unknown-impact backstop | **retain as backstop**，从日常路径退役 | 不接 pre-commit/pre-push、普通 edit、finding loop；只由明确 profile/trigger 调度 | default local/PR fast path 无 consumer，仍有 release/nightly/calibration owner 和预算 |
| repository Skill corpus | 对需要 Agent 判断的触发、分析、工具选择和停止提供 guidance | **当前 8、终态 7**：delegation 在 #205 production compiler 切换前保留；deterministic behavior 为 zero-Skill | `SEC_REPOSITORY_BEHAVIOR_ROUTES` 显式区分 `skill` 与 `deterministic`；禁止 path catch-all 制造 guidance | 九个已退役 ID/file/consumer/alias 为零；#205 有真实 production consumer、canary 与 consumer-zero readback 后再退役 delegation；其余每个 Skill 有唯一非机器化判断 |
| v2/v3/v4… candidate worktrees/refs | 曾用于 finding 后重建 exact one-parent candidate | **retire** 为 transport residue | 一个 logical run 只保留一个 mutable worktree + 一个 active ref；finding 原地修复、materialize 新 generation、expected-old CAS；旧 generation 留 immutable object/artifact | `FindingSuccessorWorktreeCount = 0`，completed run 的临时 worktree/ref 经 exact inventory/readback 自动清理 |

实施不是“先补完七项，再开始真实开发”，也不是忽略七项继续堆功能。依赖顺序固定为：

```text
#205 Task Capsule compiler
→ #346 Operation Read Plan
→ #275 final delegation route migration + consumer-zero Skill retirement
→ candidate/control materializer and projection cutover
→ VerificationSession/test partitions + affected Requirement closure
→ consumer-zero retirement and residue cleanup
```

每一阶段必须直接减少当前物理放大，并由真实 consumer 接管后再删除旧 surface；禁止建立独立的
“最终架构包”挡在实现前。为防工程控制面吞噬产品开发，每完成一个非 P0/P1 的基础设施纵切片，
后续至少完成两个直接推进产品主脊的 Work Package，除非有新的机器证据证明该基础设施仍是 blocker。

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

Work Package planning 与 Verification freeze 是两个状态边界。首次 candidate publication、外部
Evidence 或 Review 之前，A0 必须能以 expected-old CAS 执行 `replan` 或 `abort`：撤销 prospective
pointer/rolling projection、使旧 ScopeGrant proposal失效并在同一 worktree/ref 重算 manifest；不得
为了补一个 owned path 建 v2/v3 successor worktree。只有已有外部 Evidence/Review/side effect 的
freeze 才是 terminal generation；此后语义或 scope 变化创建新 generation 并显式失效下游证明。
当前 control plane 未提供该 transition 时，失败属于其唯一 owner 的缺口，不能靠手改 digest、保留
平行 manifest 或无限 successor package 规避。

Pointer只保存manifest path、raw blob digest和选择模式。Pointer、branch、PR或candidate存在都不是执行/合并授权。Manifest也是scope proposal；只有trusted base/A0签发的ScopeGrant与trusted resolver为当前exact base/head/tree产生的CandidateScopeAttestation共同成立时，才允许冻结Session。候选修改manifest或write set不能给自己扩权。

授权与 candidate transport 分两层：`ScopeGrantId` 绑定 trust epoch、manifest semantic revision、
owned/forbidden paths、capability/resource bounds 与 base authority；trusted resolver 再为每个 exact
head/tree 签发 `CandidateScopeAttestation`，证明 changed paths 与 effects 仍是 ScopeGrant 的子集。
内容、scope 或 authority 未变而只是等价 Git commit 重新 materialize 时，ScopeGrant 保持稳定；
exact attestation、Review 与 Promotion 必须重绑新 head。

一个 logical run 默认只有一个 mutable implementation worktree和一个 active candidate PR ref。
Review finding 在同一 worktree 修复并 materialize 新 generation，以provider支持的expected-old CAS
更新同一 ref（remote non-fast-forward只有ruleset明确允许时才使用force-with-lease）；旧 generation 用
immutable object/ref/artifact 保存，不得建立 `v2/v3/...` successor
worktree。generation 数量只作诊断，不设 `<= 1` 假门禁；`FindingSuccessorWorktreeCount` 必须为零。
base/trust/scope 真正变化时进入 rebase/reconcile，而不是把 transport churn伪装成新 Work Package。
provider不支持同ref replacement时只能先以receipt supersede旧PR/ref，再创建一个新的唯一active ref；
不得同时保留多个active candidate refs，也不得用新worktree代替provider capability分类。

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

Issue completion intent 只能来自 machine-owned `IssueDisposition` 或 validated closeout receipt。
任意 PR title/body/comment 中的自然语言都不是 lifecycle state；PR renderer 必须拒绝 GitHub lexical
closing-keyword pattern，除非该 exact Issue 位于 fresh authorized completion set，并由 renderer生成
唯一允许的 closing clause。merge readback逐个比较授权集合与实际 Issue state；误关恢复只允许按
operation receipt 精确 reopen 被本次 merge 误关的 Issue，禁止文本批量 reopen/close。

worktree closeout 是 branch/ref closeout 的前置 physical Action，不以 `git worktree remove` exit code
为成功。terminal completion 同时要求 Git common-dir registry absence 与 exact physical target
absence；unregister 后目录残留进入 durable `residue`，只能从 target 外的 authorization receipt
重入。dirty/unknown/reparse/identity mismatch fail closed，后代 reparse 只 unlink entry 不遍历 target；
completed worktree receipt 之后 branch owner 才能继续 local/remote ref CAS。

`residue`、recovery ref 与 quarantine 都是事务中间态，不是长期归档。只有语义归属、target identity
或物理删除仍未确定时才允许保留；一旦 exact disposition 已确定，同一 closeout 必须清除 worktree、
branch/ref、recovery root、dependency link 和 residue，并读回 zero residue。宿主锁或权限使清除仍不
可能时，唯一合法终态是 typed blocked receipt，绑定 owner、exact target、reason、retained state 与
可重试条件。无 receipt 的目录、无限期 recovery ref 或 `v2/v3/...` quarantine 永远不算完成。

PR Ready只表示允许进入Review调度，不表示可以启动expensive hosted Gate或required Evidence已通过。Head/base/tree/manifest/authorized scope/profile/trust变化总会使绑定旧 exact subject 的Review、Session revision与merge authorization失效；Action/Evidence仅在其canonical subject closure、contract、environment或trust input变化时失效，trusted resolver必须为新 generation 重算reuse。即使head不变，Review policy、REQUEST_CHANGES或blocking thread变化也会使Review与merge authorization失效。

## Impact 与验证选择

修改公共contract、canonical authority、state owner、pipeline、runtime boundary、Provider/Adapter、Implementation Resolution或未知影响前，先消费统一Impact和test/Gate selector；当前能力不足时降级到 exact imports、public API、runtime entry、owner、consumer、dependency closure和test-impact census。不得临时安装工具改变candidate环境。

开发中先运行当前 failing/focused sentinel；candidate稳定后运行由变化类型和Impact选择的local closure；Frozen后由A0触发required hosted Gate。不是每个Work Package固定全跑同一套重门禁。

相同未失效 Gate identity复用；输入和failure fingerprint未变时不重复确定性失败。无法证明不受影响不是“无需测试”。

相对于当前受支持的 dependency/Impact model，系统必须执行最小充分 closure：known
not-applicable 全部跳过，fresh terminal PASS/FAIL 全部复用，authenticated in-flight 只 join，
unknown physical outcome block，只有 missing/stale Action 才允许 physical start。同一个
ActionKey 的 physical start 不得超过一次；Impact unresolved 时扩大 closure 或停止，不能假装
不适用。性能预算限制重复物理工作而不是合法 generation：

```text
MutableWorktreeAmplification = mutable worktrees / active logical runs = 1.0
ActiveRefAmplification = active candidate refs / active logical runs = 1.0
FindingSuccessorWorktreeCount = 0
physicalStartsPerActionKey <= 1
```

## Failure、重试与 Proof Reset

Failure首先分类：root cause、owner、violated invariant、minimal reproduction、exact inputs、invalidated Evidence、cleanup state和unique next action。

环境瞬态只有在因果输入明确变化时受限重试。重复运行同一失败、扩大timeout、清缓存碰运气、删除断言或创建successor branch而不改变root input都不构成修复。

同一 Work Package重复出现同类 frozen invalidation时必须 proof reset：回到 reproduction、authority、state ownership、test architecture或scope重算。再犯同类根因时进入 redesign-required，而不是无限局部修补。

当重复问题跨Work Package出现时，必须检查共享对象、协议、Fixture、Runner、Skill、Provider boundary和CI是否缺少唯一owner或合同，并在roadmap对应上游阶段治理。

## 可验证续跑

上下文压缩、进程退出、会话/Agent/worktree切换后的目标是：只依赖外部权威状态，重新计算同一合法 next transition；不是恢复模型未外化的隐藏思维。

VerificationSession尚未由new-main canary激活，或不能完整投影某一外部事实时：

- 每次恢复重新读取 main、PR/Issue、manifest、branch/worktree、dirty state、CI/Review和failure Evidence；
- 未提交/未外化的“已经做过”视为unknown；
- current operation、last completed transition、next action和stop condition写入受控外部记录；
- identity、instruction、authority或trust fence不一致时停止，不猜测继续；
- Skill正文按需加载，旧阶段正文不因已经读过而继续取得authority。

VerificationSession的目标所有权只包括run/session identity、event、transition、owner decisions 的
typed references 与 resume verification。它只引用 `taskCapsuleRef/digest/revision`；它不拥有 Task Capsule 内容或 compiler。
Epoch/Failure、Verification Result、Action/Evidence、Review、MainHealth、
Work Package和Integration各由自己的domain owner拥有，禁止建立第二状态机或 general Run
Kernel。字段、有效性与授权语义只引用verification authority；本文件只规定操作顺序。

## Merge 与收口

变化只有同时满足以下条件才进入 `main`：

1. 仍是有效产品能力、修复或必要维护；
2. `main`尚未包含其有效结果，且未被更新实现取代；
3. canonical authority、public contract、migration和architecture一致；
4. exact base/head/tree/manifest/profile清楚；
5. independent exact-head Review-Stable Barrier在expensive Gate前通过，required CI/Evidence完成后又得到fresh readback；
6. 无unresolved blocking thread、有效REQUEST_CHANGES、probe、临时日志入口或artifact drift；
7. exact MainHealth、ruleset/trust revision、merge order、conflict和consumer切换已理解；
8. 唯一physical executor是在repository/default-branch全局临界区内完成fresh authorization、expected-head merge、tree parity与closeout readback的trusted hosted operation；不存在本地JSON消费、`--admin`或raw merge旁路。

满足时及时合并，不为表现“仍在开发”继续修改正确candidate。大型实验历史优先squash经过验证的最终状态。

Merge后先证明merged tree等于verified candidate tree；信任根变化时从new main重载TCB并使旧Session/Review/Evidence/authorization失效。随后以stable operation id幂等关闭 absorbed、superseded、mirror、probe和diagnostic PR/Issue，归档manifest，删除已完成使命且工具权限允许安全删除的branch/worktree/workflow；复核开放PR/Issue/CI，并从产品、架构和roadmap重新计算rolling plan。

工具不能物理删除或执行某项操作时必须准确说明边界，不能把“已审查、已关闭、内容已包含”表述成“分支已删除、操作已完成”。
