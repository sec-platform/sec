---
title: Verification、Evidence 与 CI 治理
status: stable
domain: verification-governance
---

# Verification、Evidence 与 CI 治理

本文拥有不同验证层证明什么、Requirement/Gate/Result/Claim/Aggregate/Evidence的稳定身份边界、Implementation conformance、Impact选择、失败复用、trusted bootstrap和merge authority。具体测试文件、suite、command、timeout、并发、selector、当前schema revision和physical Gate结果由机器合同、runner、workflow和最新 `main` 拥有。

Verification可以为Implementation Resolution、Binding Delta、Compatibility和Migration提供Evidence，但不拥有Resolver、Delta comparator或Compatibility evaluator。

## Truth kernel 与 activation

Verification truth统一使用`passed | failed | not-run | unsupported | invalidated`，并独立表达execution disposition、applicability、Claim/Gate/environment identity、proof provenance、freshness、cleanup和aggregate。duplicate、missing、unknown、stale与self-proof一律fail closed；绿色命令、journal、artifact、status或文档不能绕过该truth kernel。

Execution ledger、Evidence DAG、runtime allocator、reuse/flake、Review与merge等capability只有在各自machine contract、producer/consumer、migration、focused tests和new-main readback闭合后才active。stable文档不维护current/successor清单；exact maturity、provider route、schema和blocker由generated projection给出。
## 验证对象与层级

- **Requirement / Claim**：要证明的exact性质、owner、subject、inputs和applicability；
- **Gate Definition**：如何在声明环境和capability下观察或执行该Requirement；
- **Observation / Execution**：一次physical执行、合法reuse或明确not-executed事实；
- **Result**：该Observation的五态结果、reason、cleanup和artifacts；
- **Aggregate**：按Claim、owning environment和proof identity组合多个Results；
- **Decision**：Mutation、Implementation Resolution、Compatibility、merge、release、support等上层consumer对Aggregate和其他事实作出的决定；
- **Evidence**：支撑Result/Claim/Decision的exact记录。

一个绿色命令不是完整Verification对象；一个Aggregate PASS也不能自动证明Implementation eligibility、Binding Delta、Compatibility、packaged/deployed或product-supported。

## 测试层

- **Unit**：pure builder、selector、resolver、comparator、index、normalizer、formatter和安全边界；
- **Contract**：公共schema、CLI、package、CI、error、IR、Requirement/Candidate/Decision/Binding/Delta和inter-owner shape；
- **Integration**：Workspace pipeline、Implementation Resolution、Binding Delta/Impact、artifact flow、transaction和跨owner集成；
- **E2E / slow**：真实Git、filesystem durability、server、browser、native host、package、Provider和发布路径；
- **Property / Model**：输入空间、幂等、round-trip、状态机、fixed-point、排序、tie-break、Delta direction和反特化；
- **Fault / Recovery**：crash/persistence boundary、TOCTOU、cache invalidation、rollback/recovery和资源收口；
- **Mutation / Test-quality**：校准关键validator、authorization、eligibility、Delta/Impact fail-closed和selector是否真正被断言覆盖。

测试层由要证明的性质、真实副作用、状态冲突、资源和环境决定，不由目录名、一次duration或“看起来像集成”决定。

真实browser/server/native/durable acceptance即使偶尔很快仍属于physical layer；反之，位于acceptance目录但不请求browser capability的contract test不应被迫启动无关browser。Gate definition和fixture实际需求共同决定capability。

### 测试存在证明与全量审计完整性

保留或删除一个测试时，机器必须从canonical Claim/owner、subject与输入闭包、observation层、assertion、fixture/
Provider/Effect、failure或counterexample空间、test-impact边、资源成本和失效条件派生裁决理由。测试的有效observable只包括：
真实业务公共行为、持久状态的独立readback、真实Effect、typed failure/recovery边界和可反例化的algorithm/property。
测试名称、文件路径、注册数量、历史失败、覆盖率百分比、单次绿色结果或“看起来重要”都不能产生测试价值；没有上述
observable且无法证明consumer的测试保持`unknown`，不得默认补成`pure | cheap | no-effect`或因为当前PASS而保留。

目标架构中，候选测试源码在同一exact source revision只由Brownfield Source Program拥有的canonical lightweight
observation compiler解析一次；它复用唯一module graph与production Source Program facts，并发布绑定exact test bytes、
registration kind/title/span、assertion、公共调用、Effect、failure/property、持久readback候选和typed unknown的
owner-issued test-observation projection。Test Value只消费该projection与tracked baseline Evidence，执行registration
census和disposition reconciliation；它不能从测试文本、测试结果、分类标签或自己的digest反向签发产品行为、Provider、
Effect、owner、test-impact或任何production authority。任何候选侧第二module graph、隐藏receipt channel或consumer自建parser都使
该capability保持unresolved；只有唯一Source Program producer、公开typed projection与真实consumer闭合后才能激活。projection缺失、revision/bytes不匹配、动态注册/import/断言不可解析或语义边无法闭合时一律
`unknown`并fail closed，禁止重新解析作为fallback。

