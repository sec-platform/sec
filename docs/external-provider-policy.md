---
title: 外部 Provider 政策
status: stable
domain: external-provider
---

# 外部 Provider 政策

本文拥有外部工具、MCP、语言/编译器基础设施、程序分析器、类库/SDK、构建/测试/发布服务和 Agent 工具的治理政策、owner 分离、边界、评估、接入、conformance、吸收、替换与退役规则；它不拥有任何具体 Provider 值、live availability 或 effect receipt。具体候选、品牌、当前路由、A/B结果和复核状态只存在于 external capability ledger 及相应 Evidence；已注册 EnvironmentSpec 的静态 artifact、layout、endpoint、version、resource profile 与 digest 只存在于 registry 定位的 machine spec。稳定政策不得复制这些值、物理路径或当前状态；文档只拥有跨 Provider 都成立的关系和拒绝条件。

Provider quota、billing、credit、rate-limit 与 upsell 原文在类型化归一后可丢弃；它们最多产生 bounded reason code 与内容 digest，删除后的原文绝不能支持 positive availability、Review、Gate、merge 或 completion 声明。availability/health 是路由和同一 epoch 的 negative circuit-breaker projection，不是 effect authorization：Evidence 缺失、过期或无法复核时一律归一为 `unknown`；`unknown` 不能支持 positive availability claim，也不授予 effect，但它本身不禁止一个已由 operation-specific authority、idempotency/recovery 与 exact readback 授权的 provider operation。只有 current-epoch 的 explicit `unavailable` 禁止重复；实际 provider response/readback 才产生 availability evidence。external capability ledger 拥有 route/availability projection data，canonical provider capability contract 拥有 ledger shape、freshness、role mapping、normalization 与 retry transition validator；注册的 EnvironmentSpec 拥有其静态环境合同值，不能由 ledger 或 live evidence 反向写回。

Provider catalog、manifest和Evidence是Compiler Implementation Resolution的候选输入；本文不拥有最终`ResolutionDecision`、`ImplementationBinding`、`ImplementationBindingDelta`、Compatibility或Migration。

## External capability adoption boundary

成熟 host 工具的 provisioning 与 runtime adoption 是两个不能互换的 owner。系统、用户或显式 package
manager workflow 拥有 install、upgrade、uninstall 和 distribution cache；SEC production runtime 只允许采用
已经存在的 capability。普通 operation 不得下载 archive、执行 installer、解压或复制一套工具发行版，也不得
把这些 Effect 隐藏在 provider discovery、health check、session open、cache warmup 或 recovery 中。缺失、版本
不符、来源不可证明或当前资源预算不足时必须返回 typed `unsupported | unavailable | unknown`，由独立且显式
授权的 provisioning operation 处理；consumer 不得通过 fallback 把 runtime adoption 变成安装入口。

外部命令能力固定为单向四层 authority DAG：

1. **Provisioning owner** 只负责机器上的安装与升级，不签发 repository、credential 或 Effect authority；
2. **Physical adoption owner** 把 PATH、registry、standard location 和 caller path 都只当不可信 candidate hint，
   仅认证并 retain 本次实际执行所需的 executable、working directory 和 effective loader dependency closure；
3. **Semantic session owner** 从 opaque physical capability 签发 Git read、Git ref Effect、GitHub read 或 GitHub
   Effect 等互不冒充的 session，并固定 repository、endpoint、credential/principal、absolute deadline 与 aggregate
   resource ledger；
4. **Operation owner** 只消费对应 opaque semantic session，不能自行查找 executable、spawn 成熟工具、继承
   ambient credential，或反向触发 provisioning。

physical proof 必须等于本次 invocation 的**最小因果闭包**，不能扩大为整个安装目录或整个发行版。它可以包含
launcher、effective executable、真实 app-local loader dependencies、resolved system modules、retained cwd 与
session 前后 identity/readback；不能为了证明一个 executable 而递归扫描、复制或拥有所有 docs、locales、
templates、examples、licenses、unused helpers 和其他无关 payload。adoption 的 entry/byte/time complexity 必须由
静态 contract 限制，并与最小执行闭包成正比，不能随安装树规模增长。持久缓存最多保存可失效的 locator/evidence
projection；它不得复制 executable bytes，不得成为 authority，live session 仍必须从当前 retained physical state
重新发行。

