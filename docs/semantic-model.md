---
title: Engineering IR 语义模型
status: stable
domain: semantic-model
---

# Engineering IR 语义模型

本文拥有 Engineering IR 的概念模型、身份域、Semantic Responsibility、Assertion authority、当前snapshot生命周期、冲突语义与 validated boundary。精确 TypeScript shape、Predicate signature、diagnostic、canonical ordering 和 digest payload 只由semantic owner下的strict contract、builder、validator与revision实现共同拥有；聚合入口、路径名称和合同测试不建立第二shape owner。

## 定位

Engineering IR 是 SEC 接受的 canonical engineering semantics。它是有向、强类型、带属性的多重图，但不是 AST、Source Program Model、源码符号图、调用图、Implementation Resolution state、Target Program IR、ExplainGraph、interface projection、Repository inventory 或 AI Knowledge Graph。

它回答“哪些工程对象存在、哪些工程陈述成立、谁以什么依据作出陈述、哪个对象承担哪些工程责任”，不回答目标语言如何打印、文件如何布局、选用哪个具体类库、UI 如何排版或某次运行是否通过。

Brownfield governance 与 deterministic generation 共用同一 Engineering IR。源码观察、validated Semantic Contract、可选Block binding和显式 Adopt decision只是不同输入来源，不得产生平行语义核心。Semantic Contract declaration、schema、link/import由capability-contract owner拥有；Engineering IR只拥有validated declaration到Entity/Fact/Assertion的canonical lowering与representation。Implementation Resolution只能消费validated语义并产生下游实现绑定，不能以候选、Provider默认值或源码写法反向修改Semantic Contract。

本文是stable semantic contract，不证明任何admission已经implemented、verified或supported。current producer、validator、consumer、reverse dependency、legacy residue与Block-optional cutover只由exact-tree maturity projection给出；未闭合项保持unresolved，不能因本文存在、类型可导入或局部测试绿色提升能力。

## 核心对象

- **Entity**：具有稳定 identity 的工程对象，如 application、Responsibility、Operation、State、Policy、Effect、Generator、Artifact 或 Acceptance；Block只有在真实分发/信任/版本/迁移生命周期存在时才可作为其中一种Entity或source binding，不是语义准入许可证。
- **Fact**：规范化 triple：`subject --predicate--> object`。Fact 只拥有 triple identity。
- **Assertion**：某个来源对该 exact Fact 的独立声明，拥有 authority、confidence、provenance、evidence references 和当前snapshot binding。
- **Semantic Responsibility**：一个稳定工程对象承担状态、行为、Effect、Permission、Resource、Contract、Source/Artifact binding 与 lifecycle 的语义边界。
- **Scenario**：从 canonical Entities/Facts 确定性重建的只读 derived cache，不是第二声明入口。
- **Validated Snapshot**：通过统一 validator 后签发的不可变边界，绑定输入与语义 revision。

同一规范化 triple 在一个 snapshot 中只有一个 Fact。不同来源、authority 或 provenance 的主张作为多个 Assertions 保留，禁止 strongest-wins、last-write-wins 或把多个来源压成一个“综合事实”。

## Semantic Responsibility

Responsibility 是 SEC 的工程理解和影响传播单位，不等于文件、函数、类、模块、Block、UI 节点或团队名称。

一个 Responsibility 至少可以通过 canonical Facts 关联：

- owned state、readers、writers 与 mutation boundary；
- operations、inputs、outputs、errors、idempotency 与 concurrency；
- Effects、Permissions、Policies、Resources 与 external ports；
- provided/required Contracts、consumers、providers 与 dependencies；
- Scenarios、Acceptance与owner-issued required Verification Claim/obligation references；
- Authoring/Governed Source、Target Artifact 和 release/public bindings；
- lifecycle、replacement、split、merge、migration 与 retirement。

Responsibility identity 表示“同一个工程责任是谁”，不能仅从一个文件路径、symbol 名称、Block ID、具体类库或当前实现位置派生。合法演进至少区分：

```text
same | renamed | moved | split | merged | replaced | ambiguous | unknown
```

Split、merge 和 replacement 必须有显式 relation 和 migration/provenance，不能复用旧 ID 表示新的责任对象。

### Responsibility 的来源