tracked baseline中的测试缺失时必须具有绑定同一source revision的owner disposition：`keep`、`rewrite`、`merge`、`delete`
或`unknown`。`keep`要求测试仍在candidate；`rewrite`与`merge`要求replacement test ID真实存在于candidate registration receipt；
`delete`只在producer、consumer与external-contract三维census全部为零且没有replacement时合法；任一非零、未分类、缺失
Evidence或`unknown`都阻断。路径相似、名称相似、测试数减少、旧文件已被物理删除或另一组测试为绿色，均不能证明替代
关系或DELETE。disposition是baseline reconciliation Evidence，不是手写永久测试registry，也不能授权产品Effect。

测试只证明canonical owner发布的公共行为或独立readback。硬编码本身不是分类依据：来自真实外部协议、持久格式、资源
上限、typed status或Effect零发生/精确发生合同的字面可以是required；从实现复制的源码路径/目录布局、函数arity、版本或
revision身份、内部数组长度、模块/handler/命令清单和逐字段mutation表则是mirror，必须改为消费owner projection、关系/
集合/property或删除。版本只在兼容policy、迁移边界、持久reader或Provider negotiation真实区分两种可观察状态时测试；
改变一个版本数字并期待失败不证明独立业务不变量。类型、strict parser、closed-world registry或module compiler已经完整拒绝
的非法状态，不再由测试复制同一清单重演；测试只验证真实consumer确实使用该拒绝结果。

审计和Gate的默认人工/JSON projection可以按owner、finding code与digest聚合UNKNOWN或重复记录以控制输出体积，但完整
tracked census、receipt、disposition、producer/consumer/external closure、finding与unknown Evidence仍必须进入同一Gate
输入和Evidence digest。compact projection只是可重建的presentation，不能删除记录、改变blocking计数、签发PASS或成为
第二状态源；需要复核时由同一Evidence提供完整投影，不重新扫描candidate制造另一份事实。

`AssertionDominance`以Claim、subject、counterexample/failure space、真实Effect/readback和applicability比较证明强度，
不按测试名字或文本相似度评分。若测试B完整包含测试A的输入空间与observable，并且A没有独有的failure boundary、
平台能力、Effect readback、资源竞争或诊断合同，则A被B支配：同层完全重复时删除，跨层仍有独立快速哨兵价值时把A
收窄为消费同一projection的廉价contract，不复制fixture和断言。source字符串、AST/callee名称、Markdown布局、调用次数、
sleep/wall-clock以及生产源码hash只能作为定位或独立tamper subject；它们不能冒充行为证明。

production module不得export可被普通caller取得的`ForTests`/`testOnly` provider、credential、clock、Effect callback、
lifecycle writer、cache reset或receipt issuer。测试控制面必须属于test-only package，并由module compiler拒绝
production到test-only的依赖；需要在真实事务点注入race/crash时，由production owner签发bounded、single-use、
不可伪造且不携带production authority的test actor。函数名、注释、structural TypeScript type或同形状对象不是origin gate。

任何声称“全仓测试审计完成”的Evidence必须同时具备：全部tracked path的NUL-safe census和零未分类ledger；所有注册、
参数化展开、alias注册和conditional skip的解析；canonical module/import/test-impact graph引用；assertion/fixture/failure-space
fingerprint及dominance graph；production source中的手写事实镜像与test-only export census；source/prose/layout proof census；
Effect、Provider、进程、网络、持久状态、墙钟和资源成本分类；以及每个不能确定分类的typed unknown。缺少任一维时，
该审计只能是partial hint，禁止给出全量`KEEP/DELETE`结论。新反例暴露某维缺失时，必须立即invalid旧Evidence、修审计owner，
再重新分类全部受影响测试，不能只修这一个样例。
审计编译器、mirror scanner和Evidence JSON也受同一存在证明约束：没有真实retention/selection/deletion consumer、复制
module/import parser或只能输出文本启发式时，它们是`orphan | duplicate-owner | diagnostic-hint`，不得因“用于治理”而保留。

## 不可违反的不变量

- 未运行、缺失、skipped、超时、取消、平台不匹配、scope mismatch、stale、损坏或candidate self-proof都不是PASS。
- `not-applicable`必须有可信applicability proof；它不等于required但没有执行。
- zero-test/empty selection只有在Target/Gate contract证明不适用时才能not-run；否则invalidated/unresolved，不能passed。
- executed/reused result只有在Claim owning environment满足时才能支持该Claim。
- Aggregate状态与Claim输入顺序无关；duplicate/missing/unknown identity fail closed。
- 一项Check只证明它绑定的exact candidate、Binding、Delta/Compatibility subject、profile、environment和input closure。
- 测试主体通过但cleanup/readback/receipt失败，整个Gate仍未通过。
- changed path、owner、required Gate、ImplementationBinding、Delta或Evidence unresolved时fail closed。
- 失败不能通过删除测试、弱化assertion、无边界增加timeout、重复运行直到绿、自动换Provider或把unsupported当skipped消除。
- Provider manifest、类型声明、文档、下载量、单次示例和AI生成测试都不是conformance PASS。
- verifier、selector、Resolver、Delta comparator、Compatibility evaluator、Evidence validator或merge authority的candidate不能只用自身新实现授权自身。
- CI workflow是executor/adapter，不拥有第二套Gate定义、result truth、Eligibility、Delta、Compatibility或test inventory。
- Local cache、聊天、PR body、branch、commit ancestry和人工checkbox不是merge或Implementation Evidence。

## Result 与 Claim 真值

### 五态

