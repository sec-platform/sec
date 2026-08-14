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

## 发现收敛、current spec 与 WorkDecision

一次执行中发现的问题只有在进入既有canonical owner或一个聚焦work identity后才是durable work；
聊天、模型记忆、审计叙事和rolling文字都不能成为唯一副本。统一收敛链是：

```text
observation / accepted decision
→ existing work identity + owner + current-spec census
→ normalize into the existing Issue or stronger machine owner
→ trusted bounded candidate facts
→ WorkDecision
→ rolling projection
→ frozen Work Package
```

命中已有focused/Program Issue、roadmap capability或canonical domain owner时，更新或引用该identity，
不得因执行会话、分支或解决方案变化复制一个新Issue/计划。只有没有现存identity、唯一owner与独立
acceptance闭包同时成立时，才建立新的focused work。Issue comment、Review和聊天是讨论/Evidence；
其中被接受的执行裁决必须由maintainer action折叠进Issue body或更强machine contract并标出superseded
source，executor不按comment recency、最后时间或AI摘要重建current spec。

#221 `WorkDecision`只消费trusted current lifecycle、canonical roadmap revision、maintainer/project
adopted normalized candidate records以及dependency/conflict/readiness facts，不读取Issue title/body/comment、
模型评分或wall-clock。每个候选必须同时绑定canonical `currentSpecRef`与exact immutable
`currentSpecRevision`；二者进入candidate-set、input与decision identity，并显式投影到selection、rejection
witness和precondition。future live adapter只能从maintainer-adopted owner派生这组绑定，current spec任一变化
都会使旧decision失效，不能按comment时间、caller claim或模型摘要合成revision。裁决优先级固定为：

```text
active incomplete → continue-active
closeout obligation → closeout
control conflict → reconcile
eligible candidates → select-next
no necessary work → none
missing or conflicting facts → unresolved
irreversible product/legal/security/cost choice → human-escalation
```

Eligibility要求目标仍有效、唯一owner与exit criteria存在、prerequisite/order facts满足、#207冲突
已决、required Evidence真实且scope可闭合。排序只使用`integrity-critical → active-critical-path →
product-critical-path → near-term-acceleration → maintenance-required → defer`，同类再按blocked ready
successors、当前roadmap直接性、Evidence freshness、scope closure与stable work identity裁决。P0/P1标签、
“未来可能有用”和自然语言紧急程度都不能自授权。相同normalized input必须产生byte-stable input digest、
reason codes、preconditions与rejection witnesses。

`blocked ready successor`不是transitive descendant数量。它只计数引用当前候选为一个未满足直接依赖、
并且在仅把该依赖假设为`satisfied`后由Phase A完整eligibility evaluator判为`eligible`的后继。因此deferred、
already-in-main/superseded、仍有第二个未满足依赖、scope/Evidence/owner不闭合或其他原因不可选的后继均不
计数；compiler不得用图可达数量、候选总数或另一套简化readiness规则替代这个定义。

实现分层保持有限：Phase A是`platform/shared/work-selection-contract.ts`的pure read-only compiler；
Phase B adapter只从repository orientation、Work Package registry、closeout与conflict owner收集结构化
facts并签发receipt；Phase C writer只把validated decision物化为一个当前包加二至五候选。人工projection
在Phase C切换前必须明确是A0 reconciliation；与machine decision冲突时返回`reconcile`，不静默覆盖。
#349 `ExecutionWave`随后只编译selected work refs的order/conflict/resource/cost，不能复制selector、
Issue prose、权限、Task Capsule或Verification。bounded automated action只有在下游authorization、Journal、
rollback和真实consumer成立后才能激活；pure decision本身永远没有branch/PR/merge/write authority。

Phase B/C的project-owned normalized records只存在于`docs/roadmap.md`的strict
`sec-roadmap-work-catalog-v1` block；这是roadmap自身的bounded current-stage machine projection，不能
扩展成第二文件、第二backlog或全Issue镜像。block只保存package/work/tracking/current-spec/owner、静态
priority class、dependency和exit-criteria refs。GitHub Provider只批量观察catalog中已列出的Issue
resource identity、open/closed和body bytes；body bytes只形成raw current-spec digest，title/body/comment
内容不被解析、复制或当作instruction。GitHub Projects不是必需authority；将来接入也只能替换事实
adapter，不能拥有selection或绕过canonical roadmap。

Catalog JSON边界使用duplicate-aware、bounded、depth-limited parser；任何object层级的重复decoded key都
必须拒绝，不能先经过`JSON.parse`的last-key-wins语义再做schema校验。Phase B不自造`healthy`、`none`或
`consistent`：MainHealth必须由exact-main check observation经canonical MainHealth ledger和fresh lane
resolver产生；candidate/PR/ref/worktree与closeout必须由#313 branch-lifecycle owner的bounded projection
产生；该projection只排除canonical default branch，任何其他命名空间的ref或非默认worktree都属于
必须解释的transport/residue，不能因不使用`codex/*`前缀而漏检。pointer、rolling与active manifest必须
由document-control binding owner逐项核对。任一owner输入
缺失、过期、locked、身份不符或无法解析时只能`unresolved`。
OPEN PR只有在`baseRefName`等于canonical default branch、`baseRefOid`等于exact live main，且head
branch/SHA与live remote ref及可选worktree一致时才是legal active transport；仅SHA偶然相同不能让指向
其他base branch的PR取得active或closeout authority。
跨owner consumer edge由被消费的canonical producer owner登记到test-impact：MainHealth contract或
default-branch health producer变化时，除自身focused tests外必须直接选择Work Selection consumer test。
consumer不得复制MainHealth语义来获得自己的测试闭包，direct-import自动发现也不能代替这条传递边。

