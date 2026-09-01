---
title: Semantic / Implementation Delta 与 Impact
status: stable
domain: delta-and-impact
---

# Semantic / Implementation Delta 与 Impact

本文拥有 canonical semantic change、Implementation Binding change、影响传播、certainty、unknown frontier 与 Verification recommendation reference 的稳定含义。精确 union、diagnostic、rule registry、canonical ordering 和 revision payload只由对应machine contract与唯一Domain producer拥有；测试不建立第二shape或identity owner。

Pure Delta output与durable/public receipt是不同capability：前者只需validated endpoints、唯一comparator与typed consumer；后者还必须有strict nested parser、writer/readback、provenance和migration。Entity、Fact、Binding与Implementation Impact只有在各自真实endpoint type、producer/comparator、validator、consumer和Verification闭合后才能激活。本文不保存current/legacy清单；Documentation maturity projection在其machine owner真实激活前也不能被引用为现有authority。未激活对象不能被内部seed、类型名、schema字面或测试投影成公共Delta。

Delta、Impact、Recommendation和memo的类型、模块边界与可达capability都不得授予Effect、Evidence、Scope或Compatibility authority；除非真实consumer需要可验证的negative proof，不为每个projection复制可伪造的`authority=none`字符串。它们只产生required/unknown closure；任何测试、Provider、写入、迁移、发布或cleanup Effect都必须重新经过相应owner的authorization、ActionPlan、preimage/CAS、settlement和readback。

本文只比较 independently validated endpoints 并传播变化，不拥有：

- Semantic Contract 或 Engineering authority；
- Implementation candidate eligibility、ResolutionPolicy、ResolutionDecision或Binding选择；
- Compatibility结论、Migration、compensation或retirement决策；
- 测试命令、Verification Result、发布或Support Claim。

## 不同变化对象

以下对象必须分离：

- **Authoring Delta**：Contract、Plan、Manifest、Policy、Source bytes、用户implementation constraints等输入变化；
- **Entity change**：canonical Entity identity、kind、attributes或lifecycle变化；只有注册独立machine contract/owner后才成为公共Entity Delta，否则只是Fact Delta/Impact内部typed seed projection；
- **Fact Delta**：Fact triple和Assertions变化；
- **Semantic Impact**：canonical变化可能影响的semantic consumers和Acceptance；
- **ImplementationBindingDelta**：两个validated exact Binding集合之间的结构变化；
- **Implementation Impact**：Binding变化对Responsibility、Artifact、dependency、runtime、Verification、release和support surfaces的传播；
- **Repository/Test Impact**：source/artifact/Gate/test文件与physical owner传播；
- **Artifact Delta**：生成文件、配置、package和release bytes变化；
- **Runtime Observation Delta**：特定环境下观察结果变化；
- **Verification Result**：是否满足某个exact requirement；
- **Compatibility Decision**：Change Management基于Delta、Evidence和规则作出的兼容性裁决。

它们可以通过stable references连接，但不能把其中一个对象改名为另一个。Changed files不是Fact Delta或Binding Delta；planned Impact不是actual Delta；测试绿也不证明Delta符合intent或兼容。

## Fact Delta 身份

Fact Delta比较两个transaction-referenced、独立validated semantic endpoints：

```text
from semantic snapshot/revision
→ deterministic comparison
→ to semantic snapshot/revision
```

Delta identity至少绑定from/to graph/app/semantic revisions、comparator contract revision和canonical payload digest。它不绑定branch、PR、UI排序、wall-clock或运行进程。

Producer必须验证两端属于可比较lineage和相同semantic format/app identity；无法证明lineage时拒绝，不按显示名、路径或相似度匹配对象。

## Canonical Fact / Assertion 变化