- **passed**：required execution或合法reuse对exact input closure证明成立；
- **failed**：已执行但断言、运行、cleanup或Evidence完整性不满足；
- **not-run**：可信applicability/Impact证明无需执行，或尚未执行但如实保留；
- **unsupported**：执行环境/Provider缺少声明能力；是否阻断由上层Requirement/Implementation/Compatibility/Support contract决定；
- **invalidated**：过去结果或当前selection因输入、环境、规则、coverage、identity、Binding、Delta subject或信任变化而失效。

状态和execution disposition正交。`not-run`可以是not-executed，`passed`可以来自合法reuse；但reuse必须保留原execution/environment/input Evidence并满足当前invalidation rules。

### Claim definition

Claim至少绑定：

- claim identity/revision和owner；
- subject/requirement/input digest；
- required/optional Gates；
- owning environment集合或matcher；
- applicability与not-applicable proof；
- invalidation rules；
- supported/required contribution semantics。

Gate的passed状态不能越过Claim environment、identity或applicability。Non-owning observation可以保留为Evidence，但不能poison或支持owning Claim。

### Aggregate

Aggregate固定使用声明的status lattice和deterministic reason selection。Order、Map insertion、duplicate overwrite和first-non-pass都不能改变结果。

Empty Claims、empty required Gates、zero physical observations、cleared supportedClaims、mixed proof identity或unknown contribution默认不能passed。

Aggregate只计算Verification truth，不拥有Mutation terminal、Implementation Resolution、Binding Delta、Compatibility、merge、release或Support decision。

## Gate identity 与 Execution Ledger

Gate contract拥有Requirement/Claim、applicability、semantic inputs、required capabilities、dependencies、resource policy、Result和invalidation；Execution record只描述一次exact subject/environment/provider operation及其start、settlement、cleanup、artifact和receipt。两者不得混成一个run ID、命令或journal path。

ActionKey只绑定会改变证明语义的canonical producer、normalized operation、实际subject closure、contract、environment/tool/provider与dependency topology。branch、PR、session、wall clock、PID、temporary path和scheduler lane都不是semantic identity。只有Gate真实观察whole tree时，whole-tree digest才进入key；等价content在transport identity变化后可以复用Action Evidence，但exact-head Review与Promotion必须重新绑定。

验证身份分为三个单向层次。Authoring project-input identity绑定language/provider、configuration、dependency generation与实际source/module input closure，是编辑期Action subject；Execution attempt envelope引用该identity并拥有attemptId、absolute deadline、startedAt、lease与settlement，这些运行坐标不得进入ActionKey；Frozen candidate Evidence identity只在formal Claim真实观察candidate时绑定exact candidate content与必要的Git tree/generation、environment和terminal Evidence。把attempt时间写入ActionKey会伪造无限新工作，把Git tree机械写入普通authoring key会使等价内容无法复用，反向用authoring/cache identity冒充frozen Evidence则越过了formal边界。

cache、incremental state和terminal lookup都只是上述identity下的derived acceleration或既有事实读取：cache hit/miss不能改变ActionKey或签发Result，terminal只有在key与invalidation closure完全匹配时复用，attempt envelope也不能通过刷新deadline把同一missing subject伪装成新Action。Action identity compiler必须是pure projection，只消费上游issuer已签发的semantic/content/generation identity；不得为了构造或查询ActionKey先retain执行generation、打开process/container、取得Effect capability或执行其cleanup。只有terminal miss且runner赢得唯一start claim后，executor才可取得physical capability并把provider细节写入attempt settlement/readback；若上游generation identity已覆盖其完整physical tree，ActionKey不得再复制leaf executable/package digest迫使复用路径重做同一证明。

Selector只决定RequiredClosure；Action builder规范化输入；runner只消费validated ActionPlan。每个required ActionKey的resolution只有reuse terminal、reuse known failure、join authenticated in-flight、execute missing/stale或block unknown outcome。正式producer在shared provider critical section中先readback existing state，只有absence被认证时才能start一次；start marker存在而terminal缺失是unknown physical outcome，不得通过新session、retry或临时路径重放同一key。

Provider availability只是negative circuit breaker，不是Effect authority。dispatch、execution、publication、Review、merge和closeout各自消费operation-specific authorization、deadline/budget、settlement与readback。候选执行域不得持有credential、status、artifact-finalization或merge capability；trusted assembler只从bounded untrusted output、exact process settlement和validated environment构造terminal Evidence。隔离、archive、process、resource和cleanup细节属于External Provider/Runtime machine contracts，stable文档不复制。

Execution ledger、claim与lease只帮助恢复，不能制造或改写Result。CI/本地/其他provider可以替换physical binding，但必须保留同一Claim/Action semantics并产生可区分的environment identity。具体schema、provider transport、status grammar、sandbox参数、command和current readiness只存在于machine owner和generated projection。
## VerificationSession、Scope 与 MainHealth

VerificationSession是一次frozen candidate从定向到integration/readback的唯一运行协调状态机；它只引用Task Capsule、Scope、Action/Result/Evidence、Review、MainHealth和Integration owner，不复制这些对象的字段或authority。Managed Continuation只reconcile可复用事实和下一合法transition，不是第二Session或执行授权。