Live receipt同时绑定exact live-default commit/tree、roadmap raw digest、catalog digest、#311 registry
stable projection、current lifecycle digest、每个current-spec observation、Phase A input和decision。它是
可重放Evidence而非signature：caller提供的receipt文件永远不能单独授权pointer/rolling写入。新package
freeze必须在trusted `document-control-plane`进程内对exact base重新运行live adapter，并要求manifest
`id + tracking`与`select-next`逐项相同；任一Provider/registry/lifecycle/schema/current-spec缺失、malformed、
stale或冲突均返回typed `unresolved`。同manifest finding replan不改变selection，继续走零Provider的
pure fast path，但fast path身份是exact `(package id, tracking)` tuple：同id改变tracking必须在任何
repository object/index/journal/control effect前拒绝，不能把tracking替换伪装成同包replan。

Effectful `freeze`的控制代码必须来自clean protected `main`，其HEAD等于canonical local-default投影；
候选只能作为显式`--workspace`目标，且必须是物理不同的`codex/*` worktree。live adapter从唯一remote
HEAD symbolic projection定位default ref，再读取exact-main current-state；不得先读取候选HEAD来决定
repository/remote/default branch。required projection规则由pure freeze contract再次强制，CLI wiring不是
唯一门禁。roadmap catalog不保存可从依赖图推导的successor count或`roadmapDirect` bit：两者由compiler
计算，避免人工derived-state漂移。
Phase B只在current lifecycle证明没有active candidate、closeout residue、control conflict或unhealthy main时，
把候选的#207 pairwise conflict投影为`clear`：此时不存在第二个并行subject。只要存在并行subject或其
身份不完整，selector先返回`continue-active | closeout | reconcile | unresolved`，不得硬编码clear；真正
多work的order/path/resource编译仍归#207/#349，不复制进selector。

MainHealth recovery不是Work Selection的候选特例，也不允许形成`repair → 全Issue census → reconcile`
的循环依赖。一个fresh exact-main ledger必须先由MainHealth owner投影成互斥的
`ordinary-only | repair-only | locked`：只有`ordinary-only`调用WorkDecision；`repair-only`只调用pure
`MainHealthRepairDecision`；`locked`不调用任何选择器。这样普通catalog与稀有恢复路径共享同一上游真值，
但彼此不串联、不重复远端观察。repair decision完整绑定repository/default/main/tree/trust、ledger、owner、
failure fingerprints与manifest identity，只提供routing eligibility，不提供scope、implementation、provider、
Review或merge authority。

依赖exact repository状态的合同测试只校验编译后选择的通用不变量，不把当前Issue或package identity写成
永久期望；需要验证特定Issue依赖关系时，必须使用完整、冻结的synthetic catalog与completion registry。这样一个Work
Package进入main只改变输入事实，不会要求手工改写下一项选择。pointer、rolling projection、manifest digest、
TCB与其他内容身份均由其唯一compiler生成，文档只维护语义源，zero-write check负责拒绝派生值漂移。

每个future degraded generation的repair manifest locator由
`(repository, default branch, exact main, exact tree, owner, sorted failure fingerprints)`内容寻址派生，并把
完整digest保留在path；已进入default的path永不复活，finding只在同一manifest/worktree/ref内产生新head。
健康或locked ledger不暴露repair locator。Repair effect admission必须同时读取current pointer manifest的
candidate bytes和exact default bytes：只有两者raw-byte相等且digest等于pointer时，旧active才被证明已经
published并从临时repair rolling topology退休；其余未完成candidates保持原bytes与原顺序。default缺失、bytes
不等、stale、unresolved或仍超出五候选上限都fail closed，禁止截断、发明或重排身份。

已具备production repair consumer但尚不能从容量中退休published active的trusted-main generation，只允许一个由
exact repair manifest绑定、用户显式授权并经独立Review/new-main readback约束的最后manual-bootstrap bridge。
该package不跟踪Issue、不伪造ordinary WorkDecision或activation receipt，并必须删除这项capacity defect；规则
进入new main后不得再保留caller JSON、手工pointer staging或第二repair package入口。#177继续只拥有failure
classification；MainHealth routing与document-control effect owner不迁入#177。

同一exact main可以由policy列出的不同GitHub event各产生一次MainHealth check。event name本身不证明
`repository_dispatch`的action身份；provider adapter必须同时观察workflow run ID与display title，MainHealth
policy再按exact main和request-operation identity验证event-specific run title。activation、verification-action及
其他dispatch中同名但skipped的job属于nonmatching provider noise，不能参与ledger或污染source digest。
MainHealth owner先按
MainHealth policy拥有封闭的recognized conclusion集合，并按`(terminal status, conclusion)`归一语义outcome：
每个allowed event至多一个producer且全部recognized terminal outcome
相同时才收敛；一致成功进入healthy，一致非成功进入degraded。same-event重复、nonterminal或不同conclusion
以及unknown status/conclusion一律locked。failure fingerprint只绑定policy/context/head与归一outcome，不绑定provider check id或event，
因此等价的第二producer到达不会制造新的repair identity。provider adapter先完成bounded pagination与shape
admission；MainHealth producer source digest只绑定policy与排序后的matching normalized subset，不匹配的其他
check不是decision input且不得仅凭噪声改变ledger provenance。raw response审计属于独立provider observation
receipt owner，不能由MainHealth decision自行发明或用不完整bytes冒充。

```mermaid
stateDiagram-v2
  [*] --> ObserveMain: one exact check-runs observation
  ObserveMain --> OrdinaryOnly: healthy and fresh
  ObserveMain --> RepairOnly: degraded and fresh
  ObserveMain --> Locked: missing ambiguous stale or drifted
  OrdinaryOnly --> WorkDecision: bounded roadmap and Issue facts
  RepairOnly --> RepairDecision: exact failure-generation locator
  RepairDecision --> Freeze: no active package and exact manifest binding
  WorkDecision --> Freeze: exact select-next binding
  Locked --> Stop
  Freeze --> Review
  Review --> NewMainReadback
  NewMainReadback --> OrdinaryOnly: repaired MainHealth
```