机器约束必须阻止这条边界退化：production adoption module 不得 import download/archive extraction/installer
surface；unsupported/unavailable provider 的 negative test 必须证明 zero network、zero install/cache publication、zero child spawn；
candidate path、same-path ABA、executable/dependency drift、cwd replacement、deadline、close settlement 和 origin forgery 必须 typed
fail closed。tracked production census 还必须保证每个成熟工具只有一个 physical owner，raw child transport 不能成为第二 provider。

## Registered host control capability projection

已注册EnvironmentSpec只是上述通用adoption DAG的machine projection示例，不建立新的semantic、credential或Effect owner。External Provider policy只要求：静态profile由registry定位且strict parse；live route/state由ledger投影；physical owner从当前已安装能力签发opaque retained session；Git、GitHub或其他semantic owner再消费该session。exact profile、artifact、layout、endpoint、version、digest、resource ceiling、surface name、物理路径和当前availability只存在于machine spec、ledger与live receipt，不在稳定政策重复。

Runtime owner可以公开opaque physical session，但不能把parser、PATH candidate、spec digest或ledger row当作live authority。production positive必须来自最小retained invocation closure、pre/post identity、operation budget和terminal settlement；unsupported platform或不可证明状态typed fail closed，禁止裸PATH、跨平台替换、安装fallback和按consumer复制wrapper。该具体capability是否已ready只由live owner和Evidence证明，本文不作current claim。
## 目标

SEC 不应因目标宏大而重造所有轮子，也不能把外部工具的能力、宣传、类型声明或内部数据模型直接变成 Core truth。

外部能力的目标是：

> 以最小、可替换、可验证的组合补足 SEC 缺失能力；把结果纳入统一 identity、Evidence、authority、transaction、Verification 和 lifecycle 边界；成熟机制被吸收后删除重复实现。

## Workflow executor / container Adapter

Workflow dispatch、repository/check transport与物理compute是不同capability；具体绑定由machine profile、external capability ledger和Verification owner共同定位，稳定政策不固定品牌、位置、角色名、镜像、工具版本、endpoint或当前active route。只有当Adapter新增了credential隔离、immutable execution identity、sandbox boundary、remote/local CAS、destructive-resource ownership、settlement和readback等真实SEC invariant时，它才优于直接调用成熟工具；否则使用最窄稳定machine interface并删除wrapper。

每个lifecycle operation——start、observe/status、stop、recover、retire——必须消费owner签发的opaque operation session。session绑定exact repository/provider endpoint、credential principal与permission epoch、immutable runtime/materialization identity、monotonic absolute deadline和aggregate command/argument/output/process/request/record budget；credential acquisition、physical adoption、全部child/request、stream settlement与最终absence/readback只消费同一剩余预算，并为terminal settlement保留资源。禁止按命令重开timeout、按cwd缓存无operation identity的credential、用mutable name/tag/label自签authority，或在cancel/timeout后仅凭父进程退出宣称完成。

需要用户级或机器级物理根、endpoint、lock或其他provider runtime state的adapter，必须由Runtime Physical owner按当前platform profile从主机权威API解析和保留，不得把ambient environment、caller path、presentation error或手写allowlist当作根。任一必需root/endpoint/generation缺失、foreign、inaccessible或unknown时，必须在首个provider Effect前返回domain machine contract定义的typed unavailable/recovery result，并保持zero fallback、zero第二provider与zero state publication。当前profile、路径、endpoint形式、generation grammar、failure union、生产入口与availability只存在相应Runtime/Provider machine contract和capability ledger/generated projection。

provider runtime state必须按physical owner签发的generation管理，不能按文件名或错误字符串特判。启动admission对profile派生的retained roots执行bounded no-follow census，并将观察绑定物理identity与attempt。恢复只能在provider process tree/service settled后对exact generation执行identity-bound可恢复迁移并保留source evidence；新generation只在endpoint、provider identity与幂等readback均通过后发布ready。历史generation只在live handle、consumer、recovery、external contract与unknown全为zero后由authenticated GC回收；普通caller不得删除、glob清理或维护endpoint路径清单。

