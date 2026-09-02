---
title: 系统架构与权威流
status: stable
domain: system-architecture
---

# 系统架构与权威流

本文拥有 SEC 的关系元模型、跨域约束、编译阶段、责任与依赖方向、operation/resource/lifecycle/proof 闭包、物理物化和架构演进。产品结果由 `docs/product.md` 拥有，Agent 行为由 `docs/development-governance.md` 拥有，领域字段与算法由各领域 machine contract 拥有，当前能力只能由最新 `main` 与 Evidence 计算。

## 1. 架构核

SEC 把 accepted purpose、exact world observation 和可替换 capability 编译为可验证、可恢复、可演进的工程状态转换。

```mermaid
flowchart LR
  P[Purpose] --> K[Knowledge]
  K --> C[Constraint]
  C --> R[Responsibility]
  R --> A[Authority]
  A --> X[Execution]
  X --> V[Proof]
  V --> E[Evolution]
  E --> K
  I[Interface / Agent] -. intent in; projection out .-> P
  M[Physical world] -. observation / retained binding .-> K
  M -. Effect target .-> X
```

| 平面 | 唯一事实 | 签发者 | 不得产生 |
| --- | --- | --- | --- |
| Purpose | outcome、non-goal、不可推导取舍 | authorized Product/Domain decider | implementation、path、Effect |
| Knowledge | Subject、Definition、Observation、coverage、unknown | domain owner + interpreter/provider | permission、success |
| Constraint | invariant、admission predicate、waivability | contract/architecture owner | weighted override of hard failure |
| Responsibility | cell、owner、consumer、Requirement | responsibility compiler + domain owner | physical placement、runtime attempt |
| Authority | principal、Grant、delegation、Binding permission | authority issuer | capability availability、proof |
| Execution | Provision、Allocation、Attempt、Effect、Settlement | capability/resource/domain-operation owners | new Definition、self-verdict |
| Proof | Claim、readback、EvidenceSupports、verdict | domain readback + independent verifier | canonical mutation、authority |
| Evolution | activation、compatibility、migration、cutover、retirement | Change Management + state owner | permanent dual generation |
| Interface | normalized intent、typed projection | interface owner | second truth、resolver、writer |

架构合法性不是某一平面通过，而是全部必要平面的交集：

```text
AdmittedChange =
  PurposeValid
  ∧ KnowledgeCoverageValid
  ∧ ConstraintsSatisfied
  ∧ ResponsibilityUnique
  ∧ AuthorityValid
  ∧ CapabilityBound
  ∧ ResourcesAllocated
  ∧ LifecycleRecoverable
  ∧ ProofObligationsDeclared
  ∧ EvolutionObligationsClosed
```

任何 `unknown` 只阻断它可能影响的 Effect 或 Claim；任何 hard failure 都不能被多数 PASS、信心、测试绿色或人工评分抵消。

### 1.1 Engineering Principle 合同

一条原则不是散文段落，而是一个可编译记录：

```text
Principle = {
  identity, normativeRule, formalPredicate,
  inputs, outputs, owner, consumers,
  rejection, counterexample, reversal
}
```

同一原则的自然语言、谓词、角色、I/O、反例和机器拒绝是**等价视图**，不是六个事实源；缺少任一可执行视图时为 `principle-unmaterialized`。

| ID | 规范句 | 形式谓词 | 编译 I/O | 拒绝 |
| --- | --- | --- | --- | --- |
| EP-IDENTITY | 语义身份独立于位置、尝试和展示名 | `SubjectId ⟂ Address, Attempt, Label` | definitions + exact observations → stable refs | `identity-alias` |
| EP-TRUTH | observation/projection不能创造authoritative meaning | `Authority(out) ⊆ ⋃ Authority(inputs)` | facts + issuer → typed claims/unknown | `truth-amplification` |
| EP-OWNER | 每个identity/writer/parser/resolver/terminal只有一个owner | `cardinality(owner, key)=1` | relation graph → owner DAG | `duplicate-owner` |
| EP-UNKNOWN | 不完整知识保持显式且不能穿越受影响Effect/Claim | `unknown∩dependencies(target)=∅` | coverage + frontier → admitted/blocked targets | `unknown-crosses-boundary` |
| EP-AUTHORITY | Effect权限只收窄、不结构伪造 | `requested ⊆ grant ∩ envelope` | grants + plan + principal → exact Effect frontier | `authority-amplification` |
| EP-CAPABILITY | Requirement与Provision分离并exact绑定 | `satisfies(provision, requirement)` | eligible provisions + constraints → Binding | `capability-mismatch` |
| EP-RESOURCE | 所有子步骤消费同一不可逆parent ledger | `Σchild ≤ parentRemaining` | plan + ledger → allocations/remaining | `resource-budget-escape` |
| EP-EFFECT | start/exit不等于业务terminal | `terminal ⇐ settlementSet ∧ readback` | attempt + settlements + readback → result/residue | `effect-unsettled` |
| EP-PROOF | producer不能充分证明自己，Evidence只支持声明Claim | `issuer(evidence) independentOf producer(claim)` | claim + observations → verdict | `self-proof` |
| EP-RECOVERY | partial/lost-handle状态不可blind replay | `retry ⇒ conclusiveNotApplied ∧ ownerGrant` | intent + current readback → join/recover/retry/block | `unsafe-replay` |
| EP-EVOLUTION | 一个语义时刻只有一个active generation | `activeWriters(key)=1 ∧ retired(old)` | old/new graph + migration → cutover/retirement | `dual-generation` |
| EP-DERIVATION | 可计算事实生成，不手写镜像 | `stored(x) ⇒ ¬derivable(x) ∨ durableConsumer(x)` | canonical graph → projections | `derived-fact-duplicated` |
| EP-EXTENSION | 新语言/Provider/Target扩展边界，不给core加品牌分支 | `coreDelta independentOf instanceBrand` | provider/domain facts → same pipeline | `instance-special-case` |
| EP-ECONOMY | 新机制必须降低或保持正确变更全生命周期成本 | `Cost(new graph) ≤ Cost(valid alternatives)` | competing graphs + obligations → dominance result | `dominated-design` |