```mermaid
stateDiagram-v2
  [*] --> Observe: exact main and bounded owner facts
  Observe --> Unresolved: missing malformed stale or conflict
  Observe --> Decide: normalized catalog and current spec digests
  Decide --> Continue: active candidate incomplete
  Decide --> Closeout: lifecycle residue exists
  Decide --> Reconcile: control or main conflict
  Decide --> Selected: select-next and exact package tracking match
  Selected --> Projected: render one active plus two to five candidates
  Projected --> Frozen: document-control single writer publication
  Frozen --> Reviewed: exact-head independent static Review
  Reviewed --> Main: authorized integration and exact readback
  Main --> Observe: keep selected manifest until next decision consumes it
  Unresolved --> [*]
  Continue --> [*]
  Closeout --> [*]
  Reconcile --> [*]
```

Catalog采用一项延迟删除handoff：本轮选中的manifest进入main后仍存在，下一次adapter把该项投影为
`already-in-main`并用它满足直接后继；下一纵切片才删除该旧manifest和已消费catalog item，同时把近端
窗口补足到能继续生成二至五候选。这样不保留tombstone/history文件，也不会因manifest先删除而把已完成
前置重新解释为未完成。catalog最多保存七条近端记录，live adapter只做一次bounded Issue GraphQL和
既有owner投影，不扫描Issue历史、comment或全backlog。

非catalog recovery package临时插入时也不能破坏该完成事实。`docs:doctor`与`repository-audit`消费同一个
pure package-census contract；各自从同一个immutable candidate tree读取pointer、manifest、roadmap与
package census，不能复制第二套“仅一个manifest”算法。exact tree blob与directory membership必须复用
同一个已reviewed、只读、参数受限的Git object observer；目录枚举不得为了便利另开process dispatcher或
由candidate扩写TCB allowlist。只有selected manifest的tracking为`none`时，才可
额外保留至多一个被canonical roadmap引用、在exact default ref存在且candidate/default bytes完全相同的
published predecessor。第二个匹配项、非catalog文件、byte drift或普通tracked package下的额外manifest
全部fail closed。下一ordinary slice必须同时删除recovery manifest、已消费predecessor及对应catalog item；
Git历史承担审计，不把旧manifest复制到`docs/evidence/**`或另建tombstone。

首次Phase C迁移是唯一bootstrap例外：旧rolling只含两个候选，而旧promotion要求提升后仍至少两个，
因此不存在可执行的旧transition。本迁移在一个exact candidate中同时安装catalog、adapter、consumer与
新projection并接受trust/control Review；进入main后不存在手工topology兼容入口。以后耗尽、补充、增删、
排序或selected identity变化必须由live WorkDecision产生，否则freeze在任何repository object/index/
journal/control effect前拒绝。

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

这一authority level也约束diagnostic与negative contract test：issuer-bound receipt尚未成立时只能使用
`proposal / proposed / unbound`词汇，不得在错误断言、fixture或测试名称中把相同scope/resource提升为
`trusted / authorized / granted`。只有真实typed authority transition才允许两侧在同一tree原子迁移术语。

`scripts/codex/agent-operation-activation.ts` 是document-control/A0 hosted issuer adapter；
`platform/shared/agent-operation-activation-contract.ts`唯一拥有严格request/provider/PRE/FINAL/publication schema。
本地实现会话只能发送at-least-once wake-up，不能签发credential。协议保持两阶段：

```text
manifest-only draft PR + maintainer repository_dispatch wake-up
→ trusted default-branch workflow rederives live main / PR / manifest / WorkDecision / scope
→ immutable PRE artifact + GitHub Actions App comment locator
→ implementation commits on the same PR / branch / worktree
→ live continue-active WorkDecision
→ immutable FINAL artifact + GitHub Actions App comment locator
→ Task Capsule / Read Plan / Skill rederive provider and whole values
```

PRE必须来自default branch上的固定workflow SHA，只接受同一仓库具备admin/maintain权限且actor、triggering actor、
event sender一致的请求；它绑定exact repository/base/tree、一个draft PR及linear proposal head、manifest raw digest、
三个control raw-byte digest、proposal whole delta、manifest全部owned/forbidden scope、current spec、WorkDecision与
worker/implement/git-only vocabulary。trusted checkout独占只读remote credential以完成WorkDecision的remote-ref与
check-runs闭包，candidate checkout永不持有credential；依赖从frozen lock与Bun cache安装并禁用lifecycle scripts，
避免issuer observation触发hook或其他安装副作用。FINAL引用同一PRE comment ID，要求同一PR/base/branch/manifest、PRE head为
final head祖先、final whole delta仍在PRE scope内，并绑定新的live `continue-active` WorkDecision。PRE的active/candidate
rolling topology必须由Work Selection唯一的topology compiler重派生；它在PR创建前后的`select-next`与
`continue-active`对同一active work保持相同有序拓扑。FINAL receipt再次携带三个control digest并与PRE逐值相等，
因此已授权control路径也不能在PRE后改变选择或projection bytes。

canonical PRE/FINAL payload只保存在该trusted run的immutable Actions artifact；GitHub Actions App comment只保存
request、artifact ID/name/file/archive digest与provider locator。consumer必须同时read back App identity、repository、
workflow path/SHA、run/attempt、event、job、upload/publication steps、triggering maintainer permission、artifact metadata/
bytes以及PR/WorkDecision/manifest/scope。repository_dispatch本身只是wake-up；candidate workflow、本地Git ref、
本地blob/file、journal、普通digest、同用户ACL或caller JSON均可由实现者重算，永远不是credential。provider、
artifact、bytes、identity、current-spec或scope任一漂移都以bounded reasonCode与raw detail digest fail closed。
凡通过Issues timeline endpoint向Pull Request发布GitHub Actions App locator或Review控制marker的trusted job，必须
同时显式声明`issues: write`与`pull-requests: write`；仓库默认只读权限、其中任一单独权限或ambient runner配置都
不能代替这对effect capability。workflow contract必须结构化锁定所有真实publication consumers，防止artifact已
持久化但locator以`Resource not accessible by integration`失败的半发布状态再次进入main。
同一canonical request digest拥有唯一hosted concurrency group；重复wake-up在重验既有App locator、artifact与
provider后返回`existing`，不产生第二artifact/comment。只有GitHub Actions App发布的canonical marker进入协议，
普通用户或其他actor的同名marker作为非authority噪声忽略；App marker malformed或同一request出现多个App locator
才是provider conflict。App comment成功写入就是publication effect的authenticated terminal observation，consumer要求
upload step已成功且publication step存在，但不把该step随后是否以success结束当作第二份credential；因此comment写入后
进程崩溃或runner失联不会永久毒化已完整发布的artifact。并发或历史duplicate identity一律冲突停止，不能
last-writer-wins。