- Contract/Policy/Adopt decision 可以产生 authoritative Responsibility assertions；
- canonical rule 可以产生 derived facets；
- Source Program Model 产生绑定exact snapshot的`observed | derived | unknown` source facts/candidates；只有Engineering IR admission compiler才能把完整receipt映射为`observed` Assertion，或在不完备解释时映射为`inferred` Assertion；
- AI、静态分析、代码图和 runtime trace 只能产生 candidate assertions或 Evidence。

Responsibility reconstruction 的候选必须保留 source bindings、facets、confidence、coverage、conflicts 和 unknown frontier，并明确 `authoritative: false`。同名、路径邻近、高 confidence、框架惯例或多个 Provider 一致不能自动取得 authority。

Reconcile/Adopt 可以接受、拒绝、拆分、合并或保留 opaque candidate。Adopt只授予明确scope的canonical authority、source owner与allowed Operation，并绑定Acceptance和required Verification Claim/obligation references；它不授予Verification执行或结果authority，也不把整个文件或Provider结果全部升格。

### Responsibility 与其他对象

- Block 是有真实生命周期时的可选分发、版本和信任单位，可以声明多个 Responsibilities；没有Block的Contract/Responsibility同样合法；
- module/class/function 是 Source Program objects，可以实现或参与一个或多个 Responsibilities；
- Operation 是 Responsibility 提供或消费的受限行为；
- State/Effect/Permission 是 Responsibility facets，不单独代表完整 Responsibility；
- Impact 可以传播到 Responsibility，但不拥有其 identity 或 canonical facets；
- Implementation Requirement可以从Responsibility/Operation/Effect/Permission派生，但不成为新的业务语义来源；
- Agent/CLI architecture view只是 Responsibility projection。

## 身份域

### Entity identity

Entity identity 表示同一个工程对象跨重建、显示名变化和合法移动仍然是谁。它不得来自随机 UUID、数组位置、UI 坐标、绝对路径或显示 label。路径可以成为受版本约束的 source/artifact binding，但不能默认等于跨域 identity。

### Fact identity

Fact identity 只从规范化 subject、predicate 和 object 派生。authority、confidence、provenance、evidence 数量和 Assertion 数量都不得进入 Fact ID。

### Assertion identity

Assertion identity绑定 Fact、authority 与规范化 provenance identity。Evidence 可以补充同一 Assertion，但不能通过加入一条报告制造新的语义 claim。相同 Assertion identity 若出现不兼容 confidence、snapshot binding 或来源语义，必须诊断冲突，不能静默取最大值或最后值。

### Revision

输入声明 revision、最终 semantic revision、Source Program revision、Responsibility candidate revision、Implementation Requirement/Decision/Binding revision、transaction execution identity、artifact revision 和 Evidence revision 是不同域：

- input revision 表示规范化声明输入；
- source-program revision 表示对 exact physical workspace 的 observed/derived 模型；
- semantic revision 表示最终 canonical graph；
- candidate revision 表示一组尚未 Adopt 的解释；
- implementation requirement/decision/binding revision表示对既有语义的下游实现选择，不得进入semantic revision；
- transaction identity 表示一次执行；
- artifact revision 表示某个生成结果；
- Evidence revision 表示一个观察或证明记录。

时间戳、绝对路径、UI 布局、Map insertion order、当前进程和一次运行 ID 不得污染 semantic identity。

## Authority、confidence 与来源

Assertion authority 至少区分：

- **authoritative**：用户、项目 Contract、明确 Policy、Adopt decision 或其他被授权来源的声明；
- **derived**：由identity-bound canonical rule从受信输入确定性推导；只有真实跨版本consumer存在时该rule才建立独立revision/dispatcher；
- **observed**：对 exact source/runtime/environment 的直接观察；
- **inferred**：静态分析、AI 或其他不完备机制产生的解释。

Authority 是权力层级，不是概率。`inferred confidence = 1` 仍不能覆盖 authoritative claim；多个 Provider 一致也不能多数票升格。Confidence 只在允许不确定性的 authority 类别中描述该 assertion 自身的判断强度。

Provenance 回答声明来自哪个 Contract、Adopt decision、compiler rule、source span、runtime observation 或 Provider。Evidence reference 指向外部记录；Evidence 内容、expiry、bias 和运行环境不应被复制进 semantic graph。

## Assertion 生命周期