`counterexample`由Architecture Attack Compiler生成，`reversal`由原则owner声明；二者不复制到本表的事件清单中。

## 2. 正交事实模型

### 2.1 最小语义封套

底层只有三类逻辑构件：

- **Subject**：稳定语义身份；
- **Claim**：关于 Subject、可判定真假的命题；
- **Relation**：某 owner 签发的 typed edge。

每个 Claim/Relation 都绑定：

```text
issuer + issuer authority
+ subject revision
+ exact input / algorithm / provider identity
+ snapshot or operation epoch
+ coverage / unknown frontier
+ validity / invalidation / retirement
```

该封套只提供引用完整性，不是万能 DTO 或第二业务对象。具体 payload 由领域 strict contract 拥有；禁止建立“所有字段可选”的 global schema。

### 2.2 关系词汇

| Relation | 精确定义 | 不能替代 |
| --- | --- | --- |
| Address | Subject 在 exact logical/physical snapshot 中的位置 | identity、owner、长期事实 |
| Definition | owner 接受的意图、不变量、结果与 future obligation | current implementation、test |
| Requirement | operation/consumer 所需语义、能力、资源、失败和结算合同 | provider、argv、path |
| Provision | capability/provider 能提供的合同与边界 | domain intent、authority、success |
| AuthorityGrant | principal 对 exact Subject 可执行的 Effect 与条件 | scope string、caller DTO |
| Binding | Requirement 与 exact Provision 在有效 Grant 下的一次绑定 | lookup、default provider |
| Allocation | 从 parent ledger 不可逆保留给 Binding 的额度 | static ceiling、local timeout |
| Observation | 对 exact Subject/Binding 实际读取、加载、执行或计量到的事实 | plan、expected result |
| Settlement | 使用、终止、释放、readback、residue 和资源归还 | exit code、callback return |
| LifecycleTransition | create → active → terminal/residue → retired 的合法变化 | boolean、file exists |
| Derivation | output 由 exact inputs、algorithm 和 unknown 确定性产生 | 相似名称、时间相邻 |
| EvidenceSupports | 独立 observations/settlements 支持 exact Claim | 无 Claim 的 PASS、report |

对象种类不是关系种类：

| 对象例子 | 在模型中的表达 |
| --- | --- |
| source file | content Subject + snapshot Address + parser Observation + declaration/reference Derivation |
| manifest/template | content Subject + protocol parser Observation + provenance relations |
| process | process Provision + operation Requirement + Binding + Allocation + run Observation + Settlement |
| Docker daemon | container Provision + live availability Observation；不拥有业务 Definition |
| Git/GitHub | repository/hosted semantic Provision；transport 不拥有业务成功 |
| cache | 可丢弃 Derivation projection；不拥有 canonical Claim |
| document | stable Definition 或 generated projection；二者不可混写 |

### 2.3 正交与相互约束

正交表示一种关系不能使另一种关系自动成立；相互约束表示 architecture compiler 对这些关系做合取验证。

```mermaid
flowchart LR
  Req[Requirement] --> B{Binding admissible?}
  Prov[Provision] --> B
  Grant[AuthorityGrant] --> B
  Alloc[Allocation] --> B
  B -->|yes| Attempt
  B -->|no| Blocked
  Attempt --> Obs[Observation]
  Obs --> Settle[Settlement]
  Settle --> Readback[Independent readback]
  Readback --> Evidence[EvidenceSupports Claim]
```

Provision 不等于 Grant；Binding 不等于 Observation；exit 不等于 Settlement；Evidence record 不等于 Claim 为真。

## 3. 硬约束系统

| 约束族 | 必须证明 | 确定性拒绝 |
| --- | --- | --- |
| Shape | owner contract、exact keys、canonical bytes、domain invariant | duplicate/unknown key、invalid enum |
| Reference | refs、revisions、predecessors、receipts 属于同一 universe | dangling/foreign/stale ref |
| Identity | semantic identity 与 Address/attempt/version 分离 | path/PID/latest/label 冒充 identity |
| Uniqueness | identity、writer、parser、resolver、issuer、terminal、readback owner 唯一 | facade/alias/registry 成第二 truth |
| Authority | requested Effect ⊆ Grant ∩ operation scope；delegation 只收窄 | caller/test/projection 扩权 |
| Capability | Provision 的 contract/platform/executable/endpoint/principal/credential/env 满足 Requirement | ambient/PATH/provider substitution |
| Resource | Σ child reservation/consumption ≤ parent ledger remaining；释放一次 | 每层重开 timeout、重复返还 |
| Freshness | input/grant/binding/observation/readback/claim 的 epoch 相容且 active | replay、same-path ABA、stale PASS |
| Concurrency | claim、lease、CAS、single-flight/bounded parallelism 有线性化点与锁序 | double writer、lost update、deadlock |
| Effect | planned Effect 与 provider settlement set 精确相等，且 domain readback 独立 | exit=success、漏 settlement |
| Recovery | crash/lost handle/partial effect 可 join/readback/rollback/authorized retry | blind replay、删除 residue |
| Proof | Evidence issuer 与 producer 分离，且只支持预声明 Claim | self-proof、projection=observation |
| Coverage | exact universe、dynamic/opaque/unknown frontier 完整 | catch-all false、unknown=absent |
| Evolution | activation、migration、cutover、consumer-zero、single active generation | permanent dual read/write、Vn alias |
| Privacy | raw bytes、secret、credential、diagnostic 有最小 retention/projection | ambient secret、raw output leakage |
| Economy | 新对象有独立 Responsibility 或降低全生命周期成本 | wrapper、mirror、第二 graph/cache |