Provider格式只在workflow adapter边界归一化一次：`upload-artifact`输出的裸SHA-256 hex转成REST metadata使用的
`sha256:<hex>`，内部schema、comment locator、archive byte readback只接受后一种canonical表示；禁止在consumer里
同时容忍两种格式。artifact metadata还必须把workflow run的repository与head repository ID都绑定到同一repository ID。

```mermaid
stateDiagram-v2
  [*] --> Proposal: manifest-only draft PR
  Proposal --> Blocked: live main / actor / PR / WorkDecision / scope conflict
  Proposal --> Prepared: hosted PRE artifact + App locator
  Prepared --> Implementing: same PR branch and Work Package scope
  Implementing --> Finalized: hosted FINAL artifact + continue-active
  Finalized --> Consumed: App + artifact + provider + whole values rederived
  Consumed --> Stale: main / spec / PR / artifact / provider / scope drift
  Stale --> Proposal
  Blocked --> [*]
```

这是一个有限activation协议，不是新的run coordinator；candidate generation、VerificationSession、Review、
merge、Issue disposition与retirement仍分别由既有owner拥有。

本地public command surface只有两个意图：`request --phase prepare|finalize --candidate-root <path>`从live
WorkDecision、PR registry、candidate control和App publication inventory自动派生所有identity；FINAL从同一PR/base/
manifest且head为当前head祖先的validated PRE世代中选择唯一maximal祖先自动取得comment ID：线性finding修复自然淘汰
较旧PRE，零个为absent，并行或不可比较的多个maximal PRE才是conflict；
`observe --candidate-root <path> --request-id <digest>`只join/read back hosted publication。caller不手填base、head、
manifest、scope、provider或receipt字段，也没有publish/ref-write命令；`produce-hosted`与`publish-hosted`只供固定
default-branch workflow调用。

activation producer和最终`skill-applicability` consumer必须同时是
`platform/shared/ci-trust-root-registry.json`的runtime entrypoint；TCB contract强制producer、Task Capsule、
Read Plan、Skill与Work Selection整条closure存在，generated lock只从该registry与真实imports推导。不得
只把新issuer文件加入manifest或Review范围，却让可执行authority chain落在TCB之外。

registry→generated-lock迁移和production trust-root加载顺序只由`docs/verification-governance.md`拥有；
activation切片不得另造bootstrap规则或绕开其strict next-closure admission。

workflow必须先用GitHub live readback完成actor、default branch、exact draft PR、linear ancestry与manifest bytes
admission，再由trusted-main producer读取candidate SUT；payload upload在comment publication之前，comment不能内嵌
或替代payload。实现前consumer从manifest-only exact head和唯一open PR枚举PRE locator并重派生完整PRE，随后才编译
planning Capsule、Read Plan与Skill decision；实现后同一consumer优先枚举FINAL locator，反向验证PRE locator/artifact，
并在exact final head重新观察WorkDecision、PR registry、head/tree/ancestry/manifest/control/owner closure/scope与provider。
producer没有injectable authority evaluator seam，本地路径已无ref/file credential兼容入口。当前exact head既无有效PRE
也无有效FINAL时，public consumer保留`activation-receipt-absent | activation-stale | activation-scope-conflict |
activation-issuer-unavailable | activation-provider-unavailable | activation-provider-readback-conflict`之一及detail digest。

WorkDecision的MainHealth binding必须使用MainHealth owner的稳定`healthRevision`，不能使用包含
`observedAt/expiresAt/provider receipt`的`ledgerDigest`；后者会让相同健康事实的live replay自行失效。状态、
failure fingerprint、owner、lane或main identity变化仍会改变`healthRevision`并使完整WorkDecision及FINAL
receipt失效，纯观察时间变化则不会。consumer因此仍可整值比较完整receipt/decision digest，无需另造弱语义投影。

该receipt只是activation provenance，不是effect grant。Task Capsule继续强制
`authorityStatus=unbound-planning-content`、`effectAuthority=none`、`scopeGrantId=null`；现行A0/Work Package
operation authorization仍是唯一effect grant。V1刻意只开放`worker/implement`且capability只投影实际使用的
local `git`；其他role、Root-Cause Preflight、外部resource/gate或多任务orchestration在各自provenance owner
接入前保持fail closed，不以硬编码“available”扩大能力。

issuer所在实现PR只能发布 progress：producer尚未进入trusted main时不能给自身candidate签发有效receipt。
进入new main后，#275必须成为第一个真实PRE→FINAL candidate canary；#346保持开放，直到至少三个不同真实operation
证明read/tool-call下降且不遗漏owner/contract facts，并包含一次真实maintainer/user mutation observation。不得
伪造mutation、用本实现候选冒充canary或因production cutover合并就提前关闭Issue。

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
caller 输入升级为 authority；production `compile` 只接受仅含 schema 的 authority-free closure request；
manifest-only proposal head必须消费有效PRE，exact implementation head必须消费有效FINAL，二者都由同一adapter
整值重派生，否则返回上述typed blocked结果。caller不能提供Capsule、ref、owner、
revision、receipt、frontier、forbidden-source policy 或 invalidation，也不能通过直接调用Skill selector
绕过blocked seam。

