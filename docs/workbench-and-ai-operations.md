---
title: Workbench 与 AI 操作边界
status: stable
domain: workbench-ai
last-reviewed: 2026-08-06
---

# Workbench 与 AI 操作边界

本文拥有 Workbench view/inspector、Semantic View、Implementation View、Context Packet、interaction/transport/session 和 AI bounded proposal projection。Canonical IR、Responsibility、Implementation Resolution、Fact/Binding Delta、Impact、Compatibility、Operation Envelope、Role/Permission、Mutation transaction、Verification result、Run State 和 merge authority仍由各自领域唯一拥有。

## 权力关系

```text
Platform owns canonical state and policy
→ selects or accepts an Engineering Operation
→ signs a typed Operation Envelope
→ projects bounded Context Packet and product views
→ human/AI submits a proposal
→ platform plans without live writes
→ resolver / comparator / compatibility / compiler services recompute derived state
→ transaction applies under CAS and Verification
→ product renders canonical result
```

AI、用户界面和外部 Provider都不是authority。AI confidence、模型能力、Provider related files、Context Packet内容、用户在画布上的拖拽或选择某个库都不能扩大operation、path、Effect、owner、Role、budget、Eligibility、Delta、Compatibility或Verification权限。

## Workbench 产品职责

Workbench是本地理解、Review、影响预览、决策和受控操作面。它不是普通IDE、低代码私有运行时、第二个编译器、第二个Implementation Resolver、第二个Delta comparator、第二个Compatibility evaluator、Agent状态机或可任意写文件的本地Web服务。

用户面对同一个工程语义空间。Architecture、Scenario、Data、State、Contract、Effect/Permission/Trust、Implementation、Impact 与 Evidence只是不同projection：

- **Architecture**：Responsibility、Boundary、Contract、Port和关键Effect；
- **Scenario**：围绕Entry/Operation/Event/Acceptance的局部因果链；
- **Data**：值从来源、验证、转换、序列化到sink的路径；
- **State**：Owner、Reader、Writer、Mutation、Lifetime、Transition、Concurrency与Escape；
- **Contract**：input、pre/postcondition、output、error、Effect、idempotency与lifecycle；
- **Effect / Permission / Trust**：Filesystem、DB、Network、Process、Secret、Clock、Random和外部边界；
- **Implementation**：需求、约束、候选、Eligibility、Resolution Decision、exact Binding、Binding Delta、Compatibility Decision、版本、Target、Adapter和迁移影响；
- **Impact**：canonical Fact/Binding Delta、direct/transitive impact、unknown frontier和Verification recommendation；
- **Evidence**：authority、provenance、coverage、freshness、competing explanation与适用范围；
- **Operation**：平台签发的target、权限、must-preserve、forbidden Effects、Verification和budget投影；
- **Result**：accepted、rejected、rolled-back、recovery-required以及其canonical references。

UI可以过滤、聚合、布局、标注和折叠，但每个可审查判断必须保留Entity/Fact/Assertion/Responsibility/Implementation Requirement/Decision/Binding/Delta/Compatibility/Operation/Evidence/Artifact reference。布局、颜色、badge、临时选择和本地排序不能反向进入canonical IR、Resolution、Delta或Compatibility。

## 统一 Inspector

不同View共享稳定信息分组，而不是为每种节点发明不兼容详情页：

- identity / revision / maturity；
- authority / provenance / evidence；
- Responsibility / role / contract；
- owned state / readers / writers；
- data / effects / errors；
- implementation requirements / candidates / decision / binding；
- Fact / Binding Delta / Impact / Compatibility / Migration；
- lifecycle / concurrency / recovery；
- permissions / trust / resources；
- relations / source / artifact bindings；
- unknown / conflict / stale / unsupported。

Inspector必须区分：

- authoritative / derived / observed / inferred；
- candidate / adopted / rejected / ambiguous / opaque；
- physical-dependency / typed-invocation / governed / verified-provider / normalized；
- proposed / contract-frozen / implemented / physically-verified / packaged-deployed / product-supported；
- current / stale / invalidated Evidence；
- generated / governed / extension / opaque / unknown source；
- planned / blocked / accepted / rejected / rolled-back / recovery-required。