Scope proposal、grant与candidate attestation分层：manifest只能提出scope；trusted owner把exact base、authorized/forbidden writes、capability/resource bounds与trust epoch冻结为grant；每个exact candidate由独立attestation证明delta/effects仍是grant子集。candidate、PR body、pointer或self-digest不能给自己扩权。scope/authority变化产生新grant；纯transport/head变化只更新generation与exact-head Review/Promotion binding，不能全局失效subject未变的Action Evidence。

Candidate content identity与transport generation分离。Impact/Action消费content及其真实subject closure，Session/PR消费exact generation，Review消费exact review subject，merge只消费Promotion。任何consumer不得用更弱的上游identity替代自身要求的exact binding；具体hash payload和字段由machine contract唯一拥有。

MainHealth是exact live default commit/tree的独立ledger，不属于Session cache。它必须将同一fresh observation互斥投影为ordinary、repair或locked；ordinary才允许work selection，repair只允许owner-issued repair decision，locked停止。读取不完整、stale、duplicate、provider conflict或unknown一律locked，不能由candidate吸收baseline/provider defect。

Direct local trusted execution、GitHub workflow execution与hosted status/App publication是三个不同boundary。本地可以完成其exact environment下的Verification computation，但不能自行发布hosted status或最终MainHealth；hosted principal、status publication和local/hosted reconciliation必须分别认证并通过same-subject readback闭合。当前是否已经接线、使用哪种provider及其physical参数只由capability ledger与generated current projection声明。

Session transition在每个外部Effect前重新读取operation authority和provider state；running只join，terminal只consume/reuse，authenticated absence才允许claim/start，started-without-terminal或unknown进入reconcile/block。目标事件驱动runtime发布WAITING并由provider event/wakeup重新进入同一operation；legacy polling不是完成态。journal、checkpoint、summary和本地receipt都只是恢复线索，不能替代live readback或签发Effect。
### Capability、平台与执行选择

验证选择只消费exact Delta/Impact、Requirement、fresh terminal Evidence与provider capability；执行集合始终是
RequiredClosure ∩ MissingOrStale。not-applicable必须在进程、队列、下载和锁之前形成typed terminal；fresh PASS复用，
fresh failure停止未变化的失败路径，authenticated in-flight join，同一ActionKey不得启动第二次物理执行。

平台、runtime和provider是Requirement的物理维度，不是重复验证环境。公共Claim/Action/Result/Evidence合同保持平台无关，
平台专属filesystem、process、sandbox、credential与native语义由唯一provider capability证明；没有对应provider时返回
typed unavailable，禁止用另一平台、ambient PATH、裸容器、手工脚本或测试seam冒充PASS。

trusted coordination、trusted observation/assembly与untrusted candidate execution必须是不同信任域。candidate只能作为数据
进入受控执行边界，不能在trusted root执行install/script/test，也不能选择ref、credential、provider或Evidence identity。
依赖、archive、workspace、cwd、executable和输入树必须由retained physical capability绑定，并在Effect前后及settlement后重验。

每个operation共享一个monotonic absolute deadline与aggregate process/argument/output/record/entry/byte预算；child步骤不得重开
窗口或把per-process ceiling伪装成总预算。cache只是不改变语义的derived acceleration，必须绑定exact inputs并在corrupt、foreign、
partial或stale时失效；cache hit、provider availability和process exit都不能签发Verification Result。

重复缺陷只有在canonical owner不变量、production拒绝路径、正负边界、Impact归属、provider/runtime identity与TCB因果闭包
共同更新后才关闭。具体capability矩阵、provider profile、runner实现、resource数值、恢复特例、manual bridge与current maturity
只存在于machine contract、capability ledger、generated current projection和Runtime State；stable文档不得保存。

## Implementation Conformance 与 Resolution Evidence

Implementation Resolution可以消费Verification Evidence，但不能自己制造或改写Result。至少区分：

```text
Provider declaration
→ Conformance Requirement
→ physical Gate / Observation
→ Verification Result / Aggregate
→ Eligibility input
→ Resolution Decision
```

### Conformance Claim

一个Provider/Adapter/Reference/Custom candidate的conformance Claim至少绑定：

- exact Provider/package/version/integrity/Adapter/config revision；
- Semantic Contract/capability subset和Type Algebra references；
- Target/Host/Toolchain/Runtime owning environments；
- input/output/error/cancellation/timeout/retry/idempotency/serialization semantics；
- Effect、Permission、resource、network、process、filesystem、secret和telemetry边界；
- dependency/peer/native/install/build closure；
- positive、negative、boundary、failure和cleanup cases；
- coverage、unsupported/opaque和invalidation rules。

通过一个API示例、typecheck、unit test或单一happy path不能支持完整conformance Claim。

### Eligibility 与 Verification 的边界

- Verification owner只回答exact Claim在exact环境下的五态Result/Aggregate；
- External Provider policy决定Evidence是否足以注册正式candidate；
- Compiler Implementation Resolution把Result、Support、Target和Policy作为hard eligibility/optimization输入；
- Resolver不能把`not-run`、`unsupported`、`unknown`或stale Evidence解释为eligible；
- Result passed也不自动选择candidate，不能越过用户/组织constraints或其他hard conditions；
- candidate未被选择不使其conformance Result失效；Binding或环境变化则必须按invalidation rule失效。

### Benchmark Evidence

性能、内存、bundle、启动、构建、延迟或成本只有绑定：