Provider-neutral安全不变量包括：untrusted execution看不到host repository credential、provider socket或trusted runner state；可信与不可信角色的capability/identity隔离由machine profile签发并readback；registration secret不进入argv、image、log或durable projection；所有create/delete只作用于retained exact identity且完成physical/remote absence readback；unknown、foreign、duplicate、replacement、partial settlement或deadline exhaustion保留typed residue，禁止prefix/glob/global prune。cache、image、archive、OCI layout与provenance各自只有在真实consumer区分时才拥有identity，不能互相替代或被presentation状态冒充。

需要provider child脱离普通parent/job生命周期时，External Provider只要求consumer在spawn边界消费Runtime Physical owner签发的opaque capability，并核对当前operation、attempt与provider binding；为其他operation、attempt或provider签发的capability一律不可移植。capability的brand、issuance、process-tree与physical lifecycle只属于Runtime Physical machine contract。provider child仍进入provider settlement与domain readback，不能因parent settled而被解释为provider ready或terminal。

External Provider对cleanup、close、termination与physical readback分别观察并签发provider settlement set。cleanup失败不得覆盖先发生的provider failure，也不得被catch后丢弃；每个retained handle即使identity readback失败也必须在`finally`尝试安全释放，释放失败与identity drift分别保留。一个root/session close失败不能阻止其余已持有资源的settlement。External Provider不签发包含业务primary outcome的DomainTerminal；只有domain operation才能把自己的primary outcome、全部provider settlement、independent domain readback与recovery refs组合为terminal。partial或unknown provider settlement始终保持typed residue。

Provider identity在首次可能产生Effect之前由其lifecycle owner从retained executable/cwd、profile、endpoint/generation candidates与当前
operation binding签发admission identity；consumer输入摘要、resource envelope、日志路径或启动后的presentation digest不能冒充。generation
census、breakaway capability、process session和residue observation绑定该同一admission identity，ready session identity只能是它经过最终
endpoint/process/readback验证的successor。任何observer exception、physical identity drift或profile外路径都返回typed unknown，不得被
catch并降格为“没有residue”或普通启动失败。

MainHealth、status/check mutation、hosted/local reconciliation、Verification result与merge仍由Verification/Control owner拥有；External Provider只交付受约束的physical/semantic session及provider settlement receipt/set。任一Adapter只有在operation-scoped deadline、credential lifecycle、aggregate budget、settlement和readback由代码与Evidence闭合后才可投影为ready；具体current status只来自capability ledger/generated projection。替换physical executor只迁移binding并通过同一conformance contract，旧route在consumer-zero和unknown-zero后原子退役，不保留双writer。
## 能力角色

外部能力只能处于以下一种主要角色：

- **Core substrate**：成熟基础库或编译器API，被 SEC 自己的 contract/validator 包裹；不能拥有 SEC semantic authority。
- **Replaceable Provider**：提供 syntax、symbol、graph、runtime、browser、build、security、业务能力实现或其他 Evidence/Capability。
- **Adapter**：把 SEC canonical contract转换为外部系统调用，或把结果归一为 SEC DTO/Evidence；不能拥有业务Responsibility或最终选择。
- **Reference Provider**：SEC维护的最小、可解释、可conformance基准实现；不是默认宇宙最优。
- **Custom Provider / Governed Extension**：用户或组织提供的实现，平台治理接口、Effect、Permission、owner、Verification和Migration。
- **Agent/CLI projection**：只读machine projection或导航。
- **Verification / conformance tool**：执行一个明确 Gate 或交叉验证。
- **Development utility**：仅用于仓库开发，不进入产品运行面。
- **Project-specific utility**：只服务某个 corpus/policy/fixture。
- **Rejected / superseded / watch**：有明确理由、触发条件和复核时间。

外部工具不能拥有 Engineering IR、Entity/Fact identity、source owner、authorization、actual Delta、Impact truth、Implementation Resolution decision、Compatibility、Verification decision、publish/merge decision、rollback terminal state 或 release authority。