Engineering IR表示一个revision的active Assertion snapshot，不是跨revision历史ledger。snapshot只包含该revision仍成立的
Assertions；其snapshot binding不能被解释为完整validity interval。新revision可以保留、增加、移除、重新推导或重新观察
Assertions，endpoint Delta只比较两个active sets。active-snapshot contract不保存或解释历史validity interval，也不能因某个可选
字段存在就宣称支持retraction、split/merge lineage或长期审计。

若未来真实consumer需要跨revision validity history，必须由独立durable lineage/ledger owner提供strict schema、writer/reader、
migration、retention、split/merge/replacement关系和readback，并发布新的Delta contract；普通IR reader不得双读历史grammar，
历史字段也不得参与生成自身semantic revision。缺少该闭包时删除无consumer字段，而不是保留“以后可能有用”的空协议。

升级或 source change 后，Assertion 不能凭 Entity identity 延续而自动继承。Contract assertions 从新 Contract 重建；derived assertions 由新规则重算；observed assertions绑定新环境或 source revision；inferred assertions可以失效并重新推断。Provider或ImplementationBinding升级若保持Semantic Contract，不得无故重写canonical Assertions；无法保持时必须进入显式Semantic Migration。

## 冲突与未知

冲突不是简单的“哪条 confidence 更高”。Validator 和 source policy 必须区分：

- 同一 assertion identity 的不兼容内容：hard conflict；
- 多个 authoritative assertions 对互斥命题的冲突：阻止相应 validated boundary；
- inferred/observed 与 authoritative 冲突：保留 competing assertion 和 diagnostic，不改写 authority；
- Responsibility candidate 对 owner、state writer、Effect 或 source binding 冲突：保持 conflicted/ambiguous，不能自动选择；
- stale、partial 或覆盖不足：保留 Evidence limitation 和 unknown frontier；
- 无法唯一解析 identity/reference：ambiguous，不得选择一个最像的对象；
- predicate 或 object shape 未获支持：在 canonical boundary 前拒绝。

“没有发现 Fact”只有在输入 inventory、Provider coverage 和验证机制按设计足以发现该 Fact 时，才构成缺失证据；否则仍是 unknown。Implementation Resolver也必须消费这一未知边界，不能把缺失Fact、空Provider结果或类型检查成功解释为能力、安全或行为已经证明。

## Predicate 与 signature

Predicate 描述关系语义，使用唯一canonical signature registry约束 subject kinds、object kind 和 value schema。以下是target retirement invariant：只有具备真实
producer、signature、consumer和Impact/Effect解释的active predicate才能进入validated Fact union。“未来可能使用”不能建立
reserved predicate、Vn token或测试冻结字符串；如果strict legacy parser必须识别旧durable token，它只属于Change Management
拥有的隔离migration grammar，不能进入current canonical capability。registry只有满足版本存在证明时才建立revision/dispatcher。

Predicate signature 只定义合法 shape，不自动定义 Impact 传播方向、UI 边样式、Implementation eligibility或 Verification runnable mapping。Builder、validator、Fact store、index、Projector 和 consumer 不得各自复制另一套 switch。

Responsibility所需的ownership、state access、dependency、implementation、Effect、Permission、Verification、consumption、publication
与lowering relations只有进入active signature、producer和真实consumer后才是canonical capability；文档中的名称或测试字符串不构成
registry membership。Implementation Resolver可以从这些validated relations派生requirement，但不能反向写入或借用同名自由字符串建立Provider等价。

## Canonical ordering 与确定性

所有 Entities、Facts、Assertions、attributes、provenance 和 derived caches 都必须经过统一 normalization 与 canonical ordering。相同 inputs 和规则产生相同 IDs、revisions 与 serialized bytes。去重必须以 identity 和完整 canonical payload 为依据，不能依赖插入顺序或 object reference。

IR 是 multigraph，不要求全图无环。某个 Pass 可以对某类 predicate 子图要求 acyclic，但 State loop、retry、recursive evidence 或 workflow cycle 可以合法存在。

## Raw 与 validated boundary

Raw IR 是不受信计算结果。统一 validator 至少验证：