```text
candidate / Binding revision
Target / Host / Toolchain / hardware
workload / dataset / corpus
warm-cold / cache / concurrency mode
sample count / distribution / outlier policy
measurement tool / method / uncertainty
expiry / invalidation
```

后才能参与`performance`等ResolutionPolicy。单次wall-clock、作者benchmark、不同机器对比或只选有利样本不能成为排名truth。

### Reference 与第三方 parity

Reference Provider和第三方Provider宣称满足同一Contract时，必须消费同一Target-independent conformance suite，再分别执行Target physical acceptance。Reference实现是oracle/fallback候选，不因由SEC维护而自动更可信；第三方实现也不因生态成熟而免除负向和供应链验证。

## Binding Delta 激活后的 Compatibility Evidence

Verification不比较old/new Binding，也不签发Compatibility。以下关系只在Delta/Impact owner已激活`ImplementationBindingDelta`的真实producer、strict contract和consumer后成立；激活前Verification返回typed unavailable，不能从文件、package、semver、测试PASS或自行构造的old/new对象生成替代Delta：

```text
validated old/new Binding
→ Delta/Impact owner produces ImplementationBindingDelta and Impact
→ Verification executes required conformance / behavior / package / runtime Claims
→ Change Management consumes Delta + Impact + Results
→ Compatibility Decision / Migration
```

Verification Claim可以绑定old Binding、new Binding或exact Delta item，证明：

- old/new Contract conformance；
- Adapter是否恢复旧timeout/retry/error/serialization/Effect语义；
- Target、dependency、native、install/build和package surface；
- consumer/runtime/behavior parity或明确差异；
- migration/rollback/compensation前置条件。

但Verification Result只证明该Claim，不得：

- 重新生成或修改`ImplementationBindingDelta`；
- 把测试绿解释为Delta为空或Behavior兼容；
- 把未运行/unsupported/partial结果解释为Compatibility；
- 选择Provider、Adapter或Migration路线；
- 用new implementation的自带tests单独授权自身Compatibility。

## Impact、Applicability 与选择

Verification选择从Requirement/Claim obligations与canonical Impact/consumer graph派生，而不是从测试文件、目录、标签或固定命令表派生。每个Gate声明自己证明的Claim、真实subject closure、capability/environment需要、failure space、成本和invalidation；selector只求`RequiredClosure ∩ MissingOrStale`。

选择流程按以下单向关系工作：

```text
authorized change / exact subject
→ semantic, binding, repository and physical Impact
→ required Claims
→ applicable Actions
→ reuse | join | execute | block
```

known not-applicable必须有owner proof；unknown Impact扩大closure或停止，不能解释为无需测试。Full/Release只作selector校准和unresolved backstop；发现漏选时修复relation/owner/selector并失效受影响Evidence，不能永久把漏项塞进Full。

Source Program/import graph负责静态consumer；动态source read、provider invocation、artifact/config input和其他无静态import边的consumer由其唯一owner声明，并由machine census验证。测试不得通过读取production源码文本、固定路径、函数arity、版本、模块数量或实现清单制造impact edge；真实外部协议、持久readback、Effect/failure和algorithm property仍可拥有精确断言。

Repository Module owner唯一拥有“某路径是否是测试模块候选”的词法语法；Source Program在exact source revision上发布真实registration与consumer observation，Test Impact只消费该投影。runner、budget、Work Package、CI Action、审计与测试价值编译器不得各自复制`tests/**`、扩展名或colocated-test正则，也不得把词法候选升级为已执行、已覆盖或有业务价值的证明。领域策略可以在同一候选identity上进一步投影slow suite、acceptance或process isolation，但不能重定义测试模块身份。

Plan/query路径必须zero Effect：在dependency preparation、cache write、process/provider start、network和filesystem mutation前返回选择结果。执行缓存只属于Action/runtime owner；pure selector不得为登记、统计或性能而创建格式、目录或lifecycle state。cache开关、进程重启或incremental/full算法不能改变同一exact input的selection bytes。

Environment、credential、runtime global与provider capability是显式authority input，必须通过唯一reader和capability graph进入Action，不能靠denylist、变量名、ambient inheritance或测试注入证明安全。具体environment keys、Source Program规则、test-impact declarations、cache layout和current coverage由machine contracts/generated projection拥有，不进入stable正文。
## Candidate、Epoch 与 Failure

```text
Authoring → Candidate → Frozen → Published/Merged → Readback
```

只有Frozen candidate content和冻结Binding可以签发最终Evidence。source/manifest semantics/profile、
Requirement/Candidate catalog/ResolutionPolicy/Binding/BindingDelta subject、required Gate、Claim
definition、Action subject closure或trust input变化，会产生新content/epoch或只失效其依赖
descendants。仅 exact Git head/transport变化总会失效CandidateScopeAttestation、Review、Session
revision和Promotion，但不得自动失效 ActionKey 未变的Evidence；最终 Aggregate仍必须重新绑定新的
exact generation。

Failure record至少包含：code、phase、Gate、owner、invariant、exact input、minimal reproduction、failure fingerprint、invalidated Evidence、cleanup state、next action和retry policy。

输入与failure fingerprint未变化时复用失败并停止；重复运行同一确定性失败不是进展。Transient retry必须绑定可观察因果变化，例如锁owner退出、网络/外部服务恢复、cache按authority重建或runner incident结束。