## 能力类别

评估时按最小能力拆分，不按品牌整体判断：

- Language Frontend：parse、type、symbol、definition/reference、module resolution；
- Code Index / Graph：context retrieval、caller/callee、dependency、path trace、reverse/diff impact；
- Deep Program Analysis：CFG/PDG、taint、data flow、security path；
- Source Transformation：AST/LST/codemod、格式和comment preservation；
- Runtime Observation：trace、coverage、profile、network/process/browser observation；
- Build / Package / Test：install、bundle、cache、sandbox、container、browser；
- Policy / Schema / Solver：validation、compatibility、constraint solving；
- Provenance / Supply Chain：SBOM、signature、attestation、vulnerability；
- Workflow Runtime：retry、durability、compensation、scheduling；
- IDE / Visualization / MDE：navigation、projection、structured editing；
- Application Capability：HTTP、validation、storage、queue、telemetry、cloud SDK、ORM 等具体实现；
- Agent / MCP：向模型暴露query或operation。

一个项目可能同时提供多类能力；每类独立决策、授权和退役。不能因为使用其 parser 就同时接受其graph、cloud、MCP和mutation权限，也不能因为一个包同时提供多种API就把整个品牌视为不可拆分的Implementation Candidate。

## 渐进接入等级

平台不得把“官方支持/不能使用”做成二分。任意外部类库或服务至少按以下成熟度处理：

### L0 — Physical dependency

平台知道package/source identity、exact version、integrity、license、dependency/peer/native/install/build closure。允许安装、构建和显式代码使用，但不声称理解业务行为。

### L1 — Typed external invocation

Language Frontend从`.d.ts`、exports、source和module resolution产生`ExportedSymbol`、signature、generic、overload、参数/返回类型与source identity。用户可以结构化选择函数、构造器或方法并连接输入输出。

L1只承诺调用shape、module resolution和适用typecheck，不承诺：

- Effect、Permission或资源；
- 幂等性、retry、timeout、cancellation；
- error classification和serialization；
- security、privacy、telemetry；
- runtime/Target行为；
- semantic contract satisfaction或Support Claim。

未知项必须显示`unknown/opaque`，不能因类型正确或示例可运行自动升格。

### L2 — Declared governed invocation

用户、组织或已授权Policy为TypedInvocation声明Contract、Effect、Permission、errors、resources、Target和Verification requirement。它可以作为Governed Extension/Custom Provider使用，但声明仍需验证，不能因用户填写字段而成为官方事实。

### L3 — Observed / inferred candidate

平台分析源码、`.d.ts`、文档、测试、示例、CFG/data-flow、依赖闭包和隔离runtime trace，产生ProviderManifest、Adapter、Effect或Contract-matching candidate。输出必须保留coverage、conflict、unknown、unsupported、source/provider revision与Evidence，不自动Adopt。

### L4 — Verified Provider / Adapter

只有完成security/license/data review、Target physical conformance、version binding、behavior/error/effect mapping、negative/failure tests、freshness和retirement后，Provider/Adapter才可进入正式候选catalog，供Implementation Resolution自动选择和迁移。

`verified`不自动等于`selected`或`product-supported`；最终选择仍由Compiler Resolution Policy决定，Support Claim仍需独立package/deployment/usage maturity。

### L5 — Normalized SEC-owned projection

只有能够被完整表示、round-trip、验证、迁移、重新生成并删除旧writer/依赖的局部能力才可以Normalize为SEC-owned projection。复杂ORM、native runtime、远程服务、动态反射和大型框架通常长期保持Provider或Governed Extension，而不是强制“反编译成SEC”。

## 黑盒、灰盒与白盒

- **Black box**：只有公开接口和运行结果，如闭源SDK、native addon、WASM或远程API。平台治理接口、Effect、Permission、Target、资源和Verification，不猜内部实现。
- **Gray box**：有类型、源码、文档、测试和trace，但无法证明全部路径或业务含义。大多数开源库默认属于此层。
- **White / normalized**：只有经Reconcile/Adopt/Normalize后，SEC能够完整重建并拥有的范围。