约束输出只有 `admissible | rejected | bounded-unknown` 和结构化 frontier；它不签发 Definition、Grant、Binding、Result 或 completion。

## 4. 四个 operation 视图

| View | 输入平面 | 回答 | 不回答 |
| --- | --- | --- | --- |
| Semantic | Purpose + Knowledge + Constraint + Responsibility | 做什么、为什么、哪个 Subject、何种结果 | 谁获权、是否执行 |
| Authority | Responsibility + Authority | 谁能对哪个 exact Subject 做哪些 Effect | Provider 是否可用、是否成功 |
| Resource | Provision + Execution | 谁供应、保留/消耗多少、怎样终止 | 业务结果、Evidence verdict |
| Lifecycle/Proof | Execution + Proof + Evolution | readback、terminal、residue、迁移、证据、退役 | 改写目标、放大 Grant |

四个 view 从同一 semantic graph 编译，共享 Subject/operation/revision，拥有各自 view kind 与 bytes digest。view 可以裁剪表达，不能增删 owner、Claim、unknown 或 blocker。

## 5. S0–S9 端到端编译

```mermaid
flowchart LR
  S0[S0 Outcome] --> S1[S1 Snapshot]
  S1 --> S2[S2 Observation]
  S2 --> S3[S3 Semantics]
  S3 --> S4[S4 Responsibility]
  S4 --> S5[S5 Pure operation]
  S5 --> S6[S6 Authority + binding + allocation]
  S6 --> S7[S7 Effect + settlement]
  S7 --> S8[S8 Claim verdict]
  S8 --> S9[S9 Publish / migrate / retire]
```

| Stage | 必需输入 | 唯一输出 | 禁止承担 |
| --- | --- | --- | --- |
| S0 | authorized outcome/non-goal/obligation | accepted purpose refs + unknown | scope、path、implementation |
| S1 | retained root、snapshot request、read budget | Content Manifest + physical receipt + unreadable frontier | semantic owner、source role |
| S2 | content refs、interpreter/provider contract | declarations/references/parsed records/external observations | Definition、permission |
| S3 | owner Definitions、S2 facts、adoption rules | semantic claims/conflicts/unknown frontier | provider choice、write plan |
| S4 | semantics + actual consumer/effect/state/recovery facts | Responsibility Cells + Owner DAG + public demand | placement、attempt、terminal |
| S5 | intent、Cell/DAG、invariants、Claim definitions | OperationKey + Requirement DAG + pure Plan + obligations | discovery、lease、Effect |
| S6 | Plan、Grants、eligible Provisions、parent ledger | exact Bindings + child Allocations + attempt admission | business success、Evidence |
| S7 | admitted attempt、retained bindings、allocations | Effect observations + settlements + residue + readback | new Definition/Grant |
| S8 | Claims、S7 facts、exact environment | typed Results + Evidence + invalidation | mutation、merge/publish authority |
| S9 | accepted Result、materialization/evolution contract | artifact/projection/cutover/retirement receipt | upstream identity rewrite |

阶段是因果偏序，不是必须串行的同步脚本。相同 exact input 的纯阶段可并行；Effect 阶段按 Requirement DAG、lock order 和 shared resource ledger 调度。反馈只能是 upstream owner 接受的新 request/result 或新 revision，不能用反向 import、mutable callback 或 presentation string 成环。

### 5.1 DesignAdmission

任何改变 public contract、owner、Effect、durable state、Provider、resource、recovery、layout 或 migration 的实现前，先编译：

```text
DesignAdmission = admit(
  accepted outcome / non-goal refs,
  exact producer-consumer-state-effect graph,
  target Responsibility / Owner DAG,
  identity / authority / capability requirements,
  parent resource + lifecycle / recovery rules,
  schema / migration / retirement obligations,
  Claim / Evidence obligations,
  bounded unknown frontier
)
```

它只返回 `admissible | rejected | bounded-unknown`，不创建 plan、state、authority 或 PASS。缺少 machine producer/consumer 时，它是 `required-unmaterialized`，稳定文档不得宣称已具备。

## 6. Knowledge：snapshot、Source Program 与语义

### 6.1 唯一观察链

```mermaid
flowchart LR
  W[Physical workspace / Git tree / IDE buffers / archive] --> P[Observation provider]
  P --> M[Transport-neutral Content Manifest]
  M --> L[Language / protocol fact shards]
  L --> S[Provider-neutral Source Program]
  D[Authoritative Definitions] --> A[Semantic Admission]
  S --> A
  A --> V[Validated Semantic Snapshot]
```

- Content Manifest identity 只包含 logical address、mode、content/object digest 和必要 semantic metadata；
- provider session、physical identity、Git locator、时间与读取预算只进入 physical observation receipt；
- Source Program 只从 manifest + interpreter/config closure 产生 declarations、references、types、entrypoints、resource/effect facts 和 explicit unknown；
- inferred facts 只有经 domain adoption 才进入 authoritative semantics；
- downstream 不重新扫描、解析或签发 source revision。

### 6.2 开放世界完备性

```text
Complete(U, M, C) =
  exactCensus(U)
  ∧ everyContentClassHasInterpreterOrTypedOpaque
  ∧ everyObservationHasCoverage
  ∧ unknownFrontier(U, M, C) = ∅
```

`U` 是 exact universe，`M` 是 active meta-model，`C` 是 coverage。无法解释的 bytes、dynamic import、generated source、binary、external endpoint 或 hidden executable text 进入 typed unknown；扩展名和目录规则不能静默排除。

### 6.3 增量与性能

Source Program fact shard key：

```text
FactKey = content digest
        + interpreter contract
        + resolution/config closure
        + actual external semantic generations
```

declaration/reference/type/entrypoint/resource/unknown/diagnostic shards独立失效。Language Service、watcher、long-lived worker 和外部 index 都是性能 Provider；cold clean compile 与 warm/delta compile 必须 byte-equivalent。cache miss/corruption/provider drift 回到同一 clean compiler，不得启用第二语义入口。

