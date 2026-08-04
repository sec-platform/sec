---
title: Workbench 与 AI 操作边界
status: stable
domain: workbench-ai
last-reviewed: 2026-08-04
---

# Workbench 与 AI 操作边界

本文拥有 Workbench view/inspector、Semantic View、Context Packet、interaction/transport/session 和 AI bounded proposal projection。Canonical IR、Responsibility、Operation Envelope、Role/Permission、Mutation transaction、Impact、Verification result、Run State 和 merge authority仍由各自领域唯一拥有。

## 权力关系

```text
Platform owns canonical state and policy
→ selects or accepts an Engineering Operation
→ signs a typed Operation Envelope
→ projects bounded Context Packet and product views
→ human/AI submits a proposal
→ platform plans without live writes
→ transaction applies under CAS and Verification
→ product renders canonical result
```

AI、用户界面和外部 Provider都不是authority。AI confidence、模型能力、Provider related files、Context Packet内容和用户在画布上的拖拽都不能扩大operation、path、Effect、owner、Role、budget或Verification权限。

## Workbench 产品职责

Workbench是本地理解、Review、影响预览、决策和受控操作面。它不是普通IDE、低代码私有运行时、第二个编译器、Agent状态机或可任意写文件的本地Web服务。

用户面对同一个工程语义空间。Architecture、Scenario、Data、State、Contract、Effect/Permission/Trust、Impact 与 Evidence只是不同projection：

- **Architecture**：Responsibility、Boundary、Contract、Port和关键Effect；
- **Scenario**：围绕Entry/Operation/Event/Acceptance的局部因果链；
- **Data**：值从来源、验证、转换、序列化到sink的路径；
- **State**：Owner、Reader、Writer、Mutation、Lifetime、Transition、Concurrency与Escape；
- **Contract**：input、pre/postcondition、output、error、Effect、idempotency与lifecycle；
- **Effect / Permission / Trust**：Filesystem、DB、Network、Process、Secret、Clock、Random和外部边界；
- **Impact**：canonical Delta、direct/transitive impact、unknown frontier和Verification recommendation；
- **Evidence**：authority、provenance、coverage、freshness、competing explanation与适用范围；
- **Operation**：平台签发的target、权限、must-preserve、forbidden Effects、Verification和budget投影；
- **Result**：accepted、rejected、rolled-back、recovery-required以及其canonical references。

UI可以过滤、聚合、布局、标注和折叠，但每个可审查判断必须保留Entity/Fact/Assertion/Responsibility/Operation/Evidence/Artifact reference。布局、颜色、badge和临时选择不能反向进入canonical IR。

## 统一 Inspector

不同View共享稳定信息分组，而不是为每种节点发明不兼容详情页：

- identity / revision / maturity；
- authority / provenance / evidence；
- Responsibility / role / contract；
- owned state / readers / writers；
- data / effects / errors；
- lifecycle / concurrency / recovery；
- permissions / trust / resources；
- relations / source / artifact bindings；
- unknown / conflict / stale / unsupported。

Inspector必须区分：

- authoritative / derived / observed / inferred；
- candidate / adopted / rejected / ambiguous / opaque；
- proposed / contract-frozen / implemented / physically-verified / packaged-deployed / product-supported；
- current / stale / invalidated Evidence；
- generated / governed / extension / opaque / unknown source；
- planned / blocked / accepted / rejected / rolled-back / recovery-required。

空字段不能被UI默认值伪装为已知。

## Operation View

Operation Envelope由Development/Product authority签发，Workbench只显示和提交其允许的输入。投影至少包括：

- operation identity、target和expected revision；
- caller/Role与permission上限；
- allowed semantic operations和physical path/region；
- requested/forbidden Effects；
- required、must-preserve和forbidden Facts；
- predicted Delta/Impact、unknown frontier和risk explanation；
- minimum Verification、capability和resource requirements；
- budget、expiry、stop/reload条件；
- expected outputs和completion claims。

Workbench不能编辑derived owner、resolved path、Impact、Verification、rollback、terminal或更宽permission。需要扩权时生成新的Operation request，由平台或人重新授权；不能在当前UI对象上增加隐藏字段绕过Envelope。

## 操作生命周期

所有写操作固定经过同一生命周期：

```text
intent / UI action / AI proposal
→ raw DTO validation and local trust checks
→ canonical Operation ingress
→ authorization and plan without live writes
→ render owner, expected change, Impact and Verification
→ apply with expected plan revision
→ accepted | rejected | rolled-back | recovery-required
→ reload projections from accepted canonical revision
```

