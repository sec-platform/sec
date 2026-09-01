---
title: 编译器与目标 IR
status: stable
domain: compiler-target-ir
---

# 编译器与目标 IR

本文拥有消费Semantic owner签发的validated snapshot receipt后所进行的Pipeline、Target Profile、Type Algebra、Application/Behavior IR、Implementation Resolution、Target Program IR、Backend与deterministic target lowering职责边界。Engineering IR shape、normalization、builder、validator、revision和admission不属于Compiler owner。实现与成熟度事实只由exact-tree machine Evidence判定，不由本文声明。

## Pipeline

validated Engineering IR snapshot receipt → application/behavior lowering → Implementation Requirements → bounded candidate closures →
hard eligibility/policy/tie-break → Resolution Decision → frozen ImplementationBinding → Target Program → deterministic artifact/dependency/verification plans。

Compiler authority终止于Target Program与确定性计划。它拥有pure stage order、typed inputs/outputs、cache invalidation、cancellation和
只记录pure scheduling及外部receipt references的stage journal；不取得filesystem、process、network、package-manager、workspace writer、
Verification executor、Effect grant、publication或recovery authority。

外层Operation/Authorization coordinator消费这些计划并调用Workspace、Runtime、Dependency、Verification、Mutation与publication owner。
物理Effect、settlement和readback保持在各自owner；Verification failure不能反向跳回同一Compiler journal。repair若发布exact新authoring
revision，外层coordinator必须以新input identity启动新的Compiler invocation/epoch，只复用仍fresh的pure结果。

这是stable target contract，不声明current implementation已经满足。精确stage、producer/consumer、legacy residue、module cycle、facade、
Block coupling与activation状态只能由exact-tree generated maturity projection给出；该projection未materialize时保持unresolved，不能由
本文、目录名、barrel、schema字段或测试绿色补成implemented。

## Target Profile

Target Profile 是生成目标的 canonical capability 输入，与执行 SEC 的 Host Runtime、仓库 Toolchain Provider 和可选 native adapter 分离。至少显式描述：

- language 与 language revision；
- runtime family/version range；
- module system 与 package manager；
- delivery/package/container；
- persistence、network、thread/process与resource能力；
- UI/server/browser能力；
- verification、deployment与platform requirements。

未知字段、未知组合或缺失 capability 确定性拒绝，不回退到当前 Host、默认框架或已有模板。

## Type Algebra

Type Algebra 拥有跨层类型 identity、canonical normalization、compatibility、nullability、collection/object/function shape、serialization 与 Target mapping。

进入 validated Type Algebra 前必须通过：唯一 identity、引用完整性、递归/循环规则、稳定 ordering、unsupported diagnostic 与 deep-freeze。Implementation Resolver、Adapter和Backend都不能按字符串名称重新猜类型。

## Application IR

Application IR 表达目标无关的应用结构：component/service/module、Responsibility、State、Operation、Data、Policy、Permission、Effect、Scenario 与依赖关系。

Promotion 条件：

1. upstream Engineering IR / Contract 已 validated；
2. 每个 Application node 可追溯到 canonical facts/assertions；
3. ownership、lifecycle、state writer 与 public boundary 唯一；
4. unknown/opaque 不被自动补全；
5. identity/revision 不含 Target、临时路径、UI布局或运行时间。

## Behavior IR

Behavior IR 只表达 SEC 能完整验证和 lowering 的受限行为，包括控制流、数据流、state transition、effect、error、authorization 与 transaction boundary。

允许进入的行为必须有：

- 明确输入/输出与类型；
- 可枚举 Effect 与权限；
- 确定性状态转换和错误协议；
- Target-independent verification oracle；
- 可追溯 source mapping。

复杂算法、动态反射、运行时拼接、任意外部代码或无法建模的副作用进入 Governed Extension 或 Opaque Boundary。扩展必须声明接口、Effect、capability、source owner、required Verification Claim/obligation references和rollback；具体Requirement、applicability、ActionKey、runner与Result仍由Verification owner派生。不能为了“支持一切”无限扩张 Behavior IR。

## Implementation Resolution