资源计量随真实读取流式消费；不能为了“预算”先全量读取一次再执行第二次。metadata 足够时不读 bytes；语义需要 bytes 时在触达上限前停止。typecheck、audit、test-impact、unused、duplicate、hardcode analysis 共享 snapshot/facts，不得各扫一遍。

## 7. Responsibility、Owner DAG 与物理布局

### 7.1 Responsibility Cell

Responsibility Definition 只保存不能从 Source Program 推导的稳定事实：

```text
Cell identity
+ outcome / obligation refs
+ owned semantic Subjects
+ public operations
+ required issuer/readback/proof separations
+ activation / reversal / retirement conditions
```

它不保存 paths、roots、imports、tests、current consumers/providers、Effect sites 或 runtime state。Source Program 提供实际 declarations/edges；Architecture compiler join 二者产生 Owner DAG、public-surface demand 和 placement constraints。

### 7.2 依赖层级

```mermaid
flowchart LR
  F[Value / identity foundation] --> C[Domain contract + strict parser]
  C --> O[Observation / provider output contract]
  O --> P[Pure compiler / decision]
  P --> K[Capability implementation]
  K --> D[Domain operation]
  D --> W[Workflow / composition]
  W --> I[Interface projection]
```

左侧是上游，右侧可依赖左侧。禁止：

- contract 导入 runtime/provider/operation；
- pure compiler 执行 Effect；
- capability 解释 domain success；
- workflow 绕过 domain operation 直达 primitive；
- interface 绕过 operation 重算 decision；
- foundation/architecture contract 反向导入 Source Program、filesystem、language provider 或 placement；
- feedback 形成 runtime import SCC；反馈必须是 typed request/result，由 orchestrator 组合。

### 7.3 Facade 的存在证明

Facade 只有增加下列至少一个真实边界才可存在：

```text
authority intersection
∨ external protocol normalization
∨ independent lifecycle / compatibility
∨ one semantic operation over several capabilities
```

聚合 export、缩短路径、隐藏 move、future placeholder、旧 import 续命、统一 index、service locator 都不是边界。public consumer 直接依赖最窄 declaration/operation owner；root barrel 和 re-export chain 不得形成第二 API 图。

### 7.4 物理布局

路径是 Address，不是 responsibility。Placement Compiler 从 Cell/DAG、co-change、failure/recovery、test/effect closure 推导 carrier：

| Zone | 允许内容 | 禁止内容 |
| --- | --- | --- |
| `src/**` | SEC 手写 production executable source；owner-local contracts/operations/providers及相邻 owner-local tests | generated state、cache、第二 source root、业务脚本镜像 |
| `tests/**` | 跨 owner/system/e2e/fault/property proofs 与其 fixtures | 镜像 `src` 目录、私有实现 oracle |
| `docs/**` | stable decisions/specs 与 generated documentation projections | current runtime state、源码清单 |
| `config/**` / ecosystem-native roots | tool-owned canonical configuration | 业务语义副本、第二 registry |
| Runtime State roots | durable operation/recovery state | authoring source、cache truth |
| cache roots | 可重算、有限额加速数据 | Evidence、authority、唯一状态 |
| artifacts | exact published results/Evidence | mutable current truth |

可执行 TypeScript/JavaScript 隐藏在字符串、fixture、document、generated resource 或别的 root 中仍属于 executable source candidate，必须进入 Content/Source Program classification；不能通过地址逃逸 architecture graph。

大文件不因行数自动拆分。只有 Cell/DAG 证明可分离 responsibility、单向依赖、独立 consumer 或 lifecycle，且迁移不缩小 Effect/failure/recovery 义务时，才拆成同 owner 下的 bounded modules。

### 7.5 Module admission

从 exact Source Program 生成 owner-pair edges、SCC、reciprocal pair、witness 和 feedback-cut candidate。拒绝：

- duplicate identity/writer/parser/resolver/Effect owner；
- production→test/private import；
- source root 外的 production executable；
- aggregate/index/alias 绕过 declaration owner；
- dynamic string import、隐藏 source 或 unknown edge 跨 Effect/terminal；
- old/new routes 同时 active；
- descriptor、目录或文档自报 owner 与 actual graph 不符。

## 8. Operation、capability 与资源

### 8.1 三层分离

| 层 | 拥有 | 不拥有 |
| --- | --- | --- |
| Capability primitive | bounded filesystem/process/network/container/compiler/Git invocation与physical settlement | domain intent、业务成功 |
| Domain operation | OperationKey、Requirement DAG、业务 invariant、Effect semantics、readback/recovery/terminal | provider实现、跨域工作流 |
| Workflow | 多个 domain operation 的依赖与补偿编排 | 子operation state/authority、primitive |

“原子”表示一个业务不变量完整成立或进入可恢复 typed state，不表示每个函数、文件或 I/O 都公开。对外只公开 query 和 domain operation；primitive/provider 细节保持内部。

### 8.2 单次 Effect 序列

```mermaid
sequenceDiagram
  participant O as Domain operation
  participant A as Authority issuer
  participant R as Resource ledger
  participant P as Capability provider
  participant D as Domain readback owner
  participant V as Independent verifier
  O->>A: Effect requirement + exact subject
  A-->>O: Narrow grant
  O->>R: Reserve from parent budget
  R-->>O: Allocation
  O->>P: Attempt + retained binding + allocation
  P-->>O: Provider settlement
  O->>D: Exact target / attempt refs
  D-->>O: Independent domain readback
  O->>V: Claim + settlement set + readback
  V-->>O: Typed verdict / recovery obligation
```

```text
OperationKey       = domain idempotency identity
AttemptNonce       = one physical try
ProviderBindingSet = exact executable/endpoint/principal/credential/cwd/environment closure
TerminalOutcome    = compile(exact planned settlements, independent readback, recovery policy)
```