空字段不能被UI默认值伪装为已知。unknown capability不能显示成关闭开关，未执行conformance不能显示成“不支持”，Provider未被选择也不能显示成“不可用”，没有Binding Delta不能显示成“无变化”，没有Compatibility Decision不能显示成“兼容”。

## Implementation View

Implementation View向用户解释稳定语义如何被解析为具体实现、实际发生了什么实现变化、变化是否兼容和需要怎样迁移，但不拥有任何Resolver、Comparator或Compatibility算法。

至少显示：

- semantic/Application/Behavior和Target revisions；
- Implementation Requirements和hard constraints；
- candidate closure：Provider/package/version/Adapter/config/dependency/Target/Effect/resource/support；
- 每个candidate的`eligible | ineligible | unknown | unsupported | conflicted`；
- 淘汰原因、unknown frontier、Evidence和freshness；
- ResolutionPolicy、适用measurement和deterministic tie-break；
- exact ResolutionDecision与ImplementationBinding；
- exact `ImplementationBindingDelta`及其from/to Binding、change kinds、Impact和unknown；
- Compatibility Assessment/Decision、适用规则、Evidence和unknown；
- Migration、Artifact、Verification、Runtime和Support references。

固定解释顺序：

```text
为什么选这个实现
→ 实际Binding改变了什么
→ 变化影响到哪里
→ 这些变化是否兼容
→ 需要什么迁移和验证
```

Workbench不得自己：

- 通过前端排序、推荐位、下载量或最新版本选出winner；
- 把用户点击“使用这个库”直接写成Binding；
- 因Provider只剩一个而自动授权；
- 从package version、source diff、API签名或测试结果重算Binding Delta；
- 从Delta、测试绿或作者release note签发Compatibility；
- 隐藏不合格原因、unknown、Effect、依赖闭包、Delta item或Compatibility uncertainty；
- 在Resolver/Comparator/Compatibility blocked时修改package.json、lock、source或generated target；
- 把安装成功、typecheck通过、Adapter存在或source bytes未变化显示为Contract已满足或兼容。

## 用户实现控制

所有模式最终产生同一种受治理Engineering Operation input，而不是多套写入路径。

### Intent mode

用户只声明产品行为、Semantic Contract和Target-independent要求；平台自动解析实现。

### Constraint mode

用户声明硬边界，例如runtime、platform、cost、license、security、privacy、dependency、resource、portability、offline或禁止Effect。硬约束不满足时candidate必须淘汰。

### Preference mode

`prefer`某Provider、built-in、existing-stack、minimal、portable或performance policy。Preference只在合格候选间排序；不合格时可以回退并解释原因。

### Requirement mode

`require`某Provider/实现族。它不满足hard eligibility时整个plan blocked，不能自动忽略用户require或降低合同。

### Forbid mode

`forbid`某Provider、package、license、Effect、network、native或Target；Resolver必须从候选集合排除并保留决策来源。

### Pin mode

`pin` exact package/version/integrity/config/Adapter。Pin是更严格的constraint，不是安全、权限、Compatibility或Verification绕过；不合格或不可验证时blocked。

### Custom mode

用户绑定自己的实现、TypedInvocation、Governed Source或Custom Provider。平台治理interface、Contract、Effect、Permission、Target、owner、Verification和Migration；未知内部保持opaque。

### Override with rationale

只用于明确授权的紧急/迁移场景，并绑定issuer、reason、scope、expiry、risk、Verification和reversal。它仍不能绕过不可覆盖的Safety/Policy、数据完整性或Semantic Contract，也不能篡改actual Delta或Compatibility事实。

UI必须区分`prefer`、`require`、`forbid`、`pin`和`custom`，不能都压成一个“选择库”字段。

## Operation View

Operation Envelope由Development/Product authority签发，Workbench只显示和提交其允许的输入。投影至少包括：

- operation identity、target和expected revision；
- caller/Role与permission上限；
- allowed semantic operations和physical path/region；
- requested/forbidden Effects；
- required、must-preserve和forbidden Facts；
- Implementation constraint/preference request与可覆盖范围；
- predicted Resolution、Fact/Binding Delta、Impact和Compatibility requirements；
- unknown frontier和risk explanation；
- minimum Verification、capability和resource requirements；
- budget、expiry、stop/reload条件；
- expected outputs和completion claims。

