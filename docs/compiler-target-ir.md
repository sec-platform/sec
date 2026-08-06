---
title: 编译器与目标 IR
status: stable
domain: compiler-target-ir
last-reviewed: 2026-08-06
---

# 编译器与目标 IR

本文拥有 Semantic Frontend、Pipeline、Target Profile、Type Algebra、Application/Behavior IR、Implementation Resolution、Target Program IR、Backend 与 deterministic lowering 的职责边界。当前实现事实以 `main` 代码和适用合同测试为准。

## Pipeline

```text
parse → normalize → align → resolve → semantic/build-ir
→ application/behavior lowering
→ implementation resolution
→ target-program lowering
→ compose/adapt → verify → repair? → lock → emit
```

Pipeline Kernel 拥有 stage order、transaction、journal、cancellation 和 failure propagation。Pure builder/lowerer/resolver 不建立第二 coordinator。任何 downstream mutating stage只消费同一 transaction 的 validated semantic context与冻结的实现绑定。

每个阶段必须声明：输入/输出类型、唯一 producer、raw/validated boundary、读取 authority、副作用、diagnostic、cache/invalidator owner 与 recovery。Stage 名称和目录结构本身不构成合同。

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

复杂算法、动态反射、运行时拼接、任意外部代码或无法建模的副作用进入 Governed Extension 或 Opaque Boundary。扩展必须声明接口、Effect、capability、source owner、Verification 和 rollback；不能为了“支持一切”无限扩张 Behavior IR。

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

- **ImplementationRequirement**：从validated上游推导的实现需求，绑定语义、类型、Effect、Permission、Target与Verification requirement；
- **ImplementationConstraint**：不可被优化抵消的硬约束，如Target、security、license、dependency、resource、portability和version；
- **ImplementationPreference**：只在合格候选间排序的软偏好；
- **ResolutionPolicy**：版本化的官方选择政策；
- **ImplementationCandidate**：完整实现闭包，而不是包名，至少绑定Provider/Reference/Existing/Custom来源、版本、Adapter、配置、dependency、Target、Effect、resource、support和migration要求；
- **EligibilityResult**：`eligible | ineligible | unknown | unsupported | conflicted`及witness；
- **ResolutionDecision**：候选集合、淘汰原因、所用policy、measurement引用、tie-break和最终选择解释；
- **ImplementationBinding**：精确Provider/package/version/integrity/config/Adapter/Target/BlockBinding/dependency-lock/policy revisions。

`Requirement`、`Candidate`、`Decision`、`Binding`是不同identity/revision域。候选发现顺序、UI顺序、Registry枚举、Map/Set插入、locale、时间和ambient cache不得进入它们的canonical identity。

旧新Binding的结构变化由Delta/Impact authority生成`ImplementationBindingDelta`；Compatibility、升级路线和Migration由Change Management裁决。Resolver只能提供已验证的old/new Binding与Decision references，不能签发自己的兼容性结论。

### 正确性、优化与唯一性

不存在脱离条件的“宇宙唯一最优源码”。唯一性只在以下输入全部冻结后成立：

```text
semantic/application/behavior revision
+ Target Profile revision
+ repository existing-stack revision
+ hard constraints
+ preference / ResolutionPolicy revision
+ eligible Provider catalog and Evidence revisions
+ verified measurement revisions
+ canonical source / Backend revision
```

固定决策顺序：

1. 合同、类型、Target、Effect/Permission、安全、数据、许可证、dependency闭包、support和owner等硬条件不满足时淘汰；
2. coverage不足、冲突或无法证明时保留`unknown/conflicted`，不得按“未发现问题”当作合格；
3. 只在合格候选中应用`stable | minimal | existing-stack | portable | performance | strict-security`等版本化policy；
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
Implementation Resolution
→ 选择 native / reference / existing / custom / block-delivered 实现族