- 新triple：Fact added；
- 消失triple：Fact removed；
- subject/predicate/object变化：旧Fact removed + 新Fact added；
- 新来源/authority/provenance claim：Assertion added；
- 当前active snapshot中claim消失：Assertion removed；跨revision validity transition只有独立历史lineage contract实现后才存在；
- 同一Assertion identity的confidence、evidence references或允许更新字段变化：Assertion updated；
- canonical payload完全相同：retained，不产生变化项。

Fact identity不包含authority/confidence/provenance；因此这些变化不能伪装成新triple。反之，object value或target Entity变化必须形成新Fact，不能只改Assertion。

Entity-only变化允许Fact Delta为空。空Fact Delta只表示Fact/Assertion集合未变，不表示Implementation Binding、Artifact、Repository、UI、performance或runtime无变化。

## Conditional ImplementationBindingDelta contract

`ImplementationBindingDelta`只比较同一implementation scope下的两个independently validated Binding endpoints：

```text
from ImplementationBinding set
→ deterministic binding comparator
→ to ImplementationBinding set
```

它回答“具体实现闭包发生了什么结构变化”，不回答“这些变化是否兼容、是否应接受或怎样迁移”。

### Activation census dimensions

下列项目只是首个真实producer/consumer activation时必须完成的census dimensions，不是预先冻结的字段schema、exact key set或public union；machine contract只能从届时真实endpoint与consumer闭包导出最小required shape：

- semantic/Application/Behavior requirement revisions；
- Target Profile与Type Algebra revisions；
- ResolutionDecision与ImplementationBinding revisions；
- implementation scope / capability / Responsibility references；
- Provider/package/existing/custom/reference identity；
- exact version、integrity、Adapter和configuration revision；
- Implementation Resolution owner签发的可选Block-delivery binding references；
- dependency/peer/native/install/build closure；
- Effect、Permission、resource、Target和support references；
- source/artifact owner与Verification/conformance references。

Binding Delta identity至少由：

```text
scope identity
+ from Binding-set revision
+ to Binding-set revision
+ comparator contract revision
+ canonical delta payload
```

派生。它不得包含PR、branch、wall-clock、候选发现顺序、UI排序、Map/Set插入或ambient package cache。

若两个endpoint的scope、format、semantic requirement lineage或Target comparison boundary无法证明可比较，producer必须拒绝，不能按包名、Capability显示名或相似API强行配对。

### Change dimensions

下列是activation需要证明能够表达的变化维度，不是稳定文档拥有的exact discriminant union；首个真实machine contract可在不丢失这些语义的前提下选择更小的canonical representation：

- Binding出现、消失或完整保留；
- Provider、version/integrity、Adapter或configuration identity变化；
- Target、Block binding或dependency closure变化；
- Effect、Permission、resource或support Evidence变化；
- 无法唯一匹配、coverage不足或endpoint冲突形成的unknown。

一个Binding可以同时产生多个facet变化，但canonical item identity必须稳定，不能因输出顺序重复记录同一变化。

### Producer 不变量

Binding Delta producer必须：

- 只接受validated、deep-frozen Binding endpoints；
- 不重新运行Resolver、不重新枚举Provider、不修改Binding；
- 保留明确from→to方向；
- 对duplicate、collision、non-canonical order和unresolved reference fail closed；
- 对集合使用stable identity比较，对有序configuration保留顺序语义；
- 输出sorted unique、deep-frozen、byte-stable结果；
- 保留两端Decision、Binding、Evidence和owner references；
- 对unsupported endpoint/comparator identity返回diagnostic，不生成空Delta；
- 不把semver、类型兼容、测试通过或作者声明转化为Compatibility结论。

## Delta Producer 通用不变量

所有Delta producer必须：

- 只接受validated、deep-frozen endpoints；
- 保留明确from→to方向；
- 不修改、修复或重新normalize输入；
- 对identity collision、duplicate和non-canonical order fail closed；
- 输出sorted unique、deep-frozen、byte-stable结果；
- 保留provenance到两端对象和transaction/candidate；
- 对unsupported endpoint/comparator contract或digest返回diagnostic，不生成空Delta；只有真实raw/durable receipt parser激活后才存在schema rejection。