“源码公开”不等于white box；“没有发现Effect”只有在inventory、static/runtime coverage按设计应发现该Effect时才构成反证。一般程序行为、终止和完全等价不能由一个通用静态算法自动保证。

## 强制评估流程

```text
Discovery
→ Problem Definition
→ Primary-source Research
→ Capability Decomposition
→ SEC Ownership Mapping
→ Security / License / Data Review
→ Integration Cost and Failure Model
→ SEC + Conformance Corpus A/B
→ Decision
→ Bounded Integration or Design Absorption
→ Consumer Migration
→ Duplicate Removal
→ Version Pinning and Evidence Freeze
→ Revalidation / Replacement / Retirement
```

### Discovery

来源可以来自编译器、语言、IDE/MDE、程序分析、安全、CI/构建/发布、工业系统工程、Agent工具、论文和大型项目基础设施。不能只搜索名称包含 AI、Graph、Compiler 或当前流行品牌的项目。

### Problem Definition

在研究工具前必须写清：

- SEC 当前缺失的具体 capability 和 consumer；
- 当前自研/人工流程的错误率、延迟、token、维护或安全成本；
- 需要的是 authority、Evidence、候选、变换、验证、执行还是可视化；
- 输入、输出、coverage、freshness、failure和完成判据；
- 明确不需要的能力与禁止权限。

禁止先安装工具再寻找用途，也禁止把“可能以后有用”当作长期 standing dependency。

### Primary-source Research

至少核对官方文档、源码/公共API、release notes、license、security policy、issue/limitations、benchmark方法、install/build脚本、网络/telemetry/data boundary、增量/stale/failure behavior和维护状态。

营销页面、搜索摘要、社区转述和作者benchmark只能提供候选线索。多个页面引用同一原始材料只算一个证据来源。

### Capability Decomposition 与 Ownership Mapping

把项目拆到可单独替换和验证的能力，并为每项选择唯一 SEC owner：Core substrate、domain Provider、Adapter、Projection、test/fixture、project utility或reject。

若同一能力已经由 SEC code contract拥有，外部工具只能作为交叉 Evidence、实现 substrate或替代候选，不能建立第二结果源。若决定吸收其设计，必须明确哪些算法/contract进入SEC、哪些品牌/格式不进入、何时删除外部依赖或自研重复。

对于产品实现类Provider，还必须区分：

```text
Provider catalog eligibility
≠ Implementation Resolution selection
≠ ImplementationBindingDelta
≠ Compatibility / Migration
≠ dependency materialization
≠ physical Verification result
≠ product Support Claim
```

### Security、License 与 Data Review

必须审查：

- license、专利、copyleft、商用/再分发和生成物权利；
- package provenance、maintainer、release/signature、dependency和install script；
- native/FFI、MCP server、browser、container、credential、filesystem、process和network权限；
- source/code/context是否上传，数据保留、训练、telemetry和区域；
- secret/environment读取、日志/trace泄漏和输出注入；
- untrusted project/tool output对Agent或parser的prompt/code injection；
- update/revocation/incident response和offline/fail-closed行为。

MCP server、native dependency、language server和云服务都视为高权限Provider。版本固定和本地运行不自动消除风险；需要执行不受信代码时必须有独立 sandbox authority。

### A/B 与 Conformance

至少在两类差异显著的 corpus 上进行同条件验证：

- SEC 自身：canonical contracts、IR、transaction、CI和工具链密集；
- 一个复杂conformance/brownfield corpus：多package、runtime、browser、release、治理和历史负担密集。

按能力记录：

- task success、precision/recall和漏掉关键consumer的次数；
- false relation、false confidence、unknown/unsupported和stale行为；
- source excerpt/reference可回看性；
- index/build时间、wall-clock、CPU、memory、disk、network；
- Agent工具调用数、输入/输出token和选择干扰；
- incremental update、revision binding和失败恢复；
- language/framework/platform coverage；
- install、upgrade、license、安全和运维成本；
- 与SEC现有实现的重复、迁移和删除成本；
- 对Semantic Contract、Effect、error、resource和Target的conformance。

