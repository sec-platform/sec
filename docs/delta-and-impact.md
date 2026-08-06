---
title: Semantic / Implementation Delta 与 Impact
status: stable
domain: delta-and-impact
last-reviewed: 2026-08-06
---

# Semantic / Implementation Delta 与 Impact

本文拥有 canonical semantic change、`ImplementationBindingDelta`、影响传播、certainty、unknown frontier 与 Verification recommendation 的稳定含义。精确 union、diagnostic、rule registry、canonical ordering 和 revision payload由对应代码合同、Compiler/Domain producers及合同测试拥有。

本文只比较 independently validated endpoints 并传播变化，不拥有：

- Semantic Contract 或 Engineering authority；
- Implementation candidate eligibility、ResolutionPolicy、ResolutionDecision或Binding选择；
- Compatibility结论、Migration、compensation或retirement决策；
- 测试命令、Verification Result、发布或Support Claim。

## 不同变化对象

以下对象必须分离：

- **Authoring Delta**：Contract、Plan、Manifest、Policy、Source bytes、用户implementation constraints等输入变化；
- **Entity Delta**：canonical Entity identity、kind、attributes 或 lifecycle变化；
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
- claim撤销或有效区间终止：Assertion removed或明确validity transition；
- 同一Assertion identity的confidence、evidence references或允许更新字段变化：Assertion updated；
- canonical payload完全相同：retained，不产生变化项。

Fact identity不包含authority/confidence/provenance；因此这些变化不能伪装成新triple。反之，object value或target Entity变化必须形成新Fact，不能只改Assertion。

Entity-only变化允许Fact Delta为空。空Fact Delta只表示Fact/Assertion集合未变，不表示Implementation Binding、Artifact、Repository、UI、performance或runtime无变化。

## ImplementationBindingDelta

`ImplementationBindingDelta`只比较同一implementation scope下的两个independently validated Binding endpoints：

```text
from ImplementationBinding set
→ deterministic binding comparator
→ to ImplementationBinding set
```

它回答“具体实现闭包发生了什么结构变化”，不回答“这些变化是否兼容、是否应接受或怎样迁移”。

### Endpoint 与 identity

每个endpoint至少绑定：

- semantic/Application/Behavior requirement revisions；
- Target Profile与Type Algebra revisions；
- ResolutionDecision与ImplementationBinding revisions；
- implementation scope / capability / Responsibility references；
- Provider/package/existing/custom/reference identity；
- exact version、integrity、Adapter和configuration revision；
- BlockProviderBinding references；
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

### Binding change kinds

至少区分：

- `added`：原scope没有Binding，新端出现；
- `removed`：旧Binding不再存在；
- `retained`：完整canonical payload相同；
- `provider-replaced`：Provider/existing/reference/custom实现identity改变；
- `version-changed`：相同Provider identity的exact version/integrity改变；
- `adapter-changed`：Adapter identity/revision或mapping配置改变；
- `configuration-changed`：会影响行为、资源、Target或生成的配置改变；
- `target-binding-changed`：Target/Profile/runtime/module/delivery binding改变；
- `block-binding-changed`：引用的BlockProviderBinding改变；
- `dependency-closure-changed`：dependency/peer/native/install/build闭包改变；
- `effect-permission-resource-changed`：声明或验证的Effect、Permission、resource boundary改变；
- `support-evidence-changed`：support/conformance/security/license/freshness references改变；
- `ambiguous | unknown`：无法唯一匹配、coverage不足或endpoint存在未解决冲突。

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
- 对unsupported format或comparator revision返回diagnostic，不生成空Delta；
- 不把semver、类型兼容、测试通过或作者声明转化为Compatibility结论。

## Delta Producer 通用不变量

所有Delta producer必须：

- 只接受validated、deep-frozen endpoints；
- 保留明确from→to方向；
- 不修改、修复或重新normalize输入；
- 对identity collision、duplicate和non-canonical order fail closed；
- 输出sorted unique、deep-frozen、byte-stable结果；
- 保留provenance到两端对象和transaction/candidate；
- 对unsupported format或rule revision返回diagnostic，不生成空Delta。