Mutation request、AI proposal、Agent/CLI interface、Review、Resolver和test selector不能提交或覆盖actual Delta。它们只能声明expectation或消费canonical producer结果。

## Expectation 与 Actual Delta

Mutation或Migration计划可以包含预期变化，例如required/forbidden Fact、预期Binding替换或允许的additional changes。Actual Delta只有在isolated canonical rebuild和re-resolution后由统一producer计算。

判定至少区分：

- exact expected change出现；
- required change缺失；
- forbidden change出现；
- 额外变化在显式allowance内；
- unexplained semantic或Binding change；
- from/to lineage、source mapping或Binding scope失效。

Unexplained additional change默认阻止发布。不能因为测试通过、文本diff较小、package版本看似合理或AI称其合理而忽略。

## Impact 输入与输出

Semantic Impact只消费唯一owner签发的canonical typed outputs：

- branded validated semantic endpoints；
- canonical Fact Delta output；
- canonical propagation rule-set identity/digest；
- explicit uncertainty和scope policy。

只有真实跨进程、持久readback或独立provenance consumer存在时，某个output才升级为receipt，并必须拥有schema、issuer、producer generation、digest与readback。caller不得提供或持久化第二index；唯一canonical index函数可以从branded snapshot构造一次ephemeral bounded projection。未来Entity/Binding Delta、Binding-set或cross-domain receipts只有在其后继合同激活后才能加入输入。

target contract输出至少表达：

- seed change；
- direct和transitive occurrences；
- impacted Entity/Fact/Responsibility/Operation/Scenario/Acceptance；
- impacted Implementation Requirement/consumer/Artifact/dependency/package/runtime/release/support surface；
- certainty与reason；
- canonical witness path；
- unknown frontier和停止原因；
- Verification recommendations；
- rule/graph/Binding revisions与completeness diagnostics。

Impact是保守静态推导，不是运行结果、Compatibility结论、迁移计划或业务风险分数。

Impact validator必须验证branded boundary、schema、digest、endpoint binding、canonical rule-set identity和已激活的producer/issuer provenance。它不得重新运行Fact/Entity/Binding comparator、重新解析raw IR、建立替代graph/index算法或持久化第二index。通过唯一canonical index函数从branded snapshot构造一次ephemeral bounded projection是允许的；任何内部重算Delta或merge-join endpoints的路径都不满足canonical admission。

## Conditional Implementation Impact contract

Binding变化至少可以传播到：

- 使用该Binding的Target Program nodes与Backend recipes；
- generated source、config、tests与Artifact owner；
- Dependency/Materialization owner签发的package/lock/materialization artifact references与clean install surface；
- Host、Toolchain、Target、Runtime Environment与native/browser/container capability；
- Effect、Permission、secret、network、filesystem、process和resource boundaries；
- Provider/Adapter conformance、security、license、SBOM和supply-chain Claims；
- deployment、release、Support Claim与retirement；
- 用户可见Implementation View、Context Packet与Migration preview。

传播规则只能依赖稳定references。不能因两个包名称相似、API签名相同、版本号相近或生成源码未变化而断言无Impact。

Implementation Impact只输出受影响面、certainty、witness和unknown；Change Management再结合Compatibility rules、用户decision和physical Evidence产生其canonical Compatibility Decision或Migration reference。本文不复制Change Management的outcome discriminants。

## Rule Registry

每种可传播predicate/relationship/Binding facet只有一个canonical规则owner。每个active rule的identity由其canonical predicate/direction/condition/certainty-transform/boundary payload与producer generation派生；测试和validator不得再维护一份expected tuple清单。规则声明：

- 适用change kinds；
- from/to endpoint选择；
- traversal direction；
- subject/object/Binding kinds和conditions；
- certainty transformation；
- boundary/stop条件；
- Verification mapping或无mapping；
- negative和cycle tests。