deadline、provider route、PID、resume session 和 retry 不得生成新 OperationKey。

### 8.3 资源守恒

Parent ledger 至少计量：

| 资源 | 计量语义 |
| --- | --- |
| monotonic time | 一个 absolute deadline；所有 wait/read/effect/readback/cleanup/recovery消费 remaining |
| processes | admitted starts、live peak、terminal count；不得按 child 重开 |
| input/output | aggregate bytes/records；截断不等于忽略消费 |
| filesystem | entries、content bytes、metadata observations、open handles |
| memory/CPU | reservation、peak observation、release |
| network/API | requests、response bytes、rate/credential scope |
| context/tokens | selected facts/clauses、unknown expansion、output |

```text
Σ(reserved children) ≤ parent capacity
Σ(consumed observations) ≤ admitted allocation
release(allocation) occurs at most once
cleanup and readback consume the same remaining ledger
```

短预算 waiter 可以放弃等待 shared in-flight computation，但不能放宽 producer deadline。capability admission 的一次性 retained proof 与每次 invocation 的计量分开，禁止重复收费。

### 8.4 Process 与 Durable Local Effect Worker

Process session 必须绑定 retained executable、cwd、argv bytes、minimal environment、stdin/stdout/stderr bounds、deadline、termination tree 和 pre/post physical identity。裸 shell、ambient PATH/env、callback runner 或 caller-supplied function 不能进入 production Effect。

Durable Local Effect Worker 只拥有：

```text
OperationKey attempt claim
+ run/resume/process lineage
+ opaque provider/domain receipt references
```

它不接受任意 shell/argv/domain callback，不解释 stdout 或业务成功，不复制 domain phase/state machine。domain operation 独占业务 intent、lease、success/readback、retry/compensation 和 terminal。

lost handle 后只允许：

```text
join-live
| consume owner terminal
| execute handle-independent domain readback
| reconcile to typed residue/retry admission
```

有 start 无 terminal/retry admission 时禁止 replay。durable journal 证明“观察过某引用”，不能自行签发 domain truth。

### 8.5 并发与锁序

固定逻辑顺序：

```text
attempt claim
→ domain resource lease
→ provider bindings/effects
→ independent domain readback
→ owner terminal or retry admission
```

session 明确 `single-flight | bounded-parallel(N)`；编排必须遵守，不能为并发新开第二 session。所有 CAS 的 preimage/current/target physical identity 在 Effect primitive 内验证；cleanup 用 nested settlement 保留 primary failure，不覆盖或跳过 residue。

## 9. State、生命周期与恢复

### 9.1 状态域

| State domain | 拥有 | 不拥有 |
| --- | --- | --- |
| Git repository semantic state | candidate/published source and config | external PR/Review、runtime attempt |
| External platform state | hosted refs/PR/status/review/provider facts | local checkpoint 推断 |
| Durable SEC Runtime State | operation/claim/journal/recovery refs | domain truth、Verification PASS |
| Disposable cache | re-computable performance data | authority、Evidence、completion |
| Transaction-local scratch | one transaction staging/residue | durable cross-process truth |

五者物理 roots、identity、retention 和 cleanup authority 分离。root/path 由 retained layout capability 签发；lexical path、symlink/junction/reparse/mount/case/Unicode alias 不能成为 workspace identity。

### 9.2 生命周期

```mermaid
stateDiagram-v2
  [*] --> Proposed
  Proposed --> Active: admitted create + readback
  Active --> Terminal: complete / conclusive failure / exact rollback
  Active --> Residue: crash / lost handle / partial effect / unknown settlement
  Residue --> Active: owner-authorized resume or retry
  Residue --> Terminal: recovered readback / rollback
  Terminal --> Retired: consumers zero + retention satisfied
  Retired --> [*]
```

每个 durable state 必须绑定 creator、owner、revision、mutability、readers、invalidation、persistence、concurrency、cleanup、recovery、retirement。exit、return、file exists、pointer 或 test green 不是 terminal。

### 9.3 失败代数

| 失败位置 | 合法结果 |
| --- | --- |
| validation/coverage/eligibility/compatibility unknown | typed unknown/unsupported/conflicted；零 Effect |
| authority/provider/resource unavailable | blocked；Requirement 不变 |
| pre-publication failure | canonical target不变 |
| partial/post-effect failure | exact rollback receipt，否则 recovery-required |
| cleanup/close/readback failure | primary failure + settlement/residue；不得覆盖 |
| Evidence missing/stale | facts不变；依赖 Claim 不得 terminal |
| model不能表达反例 | model/plan/Evidence stale，进入 meta-evolution |

normal reader 只接受当前 active durable grammar。旧 grammar 只进入 migration owner；未知/权限/unsafe/deadline 错误不能 catch 成 `false | null | absent | cache miss` 后触发写入。

## 10. Identity、provenance、cache 与 Evidence

### 10.1 Typed provenance DAG

```mermaid
flowchart TB
  PO[Physical observation] --> CM[Content Manifest revision]
  CM --> SP[Language fact shards / Source Program]
  DEF[Authoritative definitions] --> SS[Semantic snapshot]
  SP --> SS
  SS --> REQ[Implementation requirements]
  REQ --> DEC[Decision]
  DEC --> BIND[Binding]
  BIND --> STAGE[Pure compiler stage results]
  STAGE --> ART[Target program / artifact content]
  OP[OperationKey + Grant + Bindings] --> ATT[Attempt]
  ATT --> SET[Provider settlement set]
  ATT --> RB[Independent readback]
  SET --> TERM[Terminal outcome]
  RB --> TERM
  CLAIM[Claim] --> EV[Evidence result]
  TERM --> EV
  ART --> EV
```

不存在统一 `Generation`：