trusted adapter在PRE-bound planning Capsule与FINAL-bound reconciliation Capsule上都解析trusted-base
`docs/authority.json`。frozen Work Package的
`authorityRefs`把非文档source scope显式映射到canonical domain owner；每个changed registered document再加入
自身owning record，navigation/agent/control projection则加入registry声明的projection target。未知、非owning、
inactive、重复、未排序或缺少`development-governance`均fail closed。由此得到AGENTS、registry、manifest和最小
domain owner closure，不扫描全部文档，也不把candidate prose变成owner identity。changed owner blob以exact
candidate revision作为SUT，未变owner来自trusted base；scope authorization仍只来自此前hosted PRE。
每个repository ref必须落入Capsule read scope，external ref必须由exact authorized resource覆盖。Skill selector必须重新执行同一trusted observation
并要求整个Capsule与scope-bearing Read Plan closure byte-exact相等，才重算quarantine blob revisions。
raw envelope、caller-selected comparison pair、candidate-only manifest或candidate-self-issued authority入口
始终不存在。不得在读取Skill body后反推或改写Read Plan。缓存实现可以替换或完全不存在，正确性只依赖
issuer receipt、Capsule、plan、read receipt与invalidation contract。

production closure读取上述registry-derived owner refs与candidate-head exact manifest；每个ref形成OID revision与
raw content digest，Task Capsule owner facts和Read Plan receipt共同绑定同一closure。activation receipt digest和current-spec revision进入
额外invalidation keys。rolling plan的测试只比较parser得到的active/candidate topology与roadmap catalog的
有序package projection；不得硬编码历史Issue marker或手工把旧`#221/#352` prose补回机器渲染结果。

candidate-head manifest只允许由activation adapter物理读取一次：同一次`readGitBlob`必须同时产出blob OID与
raw-byte digest，并把二者经trusted Task Capsule observation传给Read Plan。下游不得再对同一
`targetCandidate:manifestPath`执行`rev-parse`、`cat-file -t`或`cat-file blob`；receipt直接复用已认证的
OID/digest。candidate head、pointer、manifest bytes或issuer binding任一漂移仍使整个observation失效，
read-once不允许用path cache或caller字段降低fail-closed边界。

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

| Surface                                              | 实际作用                                                       | 终态                                                                                                        | 自动化边界                                                                                                                                                                | 完成/退役条件                                                                                                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General Run Kernel proposal                          | 汇总 run/capsule/transition 的早期设计输入                     | **retire**；不实现第 2 个 coordinator                                                                       | useful contracts 分别进入 TaskCapsuleCompiler、VerificationSession、Action/Evidence、Integration owner；`NextTransitionCompiler` 只纯组合 typed decisions                 | 所有目标 consumer cut over，proposal/Skill/agent projection 的 Run Kernel authority 引用为零后归档                                                               |
| `current-state.yaml` + active pointer + rolling plan | resolver 稳定配置、exact candidate selection、A0/人的近期投影  | **retain/adapt**；三个文件不是三个状态机                                                                    | parser/freeze owner 机器维护；candidate 为 `ProspectiveControlProjection`，live main 为 `ActiveMainControlState`，rolling plan 从选择结果派生                             | candidate 投影失败不再污染 main；无 writer 会手工维护竞争 active truth；consumer contract 全部切换                                                               |
| `VerificationSession` 大实现/大测试                  | 唯一 run/event/transition/resume coordinator                   | **retain/split**；不重写、不另建 Session                                                                    | public contract 不变，内部按 pure decision、provider observation、Git/closeout、crash/recovery、hosted partitions 拆分；fast selector永不选择 slow/hosted partition       | 每个 partition 有独立 Action/consumer/test-impact，普通 focused edit 不再触发整文件分钟级测试                                                                    |
| `check:affected` / selector                          | 把 delta 映射到最小充分验证                                    | **evolve** 为 Requirement/subject closure                                                                   | `Impact → tri-state Requirement → ActionKey → reuse/failure-reuse/join/execute/block`；unknown 保守扩大或 block                                                           | file-name fallback 只处理 unsupported closure；已知 unrelated/fresh Action 不再物理启动                                                                          |
| `check:full`                                         | release/nightly、selector calibration、unknown-impact backstop | **retain as backstop**，从日常路径退役                                                                      | 不接 pre-commit/pre-push、普通 edit、finding loop；只由明确 profile/trigger 调度                                                                                          | default local/PR fast path 无 consumer，仍有 release/nightly/calibration owner 和预算                                                                            |
| repository Skill corpus                              | 对需要 Agent 判断的触发、分析、工具选择和停止提供 guidance     | **当前 8、终态 7**：delegation 在 #205 production compiler 切换前保留；deterministic behavior 为 zero-Skill | `SEC_REPOSITORY_BEHAVIOR_ROUTES` 显式区分 `skill` 与 `deterministic`；禁止 path catch-all 制造 guidance                                                                   | 九个已退役 ID/file/consumer/alias 为零；#205 有真实 production consumer、canary 与 consumer-zero readback 后再退役 delegation；其余每个 Skill 有唯一非机器化判断 |
| v2/v3/v4… candidate worktrees/refs                   | 曾用于 finding 后重建 exact one-parent candidate               | **retire** 为 transport residue                                                                             | 一个 logical run 只保留一个 mutable worktree + 一个 active ref；finding 原地修复、materialize 新 generation、expected-old CAS；旧 generation 留 immutable object/artifact | `FindingSuccessorWorktreeCount = 0`，completed run 的临时 worktree/ref 经 exact inventory/readback 自动清理                                                      |

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

## Canonical development lifecycle projection

SEC不建立第二个“全工程状态机”。下面是唯一操作生命周期图：节点只引用各 domain owner
的状态；`VerificationSession` 组合这些 typed decisions，但不重新拥有 Work、Candidate、Action、
Review、Integration、Issue 或 Cleanup 的事实。能力当前成熟度只由 `docs/work/**` 与 live resolver
投影，本图不把 proposed 写成 implemented。

```mermaid
flowchart LR
  W["WorkDecision + Task Capsule"] --> R["Operation Read Plan"]
  R --> C["CandidateContent / CandidateGeneration"]
  C --> A["Requirement + Action closure"]
  A --> V["VerificationSession"]
  V --> RV["Exact-head Review"]
  RV --> H["Hosted verification when required"]
  H --> IA["Integration authorization"]
  IA --> M["Merge + remote/new-main readback"]
  M --> CL["Closeout + IssueDisposition"]
  CL --> X["COMPLETED"]

  V -. "WAITING_ACTIONS" .-> A
  V -. "WAITING_REVIEW" .-> RV
  V -. "WAITING_HOSTED_VERIFICATION" .-> H
  V -. "WAITING_INTEGRATION_AUTHORIZATION" .-> IA
  V -. "READY_TO_INTEGRATE" .-> M
  V -. "WAITING_MERGE_READBACK" .-> M
  V -. "READY_TO_CLOSEOUT / WAITING_CLOSEOUT" .-> CL
  V -. "AMBIGUOUS_SIDE_EFFECT / BLOCKED" .-> B["typed recovery or new authority"]
  B --> V
```