若选择 block-delivered
→ 发送受约束的 BlockCapabilityResolutionRequest
→ Block Resolver独立完成Registry trust、version、manifest/resource closure与BlockProviderBinding
→ Implementation Resolver只引用返回的冻结Binding
```

Block Resolver不得理解业务语义、比较原生实现或输出最终产品Decision；Implementation Resolver不得直接搜索live Registry、读取manifest目录或重新选择Block。两者使用不同type、identity、revision、failure与consumer。

### 无 Adapter 与任意类库

无专用Adapter不等于必须手写全部代码。TypeScript Source Program Provider可以提供`ExportedSymbol`、signature、overload、type/reference/span与`TypedInvocation`候选，用户在结构化界面连接参数和返回值后生成type-correct external call。

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

它只消费 validated Application/Behavior IR、Target Profile、Type Algebra、冻结的ImplementationBinding与相应Provider/Adapter revisions；不得重新读取 raw Contract、live Registry、package catalog或按业务/库名称补语义和重新选实现。

Promotion 条件：

- 所有上游引用和 Target capability 已解析；
- 每个implementation-dependent node引用validated exact Binding；
- unsupported 已在 emit 前拒绝，unknown与conflicted同样在emit前拒绝或进入显式Opaque/Governed boundary；
- module/artifact ownership 唯一；
- import/export与symbol identity确定；
- source map/provenance完整；
- canonical ordering与revision通过统一 validator。

## Backend 与 Canonical Source Policy

Backend 负责 Target AST、printer、formatter、typecheck、package/config lowering 与最终 bytes。Formatter 不能改变程序语义；Backend diagnostic 必须映射回 Target Program IR、ImplementationBinding和上游语义来源。

Canonical Source Policy拥有命名、文件布局、import/declaration ordering、错误表达、printer与formatter options的版本化规则。它不能重新选择Provider或用表面代码风格改变语义。

同一 validated inputs、Target Profile、ImplementationBinding、Provider/Adapter revisions 与 compiler options 必须产生 byte-stable outputs。locale、timezone、cwd、绝对临时路径、Map/Set插入顺序、Host family和wall-clock不得污染 canonical bytes。

## Deterministic Lowering

每层具有独立：

```text
raw builder → validator → branded validated snapshot
→ deterministic lowerer / resolver → source/provenance map
```

后层不得重新解释前层 authoritative semantics。Lowering与resolution rule以类型、contract与capability分派，不按 Ticket、Customer 或其他示例名称分支（包括具体业务名称或散落的库名）。至少三组无关业务模型用于反特化验证。

## 单写者迁移

Legacy Generator、旧实现选择路径与新IR lowering在同一artifact上不得长期双写。迁移顺序固定：

```text
freeze current semantic and artifact owner
→ shadow resolve / shadow generate
→ Decision / Binding / byte / semantic / runtime parity
→ switch consumer and writer
→ invalidate old decisions and plans
→ remove old resolver / writer / task / template / adapter
→ main readback
```

Parity 未闭合前只有原 writer 可发布；新路径只产生 Evidence。切换后旧 writer、库名分支、入口、测试映射和文档必须一起退役。

## Incremental Compilation

Compiler Incremental Graph 只优化上述 clean deterministic chain：node key 绑定真实 content、validated revision、pass/options、Target Profile、Requirement/Candidate/Policy/Decision/Binding、Provider/Adapter与Backend revision。

Incremental path必须经过相同validator、eligibility、policy、tie-break、fixed-point、source mapping和unsupported规则。任何 incremental ResolutionDecision、ImplementationBinding和source result 都必须与相同输入的 clean result byte-equivalent。未知依赖、read failure、schema/pass/provider/policy revision变化只扩大失效；cache状态可删除、可重建且不成为第二语义。

## 验收

- raw/validated边界和唯一producer有机器合同；
- Requirement、Candidate、Eligibility、Decision和Binding具有不同identity/revision；
- 至少两个无关合格实现可以满足同一Target-independent Contract；
- hard constraint失败、unknown、conflict、stale与unsupported全部fail closed；
- `prefer`只影响合格候选，`require/pin`不能绕过hard eligibility；
- selection、tie-break和diagnostics不依赖枚举/Map/文件发现顺序；
- Target Program IR与Backend只能消费冻结Binding；
- Block Resolver、Provider policy、Workbench、Adapter和Generator不能建立第二Implementation Resolver；
- clean/incremental Decision、Binding与byte parity；
- round-trip/typecheck/conformance/runtime acceptance与negative scenarios；
- Provider/version变化产生显式ImplementationBindingDelta、Compatibility Decision和Migration；
- 三组无关模型不修改Core业务分支；
- Extension/Opaque区域不被误标为canonical；
- 同一artifact没有竞争writer，旧选择/生成路径在迁移后物理删除。