Workbench不直接写 `source/**`、`project/**`、`control/**`、IR JSON、journal或runtime Evidence。它也不能在blocked plan上隐藏诊断后重新标记ready。

CLI、Workbench和AI caller必须消费同一个platform-owned product adapter和Operation/Mutation public facade：

```text
transport DTO
→ trusted product policy / Operation request
→ authorization / plan / apply / query / recover
→ stable product result projection
```

Transport可以拥有协议解码、local trust boundary、输入格式、错误脱敏和响应shape；它不拥有source owner、allowed canonical path、Role permission、actual Delta、Impact、minimum Verification、rollback或terminal state。

## Semantic View 与兼容投影

Semantic View从validated state构建只读产品合同。ExplainGraph、ReviewSummary、Source View、legacy governance tab或旧Task view可以作为兼容投影保留，但必须明确：

- 它们不等于canonical semantic graph；
- 旧View Mutation不能因名称相近获得Operation权限；
- consumer迁移后旧旁路必须退役；
- 同一事实在多个View中只保留reference，不复制authority字段和裁决算法；
- Compatibility projection不能成为长期第二API。

## Context Packet

Context Packet是某个Operation的最小充分、只读、revision-bound投影，不是缓存整个仓库。它至少可以引用：

- operation、target、Role和authorization；
- relevant Entity/Fact/Responsibility/Scenario/Contract；
- writable与readonly anchors；
- must-preserve、forbidden Effects和unresolved frontier；
- Impact、Verification、Provenance与runtime Evidence；
- 必要类型签名、tests和源码骨架。

装载顺序从结构化语义到必要源码逐层下钻：

```text
Operation summary
→ semantic objects and references
→ Impact / Verification / unknown
→ required source symbols / spans
→ only then additional source context
```

只有当前结构化信息无法回答任务，并且新的读取仍在scope和隐私边界内时，才扩大source context。Source range必须从target、owner、required symbols、Verification和Impact推导；不能默认整仓扫描或把搜索结果加入writable set。

Context Packet绑定canonical revisions、physical/source revisions、Provider freshness、Operation/Policy revision和Evidence identity。任一关键输入变化时必须invalidated或重新投影，不能在新workspace状态上复用旧上下文。

## AI bounded operator

AI输出默认是以下proposal之一：

- source patch proposal；
- semantic operation input proposal；
- repair proposal；
- Responsibility/Fact candidate；
- review finding/decision proposal；
- explanation或alternative plan。

AI不能提交或伪造：

- canonical Fact/Responsibility/Delta/Impact；
- source owner、actual path resolution或authorization revision；
- Role、permission、risk、required passes或budget；
- rollback hint、transaction journal或terminal status；
- control artifacts、IR、Evidence ledger或release receipt；
- 更宽path、Effect、capability或更低must-preserve/Verification。

AI proposal进入平台后必须重新validate、resolve、plan和verify。模型隐藏推理不是SEC必须保存的审计记录；平台保存的是model/context/operation/proposal/plan/result/Evidence identities。

## Budget 与停止

Operation budget至少限制attempts、wall time、token、tool/IO、process/network和输出。预算耗尽、Provider stale、source drift、plan revision mismatch、permission conflict或repeated failure都必须停止当前proposal；不能通过增加重试、删除断言或放宽路径继续。

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

Workbench可以有多个只读消费者，但一个workspace write transition仍由唯一lease/transaction owner协调。多个窗口或Agent基于同一旧revision计划时，只有首个满足CAS的transition可以发布；其他proposal必须重新plan，不自动merge canonical Operations。

长查询、Provider analysis和runtime Evidence可以异步产生，但不得在source/canonical revision改变后静默附加为当前结果。UI必须显示freshness、coverage、pending/failed状态和last valid revision。

Session、tab、connection和UI component lifecycle不拥有Operation或Run State。页面关闭不自动取消后台事务；取消、disconnect、resume和recovery由对应machine owner裁决。

## 产品验收

Workbench/AI操作面达到真实闭环至少需要：

1. 同一canonical state的主要View可相互下钻并保留references；
2. unknown/opaque/stale/conflict和maturity在所有相关View中可见；
3. CLI与Workbench对同一Operation request得到byte-equivalent canonical plan binding；
4. plan不写live workspace；apply使用revision/CAS；
5. accepted/rejected/rolled-back/recovery-required都有稳定product result；
6. 跨站、错误Host/capability、越权Role/path/operation/Effect在读取或写入前拒绝；
7. AI不能构造更宽authorization或更低Verification；
8. Context Packet按需渐进装载且关键输入变化后失效；
9. accepted后所有View来自新canonical revision，而不是UI本地补丁；
10. Workbench没有第二Task/Operation/Result状态机。