| Identity | 只绑定 |
| --- | --- |
| Content Manifest revision | logical content set |
| Source Program generation | manifest + interpreter/config closure |
| Semantic snapshot | definitions + admitted observations/unknown |
| Decision/Binding | requirements + policy + eligible candidates |
| pure stage result | exact upstream refs + compiler/backend contract |
| Artifact content | canonical output bytes |
| OperationKey | domain Effect/idempotency |
| Attempt | one grant/binding/allocation execution |
| Evidence | Claim + exact result/environment/outcome refs |

attempt、deadline、cache path、Git session、PID 和 Evidence id 不得污染 pure result identity。

### 10.2 Cache contract

cache 可用当且仅当：

```text
producer closure exact
∧ input closure exact
∧ algorithm/provider identity exact
∧ invalidation complete
∧ bytes/shape validated
∧ active-reader lease valid
∧ size/age budget valid
```

cache/pointer/index/mtime/目录顺序无 authority；missing/corrupt/stale/foreign/GC 后回到同一 clean computation。增量结果与相同输入的 clean full result 必须 byte-equivalent。

### 10.3 Evidence

Evidence 只支持预声明 Claim，不支持“整个系统正确”。Proof owner 检查 subject、inputs、environment、coverage、issuer independence、freshness 和 invalidation。implementation producer、expected profile、projection、fixture、版本数字、报告文字和同模块 self-digest 不能成为独立证明。

Verification 的 Result lattice、ActionKey、复用和 CI/merge 规则由 `docs/verification-governance.md` 拥有；Architecture 只要求其不反向拥有 source、domain result 或 authority。

## 11. Reduction 与演进

### 11.1 图内裁决

全部 source/test/document/provider/state/cache/Effect/Evidence/plan 进入同一因果图：

```mermaid
flowchart LR
  O[Outcome / accepted obligation] --> R[Responsibility]
  R --> P[Producer / owner]
  P --> X[Object]
  X --> C[Consumers]
  X --> F[Effects / failure / recovery]
  X --> K[Cost / invalidation]
  C --> V[Readback / Evidence]
  F --> V
  V --> T[Terminal / retirement]
```

| Disposition | 成立条件 | 动作 |
| --- | --- | --- |
| required | independent responsibility、live consumer/effect/durable state，或 accepted unmaterialized obligation | 保留/实现最小闭包 |
| derivable | 可从 upstream facts 确定性重建 | 删除手写副本；生成 projection |
| duplicate-owner | 多个 producer/parser/writer/issuer 拥有同一 identity | 选 owner、迁 consumer、删其余 |
| dominated | semantics/failure/proof space 被成本不高于它的对象覆盖 | 合并后删除 |
| orphan | live/accepted/historical/external/unknown closure 全零 | 整图删除 |
| unknown | coverage/authority/future obligation 不完整 | bounded blocker；不作保留/删除结论 |

“未来会用”只有形成 owner-issued obligation、activation condition、acceptance、review/expiry 和 retirement 才是 required；comment、dead API、version suffix、test name 不是 future value。

### 11.2 版本与兼容

version/revision/schema 只有真实 durable、cross-process、external 或 rolling migration consumer 能区分两个可观察状态时存在。单 generation、原子迁移、测试自证或名字区分时删除字段/dispatcher/Vn suffix。需要版本时由 grammar owner 提供唯一 constant、literal type、strict parser、unknown-version rejection 和 migration；测试验证旧状态转换与拒绝，不镜像数字。

### 11.3 一次迁移

```mermaid
flowchart LR
  O[Old exact graph] --> P[Target graph + obligations]
  P --> M[Durable migration intent]
  M --> N[Publish target + readback]
  N --> C[Cut over all consumers]
  C --> Z[Old consumer zero]
  Z --> R[Retire old path/API/schema/test/migration state]
```

迁移期间只有一个 active authority route。跨提交只能保存 immutable source/target digest、obligation 和 terminal condition，不能保留 executable compatibility facade 或双 writer。失败必须 resume/rollback/recovery-required。

### 11.4 Meta-model evolution

```mermaid
flowchart LR
  O[Old active model/compiler] --> I[Extension intent + counterexample]
  I --> N[New candidate model/compiler]
  O --> E[Expressible-subset equivalence]
  N --> E
  E --> V[Independent meta-verification]
  V --> C[Atomic cutover]
  C --> R[Old model/projections retirement]
```

旧 compiler 只授权迁移 envelope，新 compiler 只验证 candidate post-state，独立 verifier 证明旧可表达子集等价和新增 frontier。不能用新模型自证采用，也不能永久双跑两套 truth。

## 12. 文档、原则与 Agent 投影

### 12.1 文档载体

| Carrier | 只保存 | 产生方式 | 禁止保存 |
| --- | --- | --- | --- |
| Accepted decision | 不可推导 outcome/non-goal/tie-break、理由、反转条件、issuer | authorized decider 一次签发 | current path/provider/test/status |
| Stable spec | Definition/invariant/forbidden authority/activation/retirement | domain owner contract | implementation inventory、事件日志 |
| Machine contract | identity、schema/parser、capability、rejection | canonical code owner | rationale副本、runtime result |
| Generated projection | applicability、roles、closures、obligation、unknown、人/AI view | compiler | manual edits、Effect/PASS |
| Runtime/Evidence | attempt/journal/receipt/failure/external observations | runtime/verification owner | stable design truth |

### 12.2 Engineering 与 Agent principles

| Principle kind | 约束 | canonical owner | runtime consumer |
| --- | --- | --- | --- |
| Engineering Principle | product、code、state、Effect、Evidence、evolution | Product/Domain/System Architecture | DesignAdmission |
| Agent Principle | Agent 取事实、推理、质疑、授权、行动、验证、收口 | Development Governance Agent Constitution | BehaviorAdmission |

```text
EffectiveAction =
  BehaviorAdmission
  ∩ DesignAdmission
  ∩ active EffectGrant
  ∩ available Provision / Allocation
```