性能宣称必须同机器、版本、输入、warm/cold模式和采样协议比较；不能比较两次孤立运行。作者提供的benchmark不能替代SEC自己的A/B。Conformance通过只证明被测试合同和环境，不证明所有业务用途。

## Decision Taxonomy

每个候选只能进入明确状态：

```text
absorb-design
integrate-provider
integrate-adapter
register-verified-candidate
use-as-development-tool
use-as-conformance-tool
retain-project-specific
watch-with-trigger
superseded
reject-with-rationale
retired
```

禁止用 `maybe`、`later`、`looks useful`、`temporarily keep everything` 作为长期状态。

每个 decision 至少绑定：problem/capability、owner、version/license、scope、security/data边界、A/B Evidence、consumer、duplicate to remove、upgrade/revalidation trigger和exit/retirement。

`register-verified-candidate`只授权进入Implementation Resolver的候选catalog，不授权最终选择、安装、发布或Support。

## Provider Contract

所有产品 Provider 输出至少绑定：

```text
providerId / providerRevision
capabilityId / contractRevision
sourceRevision / targetRevision / scope
package/version/integrity/adapter references where applicable
coverage and unsupported regions
freshness and invalidation rule
authority class / confidence where applicable
diagnostics and failure classification
unresolved / ambiguous / conflicting regions
evidence references and raw artifact digest
resource / effect / permission / network / execution boundary
conformance and support maturity references
```

Provider输出首先是不受信输入。SEC adapter必须canonicalize、validate、bound output、strip secrets/absolute host details并保留raw artifact引用；不能因parse成功、manifest声明、类型检查通过或AI生成测试就把它写入IR或标为eligible。

源码bytes只证明物理内容；AST/symbol/graph通常是derived或inferred；runtime trace只对应具体环境和路径；LLM摘要永不直接升格。Predicted impact、Provider candidate impact、canonical Impact、actual Delta、Implementation Eligibility和Verification safety是不同对象。

Provider unavailable、partial或stale时，默认产生明确unsupported/not-run/unknown，而不是返回空结果或旧结果。只有明确Gate/contract要求该Provider时才阻断整体操作；Implementation Resolver需要其完整证明时，候选应保持unknown/ineligible而不是静默fallback。

## Adapter Contract

Adapter只拥有稳定Contract与Provider API之间的协议转换：

- input/output/type和serialization mapping；
- error、cancellation、timeout、retry和resource mapping；
- Effect/Permission声明与observability；
- Target-specific lowering；
- conformance suite与known limitations。

Adapter不能：

- 拥有付款、注册、工单等业务Responsibility；
- 修改或降低Semantic Contract以适配库默认值；
- 自行选择package/version或绕过Implementation Resolution；
- 自行比较old/new Binding或签发Compatibility；
- 把Provider success解释为产品Acceptance；
- 在Backend或UI中隐藏额外Effect、telemetry或依赖。

一个Provider可以有多个Adapter revision；同一Adapter也只能覆盖声明的contract subset。无法保持旧合同的版本升级必须先产生new Binding，由Delta/Impact owner生成`ImplementationBindingDelta`，再由Change Management裁决Compatibility/Migration；Adapter不能静默调整mapping。

## Agent 与 MCP 工具面

日常工具面遵循最小充分原则：

- 精确文件/符号/错误已知时使用native file/search/Git/compiler工具；
- 入口未知或跨文件context任务，最多启用一个daily context Provider；
- canonical architecture、IR、transaction、cross-repo和大型diff任务，按需启用一个architecture Provider；
- taint/data-flow/security使用专门security Provider，普通调用图不能替代；
- Brownfield census可由orchestrator运行多个Provider，但不把全部工具常驻暴露给Agent。

功能重叠的standing MCP不得同时开启。原因包括选择成本、token/延迟、stale状态、冲突答案和把工具共识误当事实。

MCP只暴露最小read/query或显式bounded operation。默认禁止任意shell、rename、write、setup、credential和unbounded query；需要写入时仍经SEC Mutation/transaction或仓库正式开发流程。

具体工具路由、版本和当前启用状态属于external capability ledger和`sec-external-capability-governance` Skill，不复制到本文。