重复同类frozen invalidation要求proof reset，回到reproduction、owner、contract、fixture、Resolver、Delta comparator、Compatibility evaluator或test architecture；再次出现说明需要redesign，不能继续补丁循环。

### 静态编译证明不是代码测试

TypeScript `typecheck`拥有source与public contract在指定compiler/toolchain下可构造的静态证明；unit、
integration、browser、provider与runtime test拥有行为证明。二者不可互相替代，Independent Review也不能
代替compiler求值。用户要求“不运行代码测试”时，默认只移除会执行产品或fixture行为的test，不移除纯、
零写的compiler proof；只有用户显式禁止静态编译器执行时才可省略，并且该generation只能标为
`progress-only / compiler-proof-missing`，不能表述为healthy、verified或completed。

普通TypeScript delta只在source、generated trust closure与imports最终稳定后运行一次post-delta typecheck，
不在每个finding后重复。same-input compiler failure直接复用；修复后只执行被该delta失效的compiler proof，
不因此升级到affected、full、release或nightly。自动MainHealth若发现此前省略的compiler defect，该failure是
新的exact-main事实并进入content-addressed repair lane；长期A0任务按new-main epoch自动继续，不能把
Independent Review PASS、manual merge成功或用户未再次输入“继续”解释成任务完成。

## Hermetic Runtime

每个physical Gate的资源生命周期目标为：

```text
prepare → allocate → execute → terminate
→ cleanup → readback → receipt
```

资源先分类：immutable-copyable、rebuildable、identity-bound、process-bound、non-copyable-control-state、external-capability或unknown。Unknown默认拒绝复制、共享或并行。

Workspace、`.sec`子域、temp/cache、port、process group/Job Object、browser、database、environment、network、logs和residue都有唯一owner。复制workspace时identity-bound lease/journal/control state不能当普通目录复制；rebuildable cache也不能被发布成Evidence。

执行不受信Provider/package/install/build/test/runtime代码时，需要独立credential-free sandbox、bounded filesystem/network/process/resource和cleanup Evidence。普通临时目录、Node VM、browser context或静态lint不构成恶意代码sandbox。

Hermetic Runtime、resource allocator和cleanup receipt需要独立真实consumer驱动。现有测试有隔离行为不代表统一runtime已完成。

任何会启动process、server、browser、native/provider child或创建持久/外部状态的test Gate，都必须由一个owner-issued effectful-test supervisor绑定exact Action/child plan、共享monotonic absolute deadline、aggregate budget与cancellation capability。primary failure、cancel或deadline到达后，supervisor停止新admission，cancel/terminate全部已启动child，等待termination/stream settlement，完成owner-scoped cleanup与independent readback，再签发唯一Gate terminal；cleanup或readback unresolved使Gate失败，但不得覆盖更早且更具体的primary outcome。仅等待Promise、父进程退出、caller timeout或finally日志均不能证明cancel、physical settlement、cleanup或terminal闭合。supervisor只协调Action、workspace/resource与physical provider owner签发的capability/receipt，不重新实现spawn/kill/delete，不签发第二ActionKey或第二cleanup authority。

## 反馈与 Gate 层级

```text
focused failing sentinel
→ affected local closure
→ candidate pre-freeze
→ frozen hosted Quick / selected Risk
→ virtual merge / Release Full backstop
```

这不是每次都全跑的固定流水。普通编辑循环只运行会被后续修改自然失效的focused proof；browser、native、durable、package、Provider conformance和release Gate等candidate稳定后由selector运行一次。

不同变化类型使用最小充分门禁：pure validator、docs owner、trust root、Resolver、Delta/Impact、Compatibility、Provider、runtime/package和formatter的Evidence要求不同。统一重门禁会拖慢开发且不增加证明；统一轻门禁会假绿。

性能目标与正确性Gate分离。单次wall-clock只提供诊断；结构性工作量、固定环境的多样本基线和可重复回归才可形成性能裁决。

编排性能使用分离指标，不能把worktree和ref混成一个比率：

```text
MutableWorktreeAmplification = mutable worktrees / active logical runs
ActiveRefAmplification = active candidate refs / active logical runs
FindingSuccessorWorktreeCount
ActionExecutionAmplification = physical Action starts / unique required missing ActionKeys
```

前两项正常目标均为 `1.0`，finding successor worktree目标为 `0`，Action execution目标为
`1.0`。candidate generation数量只作诊断；同root cause反复frozen invalidation触发proof reset/
redesign，而不是禁止合法 finding generation。

## Evidence DAG 与 Run State

Evidence是不可变、content-addressed的proof DAG：每个node引用exact subject、Claim/Action contract、environment/provider、Result、artifacts和predecessors。fresh node按真实invalidation复用；known failure可复用为失败事实但不能变PASS；跨baseline组合必须证明intervening Impact coverage。

Review是独立external Verification Action，不是并列产品状态机。它绑定exact review subject、独立principal、required owner/consumer/Effect/recovery/doc closure和unknown frontier；head/tree、required owner revision、policy或review facts变化使receipt stale。Review prose只解释typed findings，不能成为产品状态、测试矩阵、路径清单或第二authority。