Implementation Resolution 是 validated Engineering/Application/Behavior requirements 与 Target Program IR 之间的唯一实现选择边界。它回答“由哪个具体实现闭包完成已经冻结的语义”，不拥有产品意图、Semantic Contract、Engineering identity、Target物理支持、Registry trust、package安装、Binding Delta、Compatibility判断、Verification结果或Artifact发布。

权威链固定为：

```text
validated Semantic / Application / Behavior inputs
→ derive Implementation Requirements
→ discover canonical candidate closures
→ hard eligibility evaluation
→ preserve unknown / conflict frontier
→ policy-specific optimization
→ deterministic tie-break
→ freeze Resolution Decision
→ freeze exact Implementation Binding
→ Target Program IR
```

### Canonical 对象

该领域在出现真实 producer/consumer 时逐项建立独立 raw/validated contract，至少包括：

- **ImplementationRequirement**：从validated上游推导的实现需求，绑定语义、类型、Effect、Permission、Target与owner-issued required Verification Claim/obligation references；
- **ImplementationConstraint**：不可被优化抵消的硬约束，如Target、security、license、dependency、resource、portability和version；
- **ImplementationPreference**：只在合格候选间排序的软偏好；
- **ResolutionPolicy**：由Implementation Resolution唯一owner拥有的canonical policy identity；真实选择consumer证明它需要存在，只有满足Change Management版本存在证明时才建立revision/dispatcher；
- **ImplementationCandidate**：完整实现闭包，而不是包名，至少绑定Provider/Reference/Existing/Custom来源、版本、Adapter、配置、dependency、Target、Effect、resource、support和migration要求；
- **EligibilityResult**：`eligible | ineligible | unknown | unsupported | conflicted`及witness；
- **ResolutionDecision**：候选集合、淘汰原因、所用policy、measurement引用、tie-break和最终选择解释；
- **ImplementationBinding**：精确Provider/package/version/integrity/config/Adapter/Target/dependency-lock/policy references，并可选引用零个或多个冻结的`BlockProviderBinding`；非Block实现没有该引用，且不得复制Block Binding内容。

`Requirement`、`Candidate`、`Decision`、`Binding`是不同identity域。semantic/content identity、revision和ActionKey不自动创建
`Vn`名称、持久`formatVersion`或兼容dispatcher；只有durable、external、cross-process、rolling或migration consumer
满足Change Management版本存在证明时，才由相应唯一owner建立严格schema。候选发现顺序、UI顺序、Registry枚举、
Map/Set插入、locale、时间和ambient cache不得进入canonical identity。

`ImplementationBindingDelta`激活后，旧新Binding的结构变化只由Delta/Impact authority生成；Compatibility、升级路线和Migration由Change Management裁决。激活前Implementation switch typed unavailable，Resolver只能提供已验证的old/new Binding与Decision references，不能签发自己的Delta或兼容性结论。

### 正确性、优化与唯一性

不存在脱离条件的“宇宙唯一最优源码”。唯一性只在以下输入全部冻结后成立：

```text
semantic/application/behavior revision
+ Target Profile revision
+ repository existing-stack revision
+ hard constraints
+ preference / ResolutionPolicy identity or proven content revision
+ eligible Provider catalog and Evidence revisions
+ verified measurement revisions
+ canonical source / Backend revision
```

固定决策顺序：

1. 合同、类型、Target、Effect/Permission、安全、数据、External Provider owner签发的license eligibility、dependency闭包、support和owner等硬条件不满足时淘汰；
2. coverage不足、冲突或无法证明时保留`unknown/conflicted`，不得按“未发现问题”当作合格；
3. 只在合格候选中应用canonical approved policy；具体policy集合由唯一owner和真实consumer派生，不在本文复制枚举或默认创建version域；
4. policy仍无法区分时使用稳定tie-break；
5. 输出完整witness与被淘汰原因。

安全、权限、合同或Target失败不能由性能、下载量、流行度、代码长度、bundle大小或维护活跃度加权抵消。Benchmark只有绑定exact环境、版本、样本、warm/cold与方法后才能参与相应policy。

### 候选来源与 Resolver 分层

候选可以来自：

- SEC Reference Provider；
- official/community/private Provider与Adapter catalog；
- repository已存在并已验证的实现；
- Brownfield Adopted/Governed Source；
- user/organization Custom Provider；
- source/AI分析产生但尚未Adopt的candidate。