这些 runtime outcome 名称由 `scripts/codex/verification-session-runtime.ts` 唯一拥有。图只给出
人类可读的 stage composition；它不是另一个 parser、journal、transition table 或授权来源。
`ExecutionWave` 只在 WorkDecision 后编译顺序/冲突引用，也不包裹或替代本图。

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

第一次candidate commit之后的replacement仍使用同一worktree/ref和同一manifest path。Freeze只接受
`HEAD`以then-live default为sole parent，且该immutable HEAD中的current-state bytes、pointer、rolling plan、
manifest path/digest/base仍精确绑定同一个active且未进入default的package；新projection保持
`ACTIVATED_INDEX_PENDING_COMMIT`并由amend物化新exact generation。stacked/divergent head、不同package、
authority bytes漂移或已进入default的manifest一律拒绝。旧head上的Review/Evidence自动失效，不迁移。
“未进入default”按manifest path判断：live default上该path存在任意blob即表示该package lifecycle已发布；
修改digest不能复活同一package。复用只能进入另一个被独立授权的package/generation lifecycle。

Replan publish 必须把 `target bytes == NEXT bytes` 作为成功 NOOP；不得为了制造一次 rename而拒绝
已经正确安装的pointer/rolling/manifest。Git index的semantic identity是canonical entries/tree，raw
index bytes包含可由Git刷新且不改变tree的stat cache，只能用于同一未受扰动tuple的传输恢复，不能
让相同entries/tree变成永久不可恢复。journal recovery必须识别并retire已terminal/superseded operation
的exact residue；人工删除 recovery 文件不是正常协议。

Rolling plan的事实/prose refresh也只能作为freeze transaction的requested projection进入index，禁止
先手工stage。Compiler先从immutable PRE确定性promotion，再要求requested projection的active ID与有序
candidate IDs逐项相同；只有非选择内容可更新。任何选择、顺序、增删漂移都拒绝，pointer始终由compiler
从manifest digest渲染。由此动态事实可更新，但不能借rolling prose绕过WorkDecision/selection owner。
这里的immutable PRE只能来自exact HEAD/trusted generation；mutable index中的pointer/rolling必须等于该
原像，或是pointer仍由compiler为同一indexed manifest精确渲染、rolling的active与有序candidate topology
仍由immutable PRE唯一推导的prior projection。已批准的非选择prose bytes可以跨replan保留，但index bytes
永远不能成为自己的选择authority。

Document Control recovery 的身份与物理安全固定分层：恢复namespace只绑定
`operationId + logicalTargetKey`，其中key是closed set
`freeze-journal | git-index | active-pointer | rolling-plan`；repository/worktree/Git directory的绝对路径、
cwd和临时目录都不得进入semantic identity。每个真实effect仍必须在所选边上重新验证boundary、
no-follow/reparse ancestor、retained parent/target object identity、PRE/NEXT bytes和durability readback。
位置无关不是路径安全的替代物，也不允许用bytes相等绕过physical tuple。

Freeze journal只拥有一次未完成publication的恢复权。V4 `operationId`绑定manifest/control bytes、
base/pre-index/candidate tree与reviewed revision；raw index PRE/NEXT bytes只是journal内的transport
recovery material，不进入semantic operation identity。index transport PRE与每个worktree target的物理PRE
是不同事实：requested rolling bytes已经存在于worktree时，journal必须记录该exact worktree PRE，不能把
旧index blob伪装成一次未发生的worktree CAS并发明recovery residue。stage-zero index tree相同、或普通
target的真实PRE已等于exact NEXT且没有恢复tuple时，结果为zero-publication NOOP；不得刷新index stat
cache、rename相同bytes或为NOOP制造journal之外的副作用。新operation在第一次repository object/index/journal/control publication
之前读取且只读取一次live remote default；通过后最终pre-journal fence只复核local default、HEAD、index
与worktree。重复远端读取不增加线性化保证，禁止把每次freeze的网络成本翻倍；未通过live admission时
真实object database也必须byte/census不变。此owner的所有Git子进程默认强制`GIT_OPTIONAL_LOCKS=0`，但该
开关只是defense in depth，不是物理zero-write证明。任何解析index blob、stage、mode、tree或diff的Git命令
都必须只看到repository外的exact scratch index/object directory；真实index只允许retained handle/fd
raw-byte observation、显式CAS publication与紧邻readback；scratch解释无论成功或失败，都必须在传播结果或
错误之前完成真实index的byte+identity readback。任何真实index/object publication必须是代码中
可枚举的显式effect，observer不得借Git的stat-cache refresh污染自己的PRE observation。

```mermaid
stateDiagram-v2
  [*] --> Prepared: durable journal first
  Prepared --> IndexPublished: index tree changed only
  Prepared --> PointerPublished: index tree NOOP
  IndexPublished --> PointerPublished: pointer CAS or byte NOOP
  PointerPublished --> RollingPublished: rolling CAS or byte NOOP
  RollingPublished --> Terminal: exact tree/control/worktree readback
  Terminal --> Retiring: closed recovery census has zero consumers
  Retiring --> Retiring: delete one exact known residue
  Retiring --> [*]: delete canonical journal last, then empty transaction directory
```