VerificationSession journal只记录run/event/transition/resume，Evidence记录proof，两者以typed references连接。journal、claim、checkpoint、summary和本地锁只能帮助恢复；丢失它们不能制造、删除或改写Result。所有外部Effect必须有stable operation identity、pre-effect intent、provider settlement与post-effect readback。

恢复统一遵守：running join、terminal consume/reuse、authenticated absence claim/start、started-without-terminal或unknown reconcile/block。download、build、materialization和cleanup也遵守同一代数；完整generation可认领，partial/foreign/user-mutated/unknown对象保留。Trust epoch变化使旧Session/Review/authorization stale，并按new-main canonical facts重建下一epoch；不自动丢弃仍满足subject closure的immutable Evidence，也不要求用户重新说“继续”。

具体journal schema、filesystem layout、cursor、provider event、artifact retention和current runtime readiness由Runtime/Verification machine owners及generated projection拥有。未完成真实integration/CAS/provider forward tests时，只能标记runtime unresolved，不能用pure decision test或stable文档声称统一ledger已闭合。
## Trusted Bootstrap

Verifier、selector、Resolver、Delta comparator、Compatibility evaluator、docs-doctor、Skill/Agent contract、Evidence validator、workflow和merge gate等trust-root candidate不能用自身新增规则自证。

Trusted base-side runner把candidate Git tree当不可信输入，在无凭据、只读source、独立writable root中运行旧authority下的回归和adversarial vectors。Bootstrap Evidence绑定trusted verifier revision、candidate tree、runner image、lock/dependency、platform、plan、output/cleanup digest。

Candidate自带测试只能作为补充，不能授予自身合并权或把自己的Resolution、Delta、Compatibility结果标为正确。Trust migration成功后必须从新main重新加载trust root；旧会话/Review/Evidence不能继续授权新epoch。

长期 trust root 分三层，且不建立第二 Verification pipeline：

- **Tier 0 Transition Root**：只拥有Git object/ref exact identity、CAS/readback、principal
  verification、canonical digest/schema primitives、old→new TCB closure comparison 与 transition
  receipt；
- **Tier 1 Evolvable Verification TCB**：selector、ActionKey/Evidence、Review validator、merge gate、
  docs/toolchain/provider policies；
- **Tier 2 Product**：普通产品与工程实现。

Tier 1变化由旧trusted owner计算affected trust closure，candidate nodes只作untrusted SUT，Tier 0
验证node receipts与完整new-TCB aggregate后签发`TrustEpochTransitionReceipt`；未受影响node可以
内容寻址复用。只有Tier 0自身变化才进入manual break-glass。selector、docs-doctor、Provider逻辑、
test-impact或merge policy不得逐步回流Tier 0形成bootstrap monster。

旧trusted owner分析candidate时必须把exact candidate Git tree当作immutable data：tree inventory与
普通blob bytes由旧main-owned Git provider读取，module/path/test taxonomy仍由旧main合同决定，禁止
执行candidate selector或从candidate worktree/mtime推导closure。被TypeScript真实import的machine data
通过同一reverse dependency graph传播；无consumer、无base-owned owner且无法分类的对象继续
`unresolved`，不能靠candidate新增路径规则自解锁。

`owner-only`只截断generic reverse-import fanout，不截断验证责任。它必须来自当前trusted main中的完整
semantic owner声明并列出独立failure-space evidence；新owner第一次进入仓库时candidate声明不具备该
authority，仍按旧main保守closure或显式bootstrap repair验证。合入并readback后，后续相同owner编辑才
复用精确sentinel。普通selector/docs/package control编辑不得仅因路径命中而升级为全业务slow baseline；
package/provider、selector、documentation各消费自己的明确conformance/contract evidence。全量业务执行只作
release/nightly、真实global fixture/runtime change或selector calibration backstop。

trust-root policy registry只拥有static path、runtime entrypoint、required-surface下界、reviewed boundary、
Effect dispatcher与外部能力等人工策略输入；不得复制或手工维护import graph派生的causal module清单。
受信base的pure compiler从immutable exact candidate Git tree一次派生module、edge、blob、content digest、
trust revision与closure digest，并与registry组合成唯一runtime trust-root view。Git tree已经拥有每个源码
byte的完整性，仓库不得再提交generated module/blob表、`generatedAt`或第二份lock。

TCB Evidence的ActionKey至少绑定trusted compiler/policy revision、exact candidate tree与execution
environment；同一key的PASS、known failure与in-flight分别复用、停止或join。Impact没有命中TCB closure时
不编译、不检查、更不运行TCB测试；命中时old-main compiler读取candidate tree bytes但绝不执行candidate
compiler。任何新privileged entrypoint仍由source owner引用唯一`TRUSTED_VERIFIER_TCB_FAST_TESTS`，这是
consumer edge而不是第二个module inventory。

registry或Tier 1 compiler受权变化由old-main compiler形成old→new transition Evidence；candidate新增规则
不能把自己判为PASS。只有Tier 0 transition root自身变化才需要独立manual break-glass。因为不存在与同一
Git tree并列的checked-in generated lock，普通合法迁移不会再出现stale-lock自锁、手填时间、apply writer、
archive/CAS恢复或merge冲突。

Git hook是可替换的authoring便利层，不是TCB authority。managed hook的active marker只阻止依赖安装递归；
commit/push不机械重算TCB closure，`--no-verify`也不能绕过effect前由Verification/Integration consumer对
exact tree与ActionKey的强制消费。无关delta因Impact不命中而保持零TCB工作。