Workbench不能编辑derived owner、resolved path、Eligibility、ResolutionDecision、ImplementationBinding、Fact/Binding Delta、Impact、Compatibility Decision、Verification、rollback、terminal或更宽permission。需要扩权时生成新的Operation request，由平台或人重新授权；不能在当前UI对象上增加隐藏字段绕过Envelope。

## 操作生命周期

所有写操作固定经过同一生命周期：

```text
intent / UI action / AI proposal
→ raw DTO validation and local trust checks
→ canonical Operation ingress
→ authorization and plan without live writes
→ recompute Implementation Resolution where applicable
→ compute predicted Fact / Binding Delta and Impact
→ identify required Compatibility / Migration / Verification
→ render owner, Decision, expected change, Compatibility and Verification
→ apply with expected plan revision
→ rebuild / re-resolve / compute actual Delta and Compatibility
→ accepted | rejected | rolled-back | recovery-required
→ reload projections from accepted canonical revision
```

Workbench不直接写 `source/**`、`project/**`、`control/**`、IR JSON、journal、package/lock或runtime Evidence。它也不能在blocked Resolution/Comparator/Compatibility/plan上隐藏诊断后重新标记ready。

CLI、Workbench和AI caller必须消费同一个platform-owned product adapter和Operation/Mutation public facade：

```text
transport DTO
→ trusted product policy / Operation request
→ authorization / plan / resolve / compare / assess / apply / query / recover
→ stable product result projection
```

Transport可以拥有协议解码、local trust boundary、输入格式、错误脱敏和响应shape；它不拥有source owner、allowed canonical path、Role permission、Eligibility、actual Delta、Impact、Compatibility、minimum Verification、rollback或terminal state。

## Semantic View 与兼容投影

Semantic View从validated state构建只读产品合同。Implementation View从validated requirements、Decision、Binding、Delta、Compatibility和Evidence构建。ExplainGraph、ReviewSummary、Source View、legacy governance tab或旧Task view可以作为兼容投影保留，但必须明确：

- 它们不等于canonical semantic graph、Implementation Resolver、Delta comparator或Compatibility evaluator；
- 旧View Mutation不能因名称相近获得Operation权限；
- consumer迁移后旧旁路必须退役；
- 同一事实在多个View中只保留reference，不复制authority字段和裁决算法；
- Compatibility projection不能成为长期第二API。

## Context Packet

Context Packet是某个Operation的最小充分、只读、revision-bound投影，不是缓存整个仓库。它至少可以引用：

- operation、target、Role和authorization；
- relevant Entity/Fact/Responsibility/Scenario/Contract；
- Implementation requirements、constraints、candidate/decision/binding references；
- predicted/actual Fact/Binding Delta、Impact、Compatibility和Migration references；
- writable与readonly anchors；
- must-preserve、forbidden Effects和unresolved frontier；
- Verification、Provenance与runtime Evidence；
- 必要类型签名、tests和源码骨架。

装载顺序从结构化语义到必要源码逐层下钻：

```text
Operation summary
→ semantic objects and references
→ implementation decision / binding / unknown
→ Fact / Binding Delta and Impact
→ Compatibility / Migration / Verification
→ required source symbols / spans
→ only then additional source context
```

只有当前结构化信息无法回答任务，并且新的读取仍在scope和隐私边界内时，才扩大source context。Source range必须从target、owner、required symbols、Verification和Impact推导；不能默认整仓扫描或把搜索结果加入writable set。

Context Packet绑定canonical revisions、physical/source revisions、Provider/catalog/Binding/Delta freshness、Operation/Policy/ResolutionPolicy/Compatibility rule revision和Evidence identity。任一关键输入变化时必须invalidated或重新投影，不能在新workspace状态上复用旧上下文。

## AI bounded operator

AI输出默认是以下proposal之一：