Agent principle 不能创造 engineering truth；engineering principle 不能授权 Agent。聊天、summary、memory、Skill 不补缺项。

### 12.3 单一语义、多种精确表达

```mermaid
flowchart TB
  D[Accepted decisions + stable domain facts] --> G[Canonical principle graph]
  M[Machine contracts + exact observations] --> G
  G --> F[Formal predicates]
  G --> R[Role / authority map]
  G --> B[Boundary / counterexample matrix]
  G --> E[Machine enforcement]
  G --> H[Full rationale]
  G --> A[AI compact context]
```

多种表达允许长度和形式不同，目的是消除歧义：

| View | 优化目标 | 必须保留 |
| --- | --- | --- |
| full rationale | 定义、推导、方案比较、反转条件 | 全部 semantic meaning |
| formal | 可判定谓词、状态机、truth table | exact constraints/unknown |
| role | issuer/owner/consumer/handoff | authority separation |
| boundary | 正反例、failure/recovery、retirement | rejection semantics |
| enforcement | type/schema/parser/lint/admission/CI | reachable machine rejection |
| AI compact | 当前 question 的最小 closure | 同一 blockers/unknown |

所有 views 引用同一 semantic graph digest；任何 view 增删 Claim、owner、unknown 或 blocker 都拒绝发布。完整解释可以严谨且较长，但不得复制 current facts；信息密度由按需 projection 提升，不靠删条件。

root `AGENTS.md` 是 Agent Constitution 的 generated bootstrap projection，`owns: []`。其生成、load receipt、BehaviorAdmission、self-evolution 和 instruction/data separation 由 `docs/development-governance.md` 拥有。

### 12.4 文档实时同步

```text
stable clauses
+ authority registry
+ machine contracts
+ Source Program consumer/effect facts
→ clause/owner/consumer/invalidation graph
→ full human + compact Agent + admission/obligation projections
```

stable prose 只在不可推导 decision/invariant 改变时修改；实现/path/provider/test/maturity 变化更新 machine source 并重编 projection。stable 改变而 machine consumer 无 delta 是 `unmaterialized-stable-decision`；实现变化导致 stable prose current 镜像是 `derived-fact-in-stable-spec`。

## 13. Repository、测试与 AI 读取闭包

### 13.1 Reconciliation Projection

每个逻辑纵切片后，从 before/after Source Program 编译：

```mermaid
flowchart LR
  D[Changed declaration/schema/capability/operation] --> G[Before/after graph]
  G --> C[Consumers/parsers/writers/effects/unknown]
  C --> R[Settlement/readback/recovery/tests/projections/retirement]
  R --> Q{exact closure?}
  Q -->|yes| T[closed slice]
  Q -->|no| U[reconciliation-unresolved]
```

关系只用 `declares | produces | parses | reads | writes | executes | settles | reads-back | recovers | caches | projects | verifies | migrates | retires`。Git commit 只能封存 closed slice，不能创造 closure。

### 13.2 测试架构

测试存在当且仅当观察至少一种不可由更低成本 machine boundary 完全拒绝的性质：

| Test semantic class | 观察 |
| --- | --- |
| behavior | public input/output/state transition |
| durable | write → strict readback/digest/recovery |
| Effect | real/fake-provider sentinel with exact zero/nonzero side effects |
| failure boundary | typed error、abort、CAS、unknown、residue |
| physical safety | no-follow/identity/replacement/cleanup |
| algorithm/property | equivalence、monotonicity、invalidation、closure |
| protocol/external | producer/consumer compatibility |

源码文本、路径布局、函数 arity、内部数组、版本数字、测试数量、sleep 和 presentation string 不是独立 proof。能由 type、strict parser 或 closed-world graph 完整拒绝的非法状态不再增加镜像 runtime test。owner-local tests 与 source 相邻；跨 owner/system/e2e proofs 进入 `tests/**`，不镜像 source tree。

### 13.3 AI 最小读取

Agent 初始只消费：bootstrap router、accepted task/outcome、目标 owner clause、public operation、changed symbol 的 exact consumer/effect closure、unknown frontier 和受影响 tests。Read Plan 绑定 source revision、package/owner identity、required/conditional refs 与 byte/context budget；路径相邻、旧聊天、名字相似或“熟悉仓库”不能扩张读取。

## 14. Continuous Architecture Attack Compiler

### 14.1 触发与输出

| 时点 | 自动攻击 |
| --- | --- |
| goal/model proposal | competing model、unrepresentable case、delete counterfactual、reversal |
| responsibility/placement | duplicate owner、SCC、reverse edge、facade、co-change cost |
| operation plan | grant amplification、provider substitution、budget conservation、crash/retry |
| implementation delta | missed producer/consumer/parser/writer/test/projection/old edge |
| terminal/Evidence | self-proof、stale/replay、missing readback、cleanup/residue |
| production counterexample | invalidate model/plan/Evidence、meta-extension、retirement |

```text
AttackClosure =
  reverseClosure(
    changed subjects ∪ proposed claims,
    constraints ∪ authority/effect/failure/resource/evolution edges
  )
```

每个 attack 绑定 L1 relation、L2 constraint、exact target、owner 和 witness。停止条件：closure 内全部为 `refuted | mitigated | authorized-waiver | bounded-unknown`，且 ledger 允许继续。waiver 仅适用于 constraint owner 明确可豁免项；identity、authority non-amplification、semantic truth、durable integrity、Evidence honesty 不可豁免。

### 14.2 攻击族