`Retiring`从terminal journal编译一个跨Git-index recovery、transaction recovery、canonical journal和
empty-directory suffix的closed ordered plan，只接受恰好一个prefix cut；unknown name/bytes/identity、
中间hole、跨namespace倒序、active NEXT、非terminal phase或额外对象全部preserve并
blocked。journal永远最后删除，因此crash重入能从同一terminal authority继续，且journal消失时不可能
留下它授权的恢复对象。唯一的journal-last crash suffix是专用transaction directory仍存在且严格为空；
下一次writer可对该exact empty directory执行anchored retirement。journal缺失但目录含任意名字时没有
删除authority，必须完整preserve并blocked。旧schema只允许在同一Expand→Migrate→Contract切片中一次性证明terminal
census并退役；迁移完成后parser、writer、alias和fallback必须consumer-zero，不进入新main。

Windows terminal retirement在journal-last之前必须先完成每个recovery namespace的absence census和
parent-directory durability barrier；journal删除也必须absence-readback并持久化其父目录，之后才允许
删除空transaction directory。仅有`SetFileInformationByHandle`成功或逻辑删除顺序不构成crash ordering。

Cleanup 的平台能力边界必须如实建模。Windows 使用已打开对象 handle 的 disposition effect；Linux VFS
不提供“仅当目录项仍指向某 inode 才 unlink”的原子 CAS，因此唯一受支持的 writer 先持有 workspace
write lease，再持有 parent/target fd，在effect前最后一次 `openat(O_NOFOLLOW)` 复核identity与bytes，执行
一次 `unlinkat`，并用retained fd证明已打开对象未被替换、用selected parent/name absence与parent
`fsync`完成本次effect readback。其他名字持有的同inode hardlink不在本次删除authority内，link-count只作
诊断、不能要求归零；lease外的同用户恶意namespace mutation不被伪装成可线性化CAS，一旦selected name
发生可观察替换或出现未知identity即preserve/block。不得用path-only `rm`/`rmdir`或重试循环弱化这条边界。

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

这条规则的 production enforcement 属于 candidate/control transaction，而不是分支命名约定。
终态 `CandidateControlMaterializer` 必须先对 `logicalRunId` 取得 expected-old lease，读取 Git common-dir
worktree registry、local refs、**live provider heads/PRs** 和未终结 closeout receipt；若存在另一个未被
receipt supersede 的 mutable worktree或active ref，创建/发布第二个 candidate 必须 typed reject。
本地 `origin/*` 只是可 prune 的投影，不能单独证明远端存在或消失。完成时必须按 exact ref/SHA
删除并同时读回 provider head absence、PR terminal、tracking ref prune、worktree registry absence 与
physical target absence。该 materializer 进入 main 前，本段是明确 target contract，不得宣称已经
机器强制。

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
closing-keyword pattern，受控 PR 和生成的 merge message 即使准备完成 Issue 也不得渲染 closing
clause。PR 只携带一个 `progress-only | close-tracking-after-readback` 非 effect 计划；pre-merge 必须
同时读回 title/body 和完整 bounded `closingIssuesReferences`，两者均为零 closing authority 才能 merge。
provider 的 auto-close setting 只能作为 defense-in-depth，不能进入可证明的 authority chain。

`IssueDisposition` 是唯一 lifecycle decision owner；close writer 只有在 provider 能执行真实原子前置条件
时才可激活。完成评估至少绑定：Issue number、current-spec revision、stable acceptance IDs、exact
new-main commit/tree、逐 acceptance Evidence provenance，以及同 revision 的 remaining-work/child/consumer
census。`VerificationSession` 只能消费该独立 typed assessment，禁止自行填充 `satisfied` 或零 census。
当前仓库尚无该 trusted post-main assessment owner，因此只能产生 `progressed` receipt。
hosted closeout 必须把完整 canonical typed receipt 保存在 run artifact 中；只保留摘要、裸 digest 或
无法由 consumer 重新 parse 的 `Record<string, unknown>` 不构成可复用 Evidence。
IssueDisposition的post-new-main health evidence也只是consumer：它必须把完整check observation交给唯一
MainHealth compiler，以exact new-main commit/tree作为main与trust identity，消费fresh healthy
ordinary-only ledger及其ledger digest。它不得再按name/appSlug/`length === 1`私自过滤或重定义成功；
双event等价成功合法收敛，错误app完整identity、workflow ref/event、duplicate、unknown或conflict统一fail closed。
PR/commit/comment 中的 closing lexical pattern 默认一律拒绝渲染，并覆盖 `#N`、`owner/repo#N` 与
完整 `https://github.com/owner/repo/issues/N` 引用。
公开 CLI 只允许渲染安全 PR body 和观察非 effect plan；不得暴露 compile/apply/reconcile 或通用
Issue mutation 命令。provider close/reopen adapter 的唯一 production consumer 是现有
`VerificationSession` hosted integration/closeout，consumer census 必须由 focused contract 锁定。

GitHub 文档明确说明 unsafe method 的 conditional request 默认不受支持，`Update an issue` endpoint
也没有声明例外。因此普通 Issue `PATCH` 不是 CAS；当前 production adapter 不暴露 close/reopen
mutation、effect-start 或 terminal receipt，也不以 read→PATCH→readback 冒充原子操作。其现行事务为：

```text
safe PR plan + zero provider closing references
→ exact merge commit/tree readback
→ successful exact post-merge MainHealth
→ bind exact Issue/current-spec and acceptance IDs
→ completion-assessment-unavailable + provider-conditional-write-unsupported
→ progressed (zero Issue mutation)
```

未来只有 provider capability receipt 证明同一资源支持可审计的条件写，且 trusted post-main completion
assessment 已存在时，才允许升级为 `close-authorized → conditional effect → exact readback`；该迁移必须
作为新的 trust/capability cutover，不能在协调器内添加 caller flags。

Program Issue 与 focused slice 分别计算 acceptance；子切片完成不能继承父 Issue 的关闭权。
若 provider 仍在 merge 时关闭未授权 Issue，read-only reconciler 只有在 provider
`ClosedEvent.closer` 同时绑定 exact PR number 与 merge commit 时，才返回 typed
`manual-action-required`；由于 provider 不支持条件写，它不得自动 reopen，也不得通过标题、最近时间、
文本搜索或批量 API 猜测目标。workflow 在该结果上停止 closeout，由 maintainer 重新观察后处置。
`closingIssuesReferences` 的 GraphQL envelope 必须拒绝任意非空 `errors`，跨页锁定 `totalCount` 并证明
terminal accumulated count相等。迁移前缺少完整 IssueDisposition markers 的历史 merged closeout
只能 `legacy-no-effect`，部分或重复 markers 必须 fail closed。