- source patch proposal；
- semantic operation input proposal；
- implementation constraint/preference/custom-provider proposal；
- Provider/Adapter candidate；
- repair proposal；
- Responsibility/Fact candidate；
- review finding/decision proposal；
- explanation或alternative plan。

AI不能提交或伪造：

- canonical Fact/Responsibility/Fact Delta/Binding Delta/Impact；
- Eligibility、ResolutionDecision、ImplementationBinding或Compatibility Decision；
- source owner、actual path resolution或authorization revision；
- Role、permission、risk、required passes或budget；
- rollback hint、transaction journal或terminal status；
- control artifacts、IR、Evidence ledger或release receipt；
- 更宽path、Effect、capability或更低must-preserve/Verification。

AI proposal进入平台后必须重新validate、resolve、compare、assess、plan和verify。模型隐藏推理不是SEC必须保存的审计记录；平台保存的是model/context/operation/proposal/plan/decision/binding/delta/compatibility/result/Evidence identities。

## Budget 与停止

Operation budget至少限制attempts、wall time、token、tool/IO、process/network和输出。预算耗尽、Provider stale、Binding/Delta/Compatibility invalidated、source drift、plan revision mismatch、permission conflict或repeated failure都必须停止当前proposal；不能通过增加重试、删除断言、自动换Provider、把unknown改为compatible或放宽路径继续。

Budget是Operation约束，不由UI或Skill自由修改。重新预算必须生成新授权或明确Policy decision。

## Local HTTP 与进程边界

“本地产品”不等于任意网页、局域网主机或DNS rebinding可以调用。所有mutating routes必须：

- 只绑定loopback，并严格验证Host/Origin；或使用进程生命周期内不可预测capability，同时仍限制bind/Host；
- 在读取workspace内容、构造plan或返回路径前拒绝跨站、错误capability和非本地请求；
- 禁止wildcard CORS；
- 不在日志、URL、持久artifact或错误中泄露capability、secret、source bytes、绝对路径、journal payload或stack；
- 区分plan、apply、query和recover，apply绑定expected plan revision；
- accepted后只重新读取canonical projection，不调用第二条compile/write路径。

普通loopback、临时目录和输入validation不构成执行不受信代码的安全sandbox。

## 多用户、并发与 freshness

Workbench可以有多个只读消费者，但一个workspace write transition仍由唯一lease/transaction owner协调。多个窗口或Agent基于同一旧revision计划时，只有首个满足CAS的transition可以发布；其他proposal必须重新plan、re-resolve、recompute Delta和Compatibility，不自动merge canonical Operations或Binding。

长查询、Provider analysis和runtime Evidence可以异步产生，但不得在source/canonical/catalog/Binding/Delta/Compatibility revision改变后静默附加为当前结果。UI必须显示freshness、coverage、pending/failed状态和last valid revision。

Session、tab、connection和UI component lifecycle不拥有Operation、Resolution、Delta、Compatibility或Run State。页面关闭不自动取消后台事务；取消、disconnect、resume和recovery由对应machine owner裁决。

## 产品验收

Workbench/AI操作面达到真实闭环至少需要：

1. 同一canonical state的主要View可相互下钻并保留references；
2. unknown/opaque/stale/conflict和maturity在所有相关View中可见；
3. CLI与Workbench对同一Operation/implementation request得到byte-equivalent canonical plan、Resolution binding、Delta和Compatibility references；
4. intent/constraint/prefer/require/forbid/pin/custom映射到同一Operation入口；
5. 用户pin/require不能绕过hard eligibility，prefer不合格时可解释回退；
6. UI/AI不能从source diff、semver、typecheck或test green重算Binding Delta/Compatibility；
7. plan不写live workspace；apply使用revision/CAS；
8. accepted/rejected/rolled-back/recovery-required都有稳定product result；
9. 跨站、错误Host/capability、越权Role/path/operation/Effect在读取或写入前拒绝；
10. AI不能构造更宽authorization、更低Verification、最终Binding、actual Delta或Compatibility；
11. Context Packet按需渐进装载且关键输入变化后失效；
12. accepted后所有View来自新canonical revision，而不是UI本地补丁；
13. Workbench没有第二Task/Operation/Resolution/Delta/Compatibility/Result状态机。