| Attack | 预期不变量 |
| --- | --- |
| identity alias/rename/ABA | identity≠Address；pre/post retained physical identity |
| stale/replay/clock drift | revision/epoch + monotonic deadline；无 latest/wall authority |
| unknown/partial coverage | unknown 不能降为 absent/mismatch/cache miss |
| confused deputy/origin spoof | non-forgeable issuer；delegation只收窄 |
| provider/credential/env substitution | exact binding + minimal env + pre/post revalidation |
| reentrancy/race/deadlock | declared concurrency + linearization + global lock order |
| crash/partial/lost handle | durable intent + settlement + independent readback + no blind replay |
| cancellation/resource exhaustion | one parent deadline + aggregate irreversible ledger |
| cache poisoning/delta divergence | full key + clean equivalence + cache no authority |
| schema/version drift | strict owner parser + migration-only old grammar + one normal generation |
| binary/polyglot/generated source | bytes census + interpreter/opaque coverage |
| supply chain/tool replacement | conformance/security/license/identity/exit + old owner zero |
| cross-platform filesystem | retained physical binding; symlink/junction/reparse/mount explicit |
| secret/diagnostic leakage | minimal env/projection + raw bytes retention owner |
| self-proof/mirrored test | independent Claim Evidence; no implementation oracle |
| compatibility/retirement | real coexistence window + atomic cutover + migration removal |
| speculative abstraction | accepted obligation or proposal-only |
| offline external provider | domain requirement stable; legal alternative binding or blocked |
| instruction injection/context loss | canonical constitution + data/instruction separation + re-admission |
| performance/repeated scan | shared snapshot/facts/terminal; no correctness weakening |

## 15. 无代码逻辑验证

架构设计发布前必须对 safety、liveness、determinism、recoverability、extensibility 和 economy 做模型演算。

### 15.1 必须保持的性质

| Property | 形式化条件 |
| --- | --- |
| No authority amplification | every Effect has live Grant; child scope ⊆ parent scope |
| No implicit truth | unknown/opaque/conflict cannot become positive Claim |
| At-most-once business Effect | one OperationKey claim; replay requires conclusive readback/retry admission |
| Exact settlement | planned provider requirement set = settled receipt set |
| Independent proof | Claim producer ≠ sufficient Evidence issuer |
| Deterministic pure compile | same semantic inputs/algorithm ⇒ byte-identical pure outputs |
| Recoverable progress | every admitted Effect reaches terminal or typed recoverable residue |
| Single active generation | after cutover, old writer/parser/route consumer count = 0 |
| Bounded execution | all observations/effects/cleanup consume one parent ledger |
| Incremental equivalence | warm/delta output = clean output for same exact inputs |
| Extensible core | new language/provider/Target adds provider/domain facts, not brand switches in core |
| Correct-change economy | new mechanism reduces or preserves owner/scan/state/test/context cost |

### 15.2 Reference traces

#### Read-only query

```text
S0 question
→ S1 exact snapshot
→ S2 facts + coverage
→ S3 semantic answer or bounded unknown
→ projection
```

No EffectGrant, Allocation for child processes, cache write, journal or mutation is implied. If persistence is desired, it becomes a separate Effect operation.

#### Mutation with concurrent replacement

```text
pure plan(preimage A)
→ grant/binding/allocation
→ pre-effect retained readback sees B
→ CAS conflict
→ zero target Effect
→ stale plan/Evidence
```

Continuing with A, overwriting B, or translating conflict to cache miss violates Identity, Authority and Effect constraints.

#### Crash after external Effect

```text
operation claim + durable intent
→ provider start
→ client loses handle
→ current domain readback
   ├─ target exact: synthesize owner recovery terminal
   ├─ conclusively not applied: owner may issue retry admission
   └─ unknown/partial: recovery-required
```

PID absence, timeout or missing journal pointer never selects the retry branch.

#### Provider replacement

```text
Requirement unchanged
→ candidate Provision B
→ eligibility/conformance/security/license
→ new exact Binding
→ behavior/failure/readback equivalence
→ migrate consumers
→ old Binding/provider owner consumer-zero
```

Adding B beside A without cutover/retirement is duplicate-owner, not resilience.

#### Meta-model counterexample

```text
counterexample not expressible by active M
→ all dependent complete/plan/Evidence stale
→ candidate M'
→ equivalence over M-expressible universe
→ new frontier validation
→ independent cutover
→ retire M
```

Special-case flags or a second analyzer fail Single Active Generation.

#### Agent resume after context loss

```text
canonical Agent Constitution projection
+ accepted task authorization
+ current live observations
+ active operation/runtime refs
→ BehaviorAdmission
→ same legal next action or typed blocker
```

Conversation summary and memory can locate facts but cannot recreate authority.

### 15.3 Design exit

```text
ArchitectureDesignClosed =
  product capabilities map to S0–S9
  ∧ every relation has one owner
  ∧ every hard constraint has a reachable rejection
  ∧ every Effect has resource/settlement/recovery
  ∧ every Claim has independent proof semantics
  ∧ every future obligation has activation/reversal/retirement
  ∧ reference traces satisfy all properties
  ∧ no competing owner, facade, graph, cache, state machine or prose mirror remains
```

未满足时输出 exact frontier 和 owner；不得以“设计文档已写”“测试以后补”“AI 会注意”或兼容层结束设计。

## 16. Architecture Evolution transaction

代码布局、package owner、public entry、durable schema、operation/resource contract 或依赖方向变化必须作为一次可恢复 transaction：

```mermaid
flowchart LR
  A[Old exact source/consumer/effect graph] --> B[Target graph + net deletion]
  B --> C[Producer/consumer/external/unknown census]
  C --> D[Relocation + rewrite + state migration plan]
  D --> E[One workspace lease + effect CAS/readback]
  E --> F[Graph equivalence + behavior/effect proofs]
  F --> G[Owner/provenance cutover]
  G --> H[Old path/facade/alias/mirror/migration retirement]
```

Plan 绑定 source revision、preimage/target physical identity、old/new graph digests、unknown frontier、operation obligations、verification closure 和 terminal deletion set。crash/CAS failure 只能 resume、exact rollback 或 recovery-required。完成必须证明 target active、old consumer-zero、unknown 为零或 bounded、义务未缩小、净状态/代码/维护扇出下降，并退役 transaction 自身。