Predicate signature、Provider manifest和Binding schema只定义合法shape，不拥有Impact方向。UI edge direction、源码调用方向、semantic dependency方向和implementation dependency方向可能不同，不能按名称猜测。

未注册active predicate/facet、unsupported object、missing reference或rule conflict形成unknown frontier；不得默认为不传播。

Rule registry的identity、canonical content digest与producer generation用于失效和复用；任一传播语义变化必须改变digest，纯canonical ordering变化不得改变digest。只有存在真实持久、跨进程、外部或迁移consumer时才建立独立format/version、dispatcher和兼容reader。算法或规则变化本身不自动产生`Vn`名称。

## Addition、Removal 与 Update

- Addition主要在新端传播，因为新依赖/行为/Binding只存在于to graph；
- Removal主要在旧端传播，以发现失去的consumer/guarantee/implementation；
- Assertion update需要根据authority、validity、confidence/evidence语义选择旧端、新端或双端；
- Binding replacement通常双端传播：旧端查找被退役consumer和guarantee，新端查找新增要求、Effect和dependency；
- Entity或Provider replacement需要显式replacement/migration relation，不能按同名拼接两端；
- 同一change可能生成多个occurrences，但canonical summary按identity去重。

## Certainty

certainty contract只有在每个occurrence的certainty、completeness与budget/cutoff均可机器验证后才能激活；空uncertainty、空occurrence或空recommendation不能支持not-run。激活后Impact至少区分：

- **definite**：由authoritative/derived canonical relation、validated Binding reference和确定规则传播；
- **possible**：依赖observed/inferred、optional route、dynamic dispatch、candidate evidence或不完备coverage；
- **unknown**：缺rule、coverage、reference、Provider freshness、Binding endpoint或存在冲突，无法安全判断。

Inferred/observed-only relation不能升级为definite transitive edge。多个possible路径一致也不能多数票升格。Definite路径遇到unknown boundary时，已证明前缀保持definite，但边界后的结论仍unknown。

Risk、severity、priority、Compatibility和business cost是独立决策层，不得塞进certainty字段。

## Cycle 与 Fixpoint

Engineering/implementation graph可以有cycle。Impact必须使用visited state和monotone certainty/fact lattice收敛到有限fixpoint：

- 不因cycle无限展开；
- 同一occurrence选择最短、稳定、可解释的canonical witness；
- 多条路径可保留计数或references，但不复制相同impact item；
- rule产生非单调状态或无限新identity时validator拒绝；
- cutoff/预算耗尽必须形成unknown frontier，不能返回“完整”。

## Verification Recommendation

Semantic Impact只能推荐owner-issued canonical Acceptance或Verification reference；raw selector string不能驱动Verification Effect。Recommendation只有在Verification owner已经签发branded strict reference后，才能转发Requirement/Claim、Gate capability、Acceptance或cross-domain owner reference；Impact不解释其字符串，也不拥有测试文件路径、suite、selector grammar、command、argv、execution result或merge decision。

Recommendation来源必须可解释：哪条change、哪条rule、哪个consumer/Acceptance/Binding facet导致。最终可执行计划由Verification/Gate/Test Impact owner结合Repository、platform、Target、Binding和Evidence重算。

没有推荐不等于无需验证；只有Impact完整、相关rule明确声明无Verification requirement且其他domain无影响时，才可支持not-run判断。

## Cross-domain Impact

Semantic / Binding Delta可以通过stable references触发：

- source owner和generated Artifact；
- package/lock与runtime materialization；
- Documentation contract/projection；
- Workflow/Gate applicability；
- Agent Operation/Task Envelope；
- Release/public API/deployment/support；
- Product Decision/metric；
- Evidence freshness/invalidation；
- Compatibility/Migration requirement。