## 集成与吸收

### integrate-provider

通过版本化adapter隔离品牌/格式；保持可替换；保存coverage/freshness/failure；consumer只依赖SEC contract。产品实现Provider进入正式catalog后仍由Implementation Resolution决定是否使用。

### integrate-adapter

Adapter只拥有协议转换、认证、调用和结果归一；不拥有上游canonical语义、最终Implementation Decision、Binding Delta、Compatibility或下游publish decision。

### absorb-design

把经验证的通用算法、状态机或边界提炼到SEC唯一owner；建立自己的types、validator、tests、migration和Evidence；完成consumer迁移后删除重复实现。不得复制许可证不允许的源码，也不得保留品牌数据模型作为隐形Core。

### development / conformance tool

明确不进入产品package、runtime、public API、support claim和用户数据面；锁定依赖与CI/本地入口；退出时删除配置、cache、generated files和Skill路由。

## 版本、升级与 Freshness

Provider版本、Adapter revision、contract revision、source revision、catalog revision和index revision必须分离。工具升级不能沿用旧A/B、安全和兼容结论；至少在重大版本、API/schema/default behavior变化、license/security事件、dependency/runtime变化、stale incident或consumer扩展时重新验证。

Index或缓存必须能证明对应的source revision、coverage和failed regions。无法证明freshness时结果invalidated；不得因查询仍返回内容就视为当前。

自动更新默认禁止用于高权限Provider和merge/release authority。升级先在隔离candidate验证并产生new candidate/Binding；Delta/Impact authority比较old/new Binding，Change Management再裁决Compatibility与Migration。任何一步失败都保留旧validated Binding或明确unsupported，不能由Provider policy静默换版本。

## Failure 与降级

Provider failure不能改变canonical semantics或扩大权限。降级策略必须逐能力定义：

- fallback到更窄可信native能力，但必须作为新的Implementation candidate重新走eligibility；
- 保留unknown并阻止需要完整coverage的操作；
- 使用旧结果但明确invalidated/stale，仅供历史导航；
- Gate要求该Provider时返回unsupported/failed而不是假PASS。

不得用另一个功能相近Provider的成功静默覆盖第一个Provider失败；若组合Evidence，必须保留独立来源和竞争解释。不存在“因为唯一剩余候选所以自动授权”的降级。

## Duplicate Removal

引入外部能力时必须列出：现有重复代码/Skill/MCP/脚本/文档、迁移consumer、parity方法和删除条件。Provider被吸收或替换后，旧entry、config、dependency、generated state、cache、workflow、Skill路由和文档必须退役。

“保留备用”只有在有真实failover contract、独立health/freshness、重新Resolution和定期physical proof时成立；否则是长期双authority和维护负担。

## 退役与替换

触发条件包括重大版本或license变化、安全事件、维护停止、重复stale/错误、原生能力达到parity、无真实consumer、成本超过收益、Provider协议被更好实现替代或数据边界不再可接受。

退役流程：

```text
freeze new use
→ identify consumers, bindings and evidence
→ obtain replacement / unsupported ResolutionDecision
→ generate old/new ImplementationBindingDelta and Impact
→ obtain Compatibility Decision and Migration plan
→ migrate and verify parity
→ remove entry/config/dependency/cache/permissions
→ invalidate old evidence, catalog eligibility and support claims
→ preserve historical decision and incident record
```

退役不要求删除历史Evidence，但历史结果必须明确source revision和invalidated状态。旧Provider被撤销时，现有Binding不得自动改绑；必须由Implementation Resolver产生新的Decision，由Delta/Impact比较，再经过Change Management和Verification。

## 完成判据

一个Provider接入只有在：能力和owner明确、security/license/data review完成、A/B与conformance达到预设判据、adapter fail closed、coverage/freshness可见、consumer迁移、duplicate移除、upgrade/revalidation/retirement闭环并进入clean package/support matrix后，才能被称为正式候选或产品能力。

“可安装”“可类型调用”“用户声明了Effect”“平台推断到候选”“通过conformance”“被Resolver选中”“已发布”“product-supported”必须分别显示，任何一层都不能冒充后一层。