Block Capability Resolution与产品Implementation Resolution不得合并成隐式双角色Resolver：

```text
Implementation Resolution构造候选闭包
→ native / reference / existing / custom候选直接进入后续eligibility

若候选是block-delivered
→ 发送受约束的 BlockCapabilityResolutionRequest
→ Block Resolver独立完成Registry trust、version、manifest/resource closure与BlockProviderBinding
→ Implementation Resolver只把返回的冻结Binding reference或typed failure纳入该候选closure
→ 所有候选统一进入hard eligibility与最终Resolution Decision
```

Block Resolver不得理解业务语义、比较原生实现或输出最终产品Decision；Implementation Resolver不得直接搜索live Registry、读取manifest目录或重新选择Block。两者使用不同type、identity、revision、failure与consumer。

没有Block-delivered requirement时必须零Block Resolver调用、零Block manifest/resource/trust observation和零Block Decision/Binding。
Implementation Resolver仍可消费candidate-discovery owner发布的bounded Provider/Adapter catalog projection，但不得直接扫描live Registry。Generator
declaration由capability owner签发，Compiler只消费validated declaration与冻结bindings；Generator不得被要求普遍携带
Block identity。任何普遍强制Block identity的实现都不满足该target contract。

### 无 Adapter 与任意类库

无专用Adapter不等于必须手写全部代码。language-semantic owner可以提供结构化export、call-shape、type与source-binding候选，用户在受治理界面连接参数和返回值后生成满足语言类型合同的external call。

但L1 typed invocation只证明调用shape，不证明Effect、幂等性、retry、timeout、cancellation、security或runtime behavior。用户声明的Contract/Effect形成Governed Extension；静态分析、文档、测试、trace与AI只能产生candidate/Evidence；只有conformance、Target physical tests和治理决策闭合后才成为可自动选择的正式Provider。

### Failure、失效与缓存

至少以下变化使Decision/Binding失效：

- semantic/Application/Behavior、Target或Type Algebra revision；
- user/org constraints、preference或ResolutionPolicy；
- Provider/package/Adapter/catalog revision、integrity、license、安全事件或support状态；
- repository dependency/lock/config/existing-stack；
- benchmark环境、方法、样本或expiry；
- Verification/conformance freshness；
- Backend、printer、canonical source policy；
- source/artifact owner或migration状态。

失效后不得静默沿用旧Binding或自动换成“最像”的Provider。旧结果可以作为historical Evidence保留，但不能继续作为current compilation input。Cache可删除和重建；cache损坏或revision mismatch只能触发clean recomputation，不能获得第二决策authority。

## Target Program IR

Target Program IR 表达目标语言程序结构：package/module、import/export、declaration、type、statement、expression、annotation、resource/config binding 与 artifact ownership。

它只消费validated Application/Behavior IR、Target Profile、Type Algebra和冻结ImplementationBinding的content-addressed referenced closure；不得独立观察Provider/Adapter/catalog revisions，不得重新读取raw Contract、live Registry、package catalog或按业务/库名称补语义和重新选实现。

Promotion 条件：

- 所有上游引用和 Target capability 已解析；
- 每个implementation-dependent node引用validated exact Binding；
- unsupported、unresolved、unknown与conflicted Implementation Resolution均在Target Program promotion前拒绝；只有上游已经validated、显式声明且具有exact binding、owner、Effect与Verification boundary的Governed Extension或Opaque Boundary才能作为普通冻结输入进入lowering，Target Program/emit不得临时创建该边界；
- module/artifact ownership 唯一；
- import/export与symbol identity确定；
- source map/provenance完整；
- canonical ordering与revision通过统一 validator。

## Backend 与 Canonical Source Policy

Backend 负责 Target AST、printer、纯formatter、package/config plan 与canonical bytes。它输出结构化artifact、dependency和
verification plans，不直接执行typecheck、package installation或workspace写入；这些Effect只由Toolchain/Runtime/Workspace/
Verification owner在授权operation中执行并返回typed receipt。Formatter 不能改变程序语义；Backend diagnostic 必须映射回
Target Program IR、ImplementationBinding和上游语义来源。

Canonical Source Policy拥有命名、文件布局、import/declaration ordering、错误表达、printer与formatter options的稳定规则；
只有真实跨版本consumer需要区分时才建立版本身份。它不能重新选择Provider或用表面代码风格改变语义。