worktree closeout 是 branch/ref closeout 的前置 physical Action，不以 `git worktree remove` exit code
为成功。terminal completion 同时要求 Git common-dir registry absence 与 exact physical target
absence；unregister 后目录残留进入 durable `residue`，只能从 target 外的 authorization receipt
重入。dirty/unknown/reparse/identity mismatch fail closed，后代 reparse 只 unlink entry 不遍历 target；
completed worktree receipt 之后 branch owner 才能继续 local/remote ref CAS。`git worktree list
--porcelain -z` 必须逐字段 strict UTF-8/NUL 解析，unknown、duplicate、unsupported、截断和互斥字段
全部拒绝；authorization 在 unregister 前以 canonical bytes 持久化到 target 外的 Git common-dir，绑定
repository/common-dir/target 的物理身份、branch/head/tree、recovery authority、working state、registry
和 physical inventory。terminal 由 registry + physical readback 机械推导，caller 不能声明 completed。
每次结果先发布为内容寻址的 immutable receipt generation，再由 durable atomic latest pointer 指向该
generation；`residue`或`blocked`不能覆盖旧证据，条件解除后同一operation可追加`completed`generation。
destructive cleanup必须持有parent/leaf handle：Linux用`openat(O_NOFOLLOW)`、`unlinkat`、retained
selected-parent/name absence readback和parent `fsync`，同inode的其他hardlink不在本次删除authority内、
不得导致已授权名字被误报为残留；Windows用`OPEN_REPARSE_POINT`、FileId/final-path fence和handle
disposition；禁止path-only `unlink`、`rmdir`或`chmod` retry effect。

branch owner 只消费同一 common-dir、同一 prepare 观察到的 exact target receipts；fresh host rehydrate
不得继承另一主机的绝对 worktree path，也不得把“当前 runner 没有该路径”解释成外部主机已完成清理。
同一主机上只要 prepared binding 仍存在、receipt 缺失/非 completed/identity 不符，或 receipt 后 fresh
inventory 又出现 binding，remote 与 local ref CAS 都在 effect-start marker 前 fail closed；实际 CAS 前
再读一次 inventory，避免 marker 与 effect 之间的重新注册竞态。
跨主机observation只保留host/observation digest，不携带或重放foreign absolute path，也不能由artifact
成功、当前job状态、raw JSON、locator或self-digest消除。正常收敛要求原host先完成physical closeout，
再从新物理状态生成不含foreign observation的preparation；已merge的旧recovery仍携带foreign
observation时返回`external-maintainer-disposition-required`，在存在独立disposition authority前零ref effect。

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
8. 唯一ordinary physical executor是在repository/default-branch全局临界区内完成fresh authorization、expected-head merge、tree parity与closeout readback的trusted hosted operation；不存在本地JSON消费、`--admin`或raw merge旁路。唯一例外是`docs/verification-governance.md`定义的Tier 0 manual break-glass：它不能冒充ordinary receipt，只能修复受信路径本身并满足其exact-object、candidate-lock、independent Review与remote readback约束。

满足时及时合并，不为表现“仍在开发”继续修改正确candidate。大型实验历史优先squash经过验证的最终状态。

Merge后先证明merged tree等于verified candidate tree；信任根变化时从new main重载TCB并使旧Session/Review/Evidence/authorization失效。随后以stable operation id幂等关闭 absorbed、superseded、mirror、probe和diagnostic PR/Issue，归档manifest，删除已完成使命且工具权限允许安全删除的branch/worktree/workflow；复核开放PR/Issue/CI，并从产品、架构和roadmap重新计算rolling plan。

### Automatic Trust-Epoch Rollover

信任代际终止的是旧授权，不是仍获用户授权的长期任务。`VerificationSession`拥有epoch/session transition，
Document Control Plane拥有new-main reorientation输入；Agent Skill只负责把非机器化的停止判断路由到这两个
owner，不建立第三状态机。历史性的`TASK_RESTART_REQUIRED`不是当前runtime outcome，也不得被Agent当作
routine terminal state。

```mermaid
stateDiagram-v2
  [*] --> EpochActive
  EpochActive --> MergeEffect: fresh integration authorization
  MergeEffect --> NewMainReadback: exact remote commit/tree/control readback
  NewMainReadback --> OldEpochSealed: invalidate old grants/review/evidence/cache
  OldEpochSealed --> Reorienting: canonical status on exact new main
  Reorienting --> EpochActive: resolved + current user authority
  Reorienting --> ExternalBlocker: unresolved/invalid/external authority/user choice
  ExternalBlocker --> Reorienting: causal input or explicit user decision changes
```

必须满足以下不变量：

1. `NewMainReadback`成功后，旧epoch的effect grant、Review、Evidence、scope与缓存facts一律不能授权下一动作；
2. reorientation只从exact new main、live resolver、`AGENTS.md`、selected manifest及`docs/authority.json`派生的owner closure重建输入，不继承聊天、旧PR正文或旧session结论；
3. 当前用户授权仍覆盖目标且resolver为resolved时，A0自动进入新epoch并继续`RequiredClosure ∩ MissingOrStale`，不等待用户再次输入“继续”；
4. 只有`unresolved/invalid` control state、缺少外部authority、独立Review不可用、必须用户裁决或其他typed external blocker才结束本次自动推进；
5. same-input PASS/FAIL/in-flight按其owner复用或join；epoch rollover不授权全量重跑，也不把旧failure改写成PASS；
6. 自动继续不得扩展原用户目标、写入范围或外部权限；新main选择了不同Work Package时，只能在原授权覆盖时继续，否则返回typed scope decision。

工具不能物理删除或执行某项操作时必须准确说明边界，不能把“已审查、已关闭、内容已包含”表述成“分支已删除、操作已完成”。