跨域传播由相应domain rule/adapter拥有。Semantic/Implementation Impact不能直接扫描changed files建立第二Repository graph；Repository Test Impact也不能从import graph推断semantic authority、Binding或Compatibility。

## Predicted、Actual 与 Runtime

- **Predicted Semantic / Implementation Impact**：apply前对计划、候选Decision/Binding和当前graph的保守推导；
- **Actual Semantic / Binding Delta**：isolated/live rebuild与re-resolution后由validated endpoints比较；
- **Actual Semantic / Implementation Impact**：对actual Delta重新传播；
- **Artifact/Runtime Impact**：生成物和物理Acceptance结果；
- **Residual Impact**：验证后仍未消除的unknown、unsupported或risk。

Apply后必须重新计算actual而非沿用predicted。Predicted遗漏、actual出现额外change、Binding不同于planned或runtime反例都要求更新rule/owner/coverage；不能只在UI追加warning。

## 性能与增量

Delta/Impact可以有incremental index和cache，但clean full computation是语义基准。Cache key绑定endpoint、graph/Binding/rule revisions和input closure；unknown dependency只扩大失效。Incremental/clean结果必须canonical等价，cache缺失或损坏回到clean，不返回旧结果。

性能优化不能缩短unknown frontier、限制图深度而仍声明complete，或只保留一个偶然路径丢失独立consumer。

Impact memo/cache只保存由canonical outputs派生的可失效projection；它不签发Delta、Impact、Verification或completion authority。命中memo只重验endpoint/Delta identity、validated snapshot identity、rule-set digest/producer generation、scope、coverage与unknown frontier；损坏或foreign memo只能被忽略或typed拒绝，不能成为第二结果owner。memo返回canonical Impact后，Verification builder才可消费其revision/reference生成ActionKey，Impact memo不得反向依赖ActionKey。

## Revision 与 identity 分域

- endpoint semantic/Binding revision标识被比较的validated状态；
- Delta revision/digest标识from→to comparator结果；
- Impact revision/digest标识Delta、graph/rule receipts和unknown frontier的传播结果；
- memo/cache key只定位可失效的派生projection；
- Verification `ActionKey`由Verification canonical builder根据实际normalized operation、subject/input closure、producer/contract、environment/provider/tool与dependency topology生成；Delta/Impact只提供该builder消费的revision/reference，不拥有或复制ActionKey payload。whole candidate/tree只有在Gate真实读取全树时才进入subject closure，ActionPlan不能作为未规范化整体反向进入ActionKey。

这些identity可以互相引用，但不能复用同一裸字符串或由下游建立第二算法。trusted consumer可以调用同一个canonical builder重算并验证；版本后缀、branch、PR、wall-clock、UI排序和cache位置都不能替代其中任何一个。

## 消费者与 activation boundary

registered consumers只从authority registry、Source Program/module graph与operation/capability registrations派生；stable文档不维护
consumer名单。consumer可以过滤、聚合和投影，但必须保留source/Binding change、certainty、witness、unknown和revision references，
不得建立第二comparator、传播switch、Compatibility truth或风险真值，也不能反向改写actual Delta。

任一Delta/Impact capability只有在以下闭包同时成立后才能激活：

- exact validated endpoints、lineage、direction、唯一producer/comparator与canonical identity完整；
- strict validator、真实consumer、positive/negative/failure/property proof与clean/incremental等价闭合；
- collision、unsupported、unknown、budget与incomplete coverage fail closed，不生成空证明；
- Impact不重跑Delta comparator、不解析raw IR、不持久化第二graph/index，Recommendation只转发owner-issued references；
- predicted与actual分离，额外变化可阻止publish，Compatibility/Migration仍由Change Management裁决；
- 反特化coverage由canonical property/generator与TestImpact closure证明，没有该proof时保持unknown。

任何一项缺失都只能产生unresolved admission，不能因类型存在、byte-stable、测试通过或stable文档存在而称为supported capability。