同一validated inputs、Target Profile、ImplementationBinding closure digest与compiler options必须产生byte-stable outputs。locale、timezone、cwd、绝对临时路径、Map/Set插入顺序、Host family和wall-clock不得污染canonical bytes。

## Deterministic Lowering

每层具有独立：

```text
raw builder → validator → branded validated snapshot
→ deterministic lowerer / resolver → source/provenance map
```

后层不得重新解释前层authoritative semantics。Lowering与resolution rule以类型、contract与capability分派，不按任何具体业务、品牌、fixture、示例identity或散落的库名分支。反特化由Verification/TestImpact根据受影响语义维度编译property/metamorphic corpus与negative boundary；本文不固定领域名称、样例数量或路径集合。

## 单写者迁移边界

同一Implementation scope只有一个Resolution/Binding owner，同一Artifact只有一个writer。Legacy Generator、旧实现选择路径与新IR
lowering不得长期双写；candidate reconciliation只产生Decision/Binding/byte/semantic/runtime parity Evidence，不能发布第二份truth。
Generator writer切换消费Capability owner的migration contract，durable schema/reader/recovery/retirement消费Change Management contract；本文不复制通用migration状态机。切换完成后旧resolver、writer、入口、任务、test-impact edge与projection必须consumer-zero/unknown-zero并退役。

## Incremental Compilation

Compiler Incremental Graph只优化上述clean deterministic chain：node key绑定真实content、validated revision、pass/options、Target Profile、Requirement/Candidate/Policy/Decision、ImplementationBinding closure与Backend identity/revision。

Incremental path必须经过相同validator、eligibility、policy、tie-break、fixed-point、source mapping和unsupported规则。任何 incremental ResolutionDecision、ImplementationBinding和source result 都必须与相同输入的 clean result byte-equivalent。未知依赖、read failure、schema/pass/provider/policy revision变化只扩大失效；cache状态可删除、可重建且不成为第二语义。

## 验收

- raw/validated边界和唯一producer有机器合同；
- Requirement、Candidate、Eligibility、Decision和Binding具有不同identity；需要跨revision区分时，各自由其owner派生content revision，不共享泛化version；
- current-vs-target maturity由真实producer、consumer、validator和test投影，未实现对象不能被写成supported；
- 当真实catalog包含多个独立合格实现时，Resolver能在同一Target-independent Contract下稳定选择并解释，不冻结候选数量；
- hard constraint失败、unknown、conflict、stale与unsupported全部fail closed；
- `prefer`只影响合格候选，`require/pin`不能绕过hard eligibility；
- selection、tie-break和diagnostics不依赖枚举/Map/文件发现顺序；
- Target Program IR与Backend只能消费冻结Binding；
- Block Resolver、Provider policy、Agent/CLI interface、Adapter和Generator不能建立第二Implementation Resolver；
- 不需要Block-delivered capability时零Block Resolver、Block manifest/resource/trust observation；Provider/Adapter discovery只消费bounded catalog projection，需要Block时只消费冻结Block Binding reference；
- pure Compiler静态可达图不含filesystem/process/network/package manager/workspace writer或Verification executor；
- 每个physical Effect拥有唯一外部owner、authorization、aggregate budget、receipt、readback与terminal settlement；
- repair decision不能直接产生revision；authorized repair Effect的exact readback建立新authoring revision后，外层coordinator以新input identity启动新的Compiler epoch，并在该epoch从最早受影响pure stage计算；没有fresh Verification不得进入lock/publish；
- exact production module graph中Compiler相关SCC、reciprocal pair、reverse-role violation和cross-owner aggregate facade均为零；
- clean/incremental Decision、Binding与byte parity；
- round-trip/typecheck/conformance/runtime acceptance与negative scenarios；
- `ImplementationBindingDelta`激活后，Provider/version变化产生exact Binding Delta、Compatibility Decision和Migration；激活前Provider switch不可用；
- 无关领域模型的property corpus不修改Core业务分支；样例数量由Verification/TestImpact owner派生，不在本文硬编码；
- Extension/Opaque区域不被误标为canonical；
- 同一artifact没有竞争writer，旧选择/生成路径在迁移后物理删除。