## Property、Fault 与 Flake

- Pure property优先覆盖identity/revision/normalization/serialization、经machine admission激活的适用Delta/Impact、Requirement/Candidate/Decision/Binding、Compatibility rule、state machine、fixed-point、deterministic ordering、tie-break和clean/incremental parity；activation缺失或unresolved时selector保持blocked/unknown；
- Property失败要shrink并保存最小反例、seed、producer revision和replay入口；
- Physical fault遍历prepare/write/fsync/publication/terminal/cleanup/recovery等持久化边界；
- retained或path-sensitive effect必须先冻结从authority root到effect leaf的完整identity、liveness、effect和readback chain，
  再一次性枚举watch建立前、每个component打开边界、effect前后及terminal readback的替换窗口；同一根因不得按
  Reviewer逐次发现的单个leaf/parent/ancestor窗口局部结案，fault corpus必须证明整条chain而不是当前反例；
- Windows、Linux、macOS、WSL和不同filesystem capability的Evidence不互相替代；
- Retry只收集flake Evidence；多次中一次绿不能改写失败；
- Quarantine必须有owner、expiry、替代coverage和退出条件；
- Mutation testing只用于高价值pure kernel/validator/authorization/eligibility/delta/compatibility/fail-closed/selector校准，不进入普通save loop。

开发控制面cutover的contract/fault corpus至少覆盖：same content/different commit得到相同
CandidateContentId但不同GenerationRef；两个writer对同expected-old ref只有一个CAS成功；在object、
tree、commit、ref publication、readback与worktree projection每个边界crash后可确定恢复；scope扩张
无法沿用旧ScopeGrant；旧Review不能授权新generation；ActionKey未变时fresh PASS/FAIL不重新执行；
start-without-terminal永久阻止同key replay；candidate projection失败不改变ActiveMainControlState；
provider epoch在prepare后、effect-start前失效时physical provider调用为零；merge response丢失后只
readback且不第二次调用effect。所有已知历史run grammar必须经其隔离migration/replay owner收敛成一个run、一个mutable worktree、一个
active ref与多个immutable generations。

## Evidence 与 Provenance

- Artifact Provenance：文件或产物从哪里来；
- Fact Provenance：semantic assertion为什么成立；
- Verification Evidence：某个exact execution证明了什么；
- Runtime Observation：某个环境实际发生了什么；
- Provider/AI Evidence：带coverage、freshness和不确定性的候选解释；
- Resolution Evidence：Requirement、candidate、Eligibility、policy、measurement和淘汰原因的引用；
- Delta references：old/new endpoint、Comparator revision、Delta item和Impact witness；
- Compatibility Decision Evidence：规则、Delta、Result、环境与用户decision references。

Predicted Impact、planned selection、Eligibility、Resolution Decision、actual Delta、Compatibility Decision、executed Result、Aggregate和上层Decision是不同对象。它们之间必须有显式references，不能复制字段后当作同一事实。

代表成功或可消费provider artifact的contract fixture必须通过当前canonical constructor、reducer与finalizer
生成完整对象；手写旧schema片段、payload与metadata自相矛盾的fixture只能用于明确的malformed负向用例，
不能替代目标authority boundary。source-lock必须约束真实因果阶段、唯一调用数和effect前后顺序，不能以
跨阶段token禁令误杀合法的pre-effect guard；merge/readback后的观察面仍保持writer capability为零。
共享test fixture使用独立的最小test-impact owner，只选择其直接consumer与selector contract，不得挂入
无关的宽production closure，也不得成为无owner的selection空洞。

## Merge Authority

Merge authority只来自trusted integration owner在effect前对exact base/head/tree、Scope grant/attestation、required Claim/Evidence aggregate、fresh independent Review、blocking feedback、MainHealth、trust/ruleset、dependency与适用的Binding/Delta/Compatibility refs的完整重算。PR body、comment、Check、status、journal、管理员身份、本地JSON或serialized receipt本身都不能授权merge。

Review-stable barrier必须在expensive formal Actions前clear，并在merge authorization前重读。Review provider的presentation text不能通过开放字符串匹配产生clean verdict；语义分类由provider contract的closed typed projection拥有，identity、pagination、reviewed commit、threads与request-changes必须完整。具体文案和grammar不进入stable正文。

Integration authorization是provenance-bound、single-use、bounded-lifetime的进程内capability，只能在同一trusted provider operation和repository/default critical section中消费。effect前再次读live facts并验证未消费；provider response丢失或marker/PR状态ambiguous时只做readback/recovery，绝不blind replay或绕过保护。

成功必须证明merged tree等于verified candidate tree，并由同一integration transaction完成remote main、PR、Issue disposition、branch/worktree closeout和new-main readback的有序协调；各physical action仍由自己的owner执行。ref/worktree/temporary provider cleanup只有在creator、preimage、identity、absence与retirement authority闭合时进行，unknown或foreign residue保留并阻断completion。

new-main readback重载实际Product/contract/Binding/Delta/Compatibility/support surface，关闭absorbed/superseded owner并使旧Session/Review/authorization stale。历史branch、commit ancestry、PR prose或旧Evidence不能代替。provider-specific workflow、marker、comment、merge API、command、path和current readiness由External Provider/Integration machine contract与generated projection拥有。