Mutation request、AI proposal、Workbench、Review、Resolver和test selector不能提交或覆盖actual Delta。它们只能声明expectation或消费canonical producer结果。

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

Semantic / Implementation Impact消费：

- canonical Fact/Entity/Binding Delta；
- from/to validated semantic graphs与Binding sets；
- versioned propagation rule registry；
- Target/Profile/Repository/Artifact/Runtime/Verification cross-domain references；
- explicit uncertainty和scope policy。

输出至少表达：

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

## Implementation Impact

Binding变化至少可以传播到：

- 使用该Binding的Target Program nodes与Backend recipes；
- generated source、config、tests与Artifact owner；
- package.json/lock/materialization request和clean install surface；
- Host、Toolchain、Target、Runtime Environment与native/browser/container capability；
- Effect、Permission、secret、network、filesystem、process和resource boundaries；
- Provider/Adapter conformance、security、license、SBOM和supply-chain Claims；
- deployment、release、Support Claim与retirement；
- 用户可见Implementation View、Context Packet与Migration preview。

传播规则只能依赖稳定references。不能因两个包名称相似、API签名相同、版本号相近或生成源码未变化而断言无Impact。

Implementation Impact只输出受影响面、certainty、witness和unknown；Change Management再结合Compatibility rules、用户decision和physical Evidence裁决：contract-preserved、adapter-preserved、provider-switch或semantic-migration。

## Rule Registry

每种可传播predicate/relationship/Binding facet只有一个版本化规则owner。规则声明：

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

## Addition、Removal 与 Update

- Addition主要在新端传播，因为新依赖/行为/Binding只存在于to graph；
- Removal主要在旧端传播，以发现失去的consumer/guarantee/implementation；
- Assertion update需要根据authority、validity、confidence/evidence语义选择旧端、新端或双端；
- Binding replacement通常双端传播：旧端查找被退役consumer和guarantee，新端查找新增要求、Effect和dependency；
- Entity或Provider replacement需要显式replacement/migration relation，不能按同名拼接两端；
- 同一change可能生成多个occurrences，但canonical summary按identity去重。

## Certainty

Impact至少区分：

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

Impact可以推荐Acceptance、semantic selector、implementation conformance Claim、Gate capability或cross-domain owner，但不拥有测试文件路径、command、execution result或merge decision。

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

## 消费者边界

Workbench、Review、Mutation、Implementation Resolver、Change Management、Compiler Incremental Graph、changed-file test selection、Release planner和AI Context Packet都消费统一Delta/Impact结果。

消费者可以过滤、聚合和投影，但必须保留source change、Binding change、certainty、witness、unknown和revision references；不得建立第二comparator、传播switch、Compatibility truth或“最高风险”真值。Implementation Resolver只消费Impact用于失效和后续选择输入，不能让ResolutionDecision反向改写已计算的actual Delta。

## 验收

- 同一validated endpoints/rules产生byte-stable Fact Delta、ImplementationBindingDelta和Impact；
- added/removed/assertion update/entity-only/Binding replacement方向正确；
- Requirement、Decision、Binding与Delta identity分域；
- Comparator不重新运行Resolver，不按包名/semver/API相似度猜匹配；
- authority/confidence/provenance不被strongest-wins压缩；
- unknown predicate/reference/coverage/Binding endpoint fail closed；
- Provider/Adapter/version/config/Target/dependency变化传播到所有真实consumer；
- cycles收敛且canonical witness稳定；
- inferred/observed不升格为definite；
- predicted与actual分离，额外Delta可阻止publish；
- Compatibility和Migration只由Change Management消费Delta后裁决；
- clean/incremental等价；
- consumer不能提交或重算canonical结果；
- 至少三组无关业务模型、两个实现替换场景和一个Brownfield unknown/opaque场景验证反特化。