1. format/input/graph/app binding；
2. Entity、Fact、Assertion identity 与 canonical order；
3. subject/object 引用完整性；
4. Predicate signature 与 value schema；
5. Assertion authority、confidence、provenance、evidence与current snapshot binding；
6. Responsibility identity、facets、source bindings、replacement/split/merge关系与authority；
7. duplicate/collision/conflict；
8. Scenario 等 derived cache 与 Facts 的一致性；
9. semantic revision 与 canonical payload；
10. clone 后递归 deep-freeze。

只有该边界可以签发 branded validated snapshot。Lowering、Implementation Resolution、Impact、Projection、Agent/CLI interface 和 Mutation planner 等 IR-native consumer 只接受 validated snapshot，不接受调用方提供的 index、raw graph、Responsibility candidate 或自行拼装的“已验证”对象。

对源码的admission只能消费Source Program owner在同一exact snapshot上签发的model/fact-shard receipt，并绑定provider、source
revision、configuration/dependency generation、coverage/scope、target identity和unknown frontier。Engineering IR、Policy、Impact、
Review、Projection和测试不得重读源码、重建Program/TypeChecker/AST/import/call graph或直接拼装`observed` Assertion。Source
Program的`derived`表示从物理源码facts确定性推导；Semantic Assertion的`derived`表示canonical semantic rule从受信语义输入
推导，二者不得通过同一个裸字符串或无provenance projection互换。Source Program的unknown永远不能升格为observed/derived authority。

这是target admission invariant。任何Policy或其他consumer直接读取source、调用私有observer或把未认证观察注入IR时，
source-program admission都必须保持unresolved；修复只能让consumer读取canonical validated Fact，不能新增consumer专用AST、graph、
observer receipt或第二language Program。

## 与 Implementation Resolution 的边界

Engineering IR只提供稳定语义和可追溯的实现要求来源：Responsibility、Operation、Type、State、Effect、Permission、Policy、Scenario、Acceptance与required Verification Claim/obligation references。Verification owner从这些引用派生Requirement/Action/Result/Aggregate；实现解析领域从validated语义推导`ImplementationRequirement`并选择具体实现闭包。

固定不变量：

- library/package/version/Adapter、performance rank、support maturity和源码写法不进入Engineering semantic identity；
- Provider manifest、`.d.ts`、源码分析、runtime trace和AI建议不能直接产生authoritative业务Fact；
- 某个Provider无法满足合同只能淘汰候选，不能降低或修改合同；
- 用户要求某个Provider属于Implementation constraint/operation input，不自动获得绕过类型、安全、权限或Verification的权力；
- 若依赖升级无法保持原Semantic Contract，必须由Change Management产生显式Semantic Migration，而不是在Binding层静默改义；
- Implementation Decision/Binding是可替换、可失效的下游编译状态，不是第二Engineering IR。

### 声明与现实闭环

```text
validated Effect / Permission / Transition Fact
≠ implementation
≠ Effect authorization
≠ physical execution
≠ Verification / readback
```

Engineering IR及其Projection由于类型、模块与可达capability边界不具备Effect、Evidence或completion authority；不得为了表达无权而给每个对象复制可伪造的`authority=none`字段。只有冻结的
ImplementationBinding、authorized Operation、canonical Effect owner receipt、environment-bound Evidence与exact readback共同闭合，
产品/Support owner才能推进相应状态。Evidence可以形成新的observed Assertion或下游decision input，不能反向升级原Assertion authority。

## 与其他模型的边界

- Physical Workspace 表达文件、配置、资源和物理 owner；不自动成为 Engineering IR。
- Source Program Model 表达模块、符号、类型、引用、flow candidate和`observed | derived | unknown` source facts；它只通过exact receipt进入IR admission，不自动成为 Engineering IR。
- Responsibility reconstruction产生 candidate；显式 authority决定后才进入 canonical semantics。
- Implementation Requirement/Decision/Binding表达具体实现选择，不重新拥有Engineering identity或Semantic Contract。
- Target/Application/Behavior/Program IR 表达编译计划和目标程序，不重新拥有 Engineering identity 或 authority。
- ExplainGraph、SemanticView 和 ReviewSummary 是可丢弃投影。
- Evidence Ledger 拥有 evidence record、freshness、coverage、bias、expiry 和 invalidation；Engineering IR 只保存 assertion 对 evidence identity 的引用。
- Fact Delta 比较两个 validated semantic endpoints；Impact 在独立规则 registry 下传播，不能由 UI、Implementation Resolver或 changed-file selector替代。
