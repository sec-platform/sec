---
title: Semantic Mutation 事务
status: stable
domain: semantic-mutation
---

# Semantic Mutation 事务

本文拥有受限语义意图到 Authoring/Governed Source transaction 的状态机、权限消费、计划/执行分离、writer协调、原子发布和恢复不变量。精确request/plan/result union、operation registry、journal schema、diagnostic、path算法、lease实现和retention由authority registry注册的machine contract及各自唯一owner拥有；目录、聚合facade、barrel和合同测试不建立第二owner。

## 定位

Semantic Mutation不是“让AI改文件”，也不是任意patch executor。它把一个受限intent在平台重新派生的authority、owner、source mapping、Delta/Impact和Verification边界内，转化为可计划、可拒绝、可提交或可恢复的canonical transition。

它只修改Authoring Source、Governed Source或相应domain的受权威输入。Engineering IR、Target IR、Projection、Artifact、Evidence、journal和`control/**`不能作为caller指定的写目标。

<!-- sec-clause {"blocker":"current-maturity-projection-unavailable","kind":"temporary-safety-denial"} -->
### 临时安全否认与激活边界

以下current条款只是在generated current projection尚未materialize期间防止未授权surface被误读为supported的temporary safety denial；
它们只收窄能力，不签发任何positive maturity。`current-maturity-projection-unavailable`是迁移blocker；exact-tree projection完成
machine contract、producer、consumer与readback后，这些current denial必须在同一cutover中原子迁出stable spec。

fault tests不能证明production Effect authorization或recovery authority闭合。issuer-bound production Effect grant、统一product adapter、Brownfield Governed Source
mutation、多文件transaction、resource-level并行以及CLI/AI/HTTP transport尚未共同闭合；它们分别保持
`not-production-authorized | unresolved | proposal`，不能因本文稳定、public function存在或测试fixture可调用而投影为supported。

当前公开plan/apply合同仍能接收结构化authorization projection；在issuer-bound principal/scope/effect capability被唯一trusted
ingress签发并由public入口强制消费前，该surface只能视为内部/未激活能力，不能签发production Effect authority。caller可重算的
self-digest、JSON、管理员权限或测试issuer都不能升级为grant。

当前`plan`不是本文目标态的pure plan：它会获取workspace write lease、创建或删除目录、复制workspace并写staging，因此当前maturity必须投影为
`public-plan-effectful | not-production-authorized | trusted-ingress-unenforced`。这些Effect不能因方法名叫plan、发生在临时目录或最终live source未改变而被忽略。
目标态的plan为zero-Effect纯函数；staging、backup、journal和任何持久写全部属于持有issuer-bound grant的Apply transaction。

当前事务实现还存在`staging-before-prepared-journal | authorization-recovery-unresolved`：首个operation-owned durable Effect可能早于prepared intent，
journal又能保存caller projection并在恢复时被误作authority。当前workspace到Semantic Mutation的reverse dependency、Semantic Mutation与Verification的
reciprocal dependency以及第二个Engineering Operation writer也尚未完成机器退役，均不能被本文稳定状态掩盖。

## 角色与权力

- **Caller / User / AI / CLI**：提交intent、target、允许的参数和业务expectation；
- **Product Policy**：把caller身份、workspace policy和operation request组合为authorization draft；
- **Source Mutation Operation Registry**：只拥有Engineering Operation交给本executor的领域operation discriminant、target kinds、required inputs、source adapters和不可降低的required Claim references；
- **Source Ownership Resolver**：从validated state解析唯一owner、canonical path和writable region；
- **Planner**：只读构建deterministic plan；
- **Transaction Executor**：在writer lease内重新计划、执行、发布和恢复；
- **Compiler / Delta / Impact / Verification**：独立产生canonical state、actual change、影响和验证结果；
- **Journal / Recovery**：持久化事务事实，不拥有产品语义。

Caller不能提交或伪造path、source bytes、source owner、Fact Delta、Impact、risk、required Claim closure、rollback decision、lease token、journal state或terminal result。Agent Operation、产品Engineering Operation与Source Mutation Operation是不同identity/authority域，不能因都叫Operation而共用caller DTO或writer。

当前竞争的Engineering Operation写入路径是待退役的orphan candidate，而不是兼容入口：最终census若证明没有真实consumer，就删除整个producer/reader/test图；若证明它拥有真实用户意图，则只把该意图投影到Source Mutation Operation，不保留第二个publisher、journal或terminal owner。

## Authorization 交集

最终权限是所有边界的交集，而不是任一宽权限的并集：

```text
issuer-bound principal / caller capability
∩ allowed operation
∩ semantic target
∩ canonical source owner
∩ physical writable path/region
∩ preconditions and must-preserve facts
∩ policy and forbidden effects
∩ Target/Provider capability
∩ required Claim references
∩ current workspace/candidate revision
```

任一项unknown、ambiguous、stale、conflicted或不兼容时拒绝或blocked；不能通过另一个Provider、AI confidence、文件存在或管理员权限自动补齐。

Authorization绑定workspace、app/domain、request/operation、target identity、base semantic/source revisions、policy/revocation epoch、principal、Effect/Permission、provider capability和expiry。它必须由不可伪造issuer capability签发；旧authorization不能跨workspace、rebase、owner migration、provider drift或operation registry升级复用。

## Operation Registry

每个operation必须有唯一identity和discriminated schema；只有真实durable/external/cross-process/migration consumer需要区分多个状态时才建立revision/dispatcher。它声明：

- target kinds和required semantic predicates；
- caller可提供的参数和明确禁止的derived字段；
- source owner/adapter requirements；
- allowed/forbidden paths、Effects和external capabilities；
- preconditions、must-preserve和postconditions；
- expected Delta shape和额外变化政策；
- Verification owner签发且caller不可降低的required Claim references和unsupported behavior；
- idempotency、retry、rollback/recovery与compatibility；
- positive、negative、concurrency、fault和round-trip tests。

新增operation不能在transport/UI另写一套switch。不存在registry entry时unsupported-before-write，不降级为任意source patch。

## 计划阶段

目标Plan/dry-run固定只读且zero-Effect：

```text
validate raw request
→ resolve authorization and current validated base
→ resolve unique semantic target and source owner
→ resolve canonical path/region and source-byte identity
→ run isolated deterministic transform
→ rebuild validated canonical state
→ compute actual Fact/Entity Delta
→ compare expectations and postconditions
→ compute Impact and unknown frontier
→ collect conservative owner-issued required Claim references and unknown frontier
→ classify risk/capability/resource requirements
→ emit immutable plan or blocked diagnostics
```

Plan必须绑定：operation/authorization revisions、base semantic/source revisions、source bytes digest、owner/path proof、expected/actual preview、Impact、owner-issued Claim/reference revisions、provider/toolchain/profile revisions、estimated Effects/resources和expiry。

Plan不能写live source、创建live journal terminal、获取长期writer authority、启动不需要的production side effect或把staging bytes当作未来authority。
在pure-plan cutover前，当前effectful public plan保持typed unavailable；不能靠“只写临时目录”、测试issuer、caller authorization object或cleanup成功把它升级为production Plan。

## Source Mapping 与 Path Proof

依赖方向固定为：

```text
validated Semantic Responsibility / Operation authority
→ Adopted source binding and allowed mutation
→ Source Program exact physical/symbol observation
→ unique mapping join
→ path/region proof
```

Semantic/domain authority来自authority registry与Semantic owner。Source Program只证明file、symbol、span、module、reference、consumer、physical owner与unknown；它不能创造semantic owner、allowed operation、
Effect grant或product support。Brownfield source只有在Reconcile/Adopt已经冻结semantic/source binding与operation contract后才可写。

当前workspace层反向依赖Semantic Mutation runtime会使Source Program/ownership观察与写入事务形成环；这是`workspace-mutation-reverse-dependency-unresolved`。
目标DAG只能由Mutation消费Workspace/Source Program的contract或query projection，Workspace不得反向importMutation command/runtime。

Semantic target到物理source的映射只有一个canonical producer。Path proof至少验证：

- repository/workspace identity；
- canonical repository-relative POSIX logical path；
- target-platform physical resolution；
- owner、writable region、generated/governed/opaque分类；
- symlink/reparse/junction/case/Unicode/path containment；
- file type、mode、source-byte digest和expected revision；
- forbidden `control/**`、journal、IR、Evidence和unowned区域。

绝对路径、UI传入路径、Provider related files、glob命中或字符串拼接都不能获得写authority。Mapping不完整时fail closed；Brownfield opaque region只能执行其显式adapter允许的operation。

## Isolated Transform

Transform必须在隔离root或内存模型中执行，输入只来自frozen plan所引用的authoritative source和validated context。它需要：

- deterministic output和canonical formatting策略；
- 保留comments、format和unowned regions的明确合同；
- 不执行ambient install/build/script/network，除非operation显式要求且有Provider capability；
- 不读取未授权secret/environment；
- bounded output、time、memory、process和network；
- parse/type/canonical rebuild失败时无live副作用。

AST/LST/codemod/AI结果都是transform实现或proposal，不自动证明semantic parity。

## Expectation、Delta 与 Impact

Caller可以声明业务expectation，但actual Entity/Fact/Assertion Delta由统一canonical producer计算。Planner/Executor检查：

- required change是否出现；
- forbidden change是否出现；
- must-preserve事实是否保持；
- additional changes是否在显式allowance内；
- source/artifact changes是否能追溯到semantic change；
- unknown/opaque/impact frontier是否超出authorization。

Predicted preview不能在apply后复用为actual。Lease内重建结果与plan不一致时必须重新plan或拒绝，不能只更新显示摘要。

Impact只推荐下游consumer/Acceptance/Gate的typed references；最终Verification Requirement、applicability、Action、Result与Aggregate由Verification owner结合Repository、Target、platform和Evidence重算。Semantic Mutation只拥有Claim/receipt的消费时机、与transaction的binding以及typed references，不定义通用Verification taxonomy、最低验证集合或状态词汇；Verification contract也不得反向importMutation或Compiler runtime形成reciprocal owner。Caller不能降低required closure或把not-run/unsupported当pass。

## Apply 与并发

Apply固定执行：

```text
validate request + expected plan identity
→ acquire unique workspace writer authority
→ reread live source/canonical state/policy/providers
→ re-resolve owner/path and re-plan
→ compare plan equivalence / CAS
→ publish authenticated durable prepared intent
→ stage exact writes and backup/recovery material
→ run required pre-publication verification
→ publish atomically or by journaled protocol
→ rebuild live canonical state
→ recompute actual Delta/Impact
→ run post-publication/readback verification
→ terminalize accepted | rejected | rolled-back | recovery-required
→ release writer and cleanup with receipt
```

Apply不信任旧staging、旧path proof、旧Provider index或旧Impact。所有live writers服从同一个workspace writer authority；不同operation即使路径不同，也只有在未来domain/resource resolver证明安全时才能并行。

prepared intent必须先于本transaction的第一个durable staging、backup、directory或source Effect，并绑定authenticated grant locator、issuer、epoch、workspace、operation、preimage和effect budget。不能在Effect发生后补写journal来追认authority。

Source-byte CAS和semantic CAS同时成立才可发布。另一个writer、manual edit、rebase、owner migration、policy change、Target/Profile change或Provider invalidation都会使旧plan失效。

## Publish Boundary

发布前必须知道本source transaction授权的全部Authoring/Governed Source writes、deletes、renames和modes。多文件source变化不能用逐文件“尽量成功”实现原子性；需要staging、journal、commit marker和recovery protocol。

Mutation write set只包含authoritative Authoring/Governed Source inputs。Derived IR、Projection、Artifact、package和runtime output只进入invalidation、Impact、Claim或readback reference；其重新生成和发布由Compiler/Composition/Runtime owner负责，跨revision的数据或外部补偿由Change Management负责，Mutation不得顺手成为artifact publisher。

Publication result至少区分：

- definitely not published；
- definitely published；
- durability/publication unknown。

不确定状态不能删除backup、journal或潜在authority。Process返回、文件存在、rename调用成功或parent directory未fsync都不足以单独证明durable commit。

## Terminal Result

产品级terminal只有：

- **accepted**：authoritative inputs已发布，live canonical rebuild与required Verification/readback通过；
- **rejected**：没有发布live changes，原因和next action明确；
- **rolled-back**：曾可能/已经发布，但exact prior bytes、modes和base canonical state已恢复并验证；
- **recovery-required**：无法证明accepted或exact rollback，需要唯一恢复流程。

不存在`partial-success`、`accepted-with-warning`、`failed-but-files-written`或“产品测试通过所以忽略cleanup”。Blocked是plan状态，不是伪terminal。

## Rollback

CAS-safe rollback必须避免覆盖后继合法writer或用户变化：

- 只恢复本transaction拥有且仍匹配published identity的路径；
- 使用journal记录的prior bytes/mode/absence和directory effects；
- 恢复后重新构建base canonical state并验证revision/observable contract；
- 不删除后继generation、unowned文件或不确定publication；
- rollback本身失败/中断继续保留recovery-required。

Artifact rollback从accepted canonical revision由对应Compiler/Composition/Runtime owner重新生成，不用旧artifact copy冒充authority。数据/外部系统rollback取决于Change Management定义的migration/compensation策略。

## Semantic Mutation Transaction Journal

Semantic Mutation Transaction Journal是append-only或等价durable transaction recovery state，至少绑定：

- transaction/operation/authorization/plan identity；
- workspace、base/live revisions和writer lease；
- source owner/path proof和write set；
- prior/staged/published identities；
- phase transitions、verification refs、cleanup和terminal result；
- recovery preconditions和retention/compaction lineage。

Journal只保存authenticated grant locator/issuer/epoch、已经开始的Effect、CAS preimage/current、transaction phase与恢复事实；不得把caller projection、self-digest、journal自身、文件路径、ACL、管理员身份或旧authorization payload保存成可重新签发或延长grant的authority。

Journal不是Engineering IR、Authoring Source、Evidence替代品或UI状态。Terminal replay只能返回retained result，不重新执行副作用。Compaction必须保留active/uncertain/recovery generations和terminal lineage；不能按时间或文件数量删除唯一恢复证据。

### 持久 revision 的序列化版本

已发布journal grammar与contract revision所绑定的exact serialization bytes属于对应durable schema，不能随平台通用canonical
primitive实现变化。Reader与writer必须通过该schema的唯一machine digest owner计算request、authorization、plan、verification、
result、recovery、terminal及isolated verification bindings；source、artifact、bundle与stream bytes仍使用raw byte digest。
具体format/revision数字、物理路径和算法常量只存在于strict schema/parser/writer。Production writer/reader/migration消费唯一owner constant；测试消费owner constant/fixture并验证public strict behavior，只有malformed或legacy migration负例可以使用受控字节。禁止手抄当前owner、路径、版本或逐实现镜像。

同一 format/contract revision 不能同时接受或生成第二种结构化序列化，不能在读取时重算、
改写或删除历史 journal。若未来采用 sorted-key canonical JSON，必须先发布新的显式
format/contract revision，由 version-dispatched reader、migration receipt、retention 与旧 writer
consumer-zero 退出条件共同完成迁移；未声明版本的算法漂移必须 fail closed 并作为 compatibility
defect 修复，不能用 fixture refresh 或永久 dual-read 掩盖。

## Crash 与 Recovery

Recovery从read-only inspector读取workspace writer和journal状态，分类：

- 未开始publish：安全拒绝并清理staging；
- publish未发生且可证明：恢复not-published terminal；
- publish已完成但post-check未完成：重建live state并继续验证；
- 部分/未知publication：按journal和path CAS恢复或进入operator-required；
- prior rollback中断：继续同一recovery，不创建新普通operation；
- owner仍live或状态拓扑不可信：停止，不抢占。

Recovery必须幂等、可重入并绑定exact transaction/generation。只有已由有效grant开始、且journal可证明由该transaction拥有的CAS settlement可以继续恢复；尚未发生首个Effect的新operation必须重新取得当前issuer authorization，不能从journal或caller projection续租。超时不自动证明owner死亡；Windows/Unix/process/filesystem Evidence分别验证。

## Verification Claim / Receipt 消费

Mutation只在pre-publication、post-publication/readback与terminal settlement处消费Verification owner签发的typed Requirement/Action/Result/Claim/Receipt reference。具体分类、适用性、影响选择、ActionKey、执行、聚合和Evidence freshness全部属于Verification owner；本文不复制最小套件、平台矩阵或状态枚举。

Pre-publication Claim用于阻止已知无效变化；post-publication/readback Claim证明live state和observable结果。缺少required Claim、unsupported、stale、cleanup失败或unknown Impact时不能显示accepted。当前Mutation与Verification的双向runtime import是`mutation-verification-owner-cycle-unresolved`，必须通过contract/query projection打断，不能用facade或index隐藏。

## Product Adapter 与 Transport

若未来存在真实CLI、Agent或其他transport consumer，它们只能消费同一product operation adapter：raw DTO validation和trusted
authorization ingress之后调用canonical plan/apply/query/recover。Transport不实现owner、path、risk、Delta、Impact、Verification
或terminal switch，也不能成为production authority issuer。当前没有闭合的public transport时，不保留HTTP/UI/alias route或测试空壳；
future activation只以owner-issued operation obligation存在，直到真实consumer、security boundary与readback全部实现。

## Retention、Audit 与隐私

持久记录只保留恢复、审计、Provenance和策略要求需要的最小数据。Secret、credential、source bytes、absolute host paths、AI prompt和环境变量按分类redact/encrypt/omit；backup/journal有owner、permission、expiry和安全删除条件。

Audit记录operation/caller/product policy、authorization、plan/result digests、actual source/Fact Delta、Verification和terminal，不需要保存模型隐藏推理。

## 支持与扩展

首个operation不能被泛化为“任意Semantic Mutation已完成”。每个新operation独立通过registry、source adapter、positive/negative/concurrency/fault/rollback和product acceptance。

跨domain Mutation（Documentation、Gate、Agent、Release、Repository）在相应Workspace domain建立raw/validated state和single writer前保持proposal，不能复用source mutation名称绕过domain authority。

## 验收

- production ingress只接受issuer-bound execution grant；caller self-digest/JSON无法提交derived authority、path、Delta/Impact、risk或terminal字段；该条件闭合前public apply保持not-production-authorized；
- plan/dry-run无任何Effect且byte-stable；当前effectful public plan在cutover前typed unavailable；
- prepared transaction intent在第一个staging/backup/directory/source Effect之前持久化并绑定authenticated grant；journal/caller projection不能mint或renew authority；
- owner/path proof处理symlink/reparse/case/Unicode和opaque boundary；
- apply在lease内重新计划并同时验证source/semantic CAS；
- 并发writer只有一个可发布，stale plan确定性拒绝；
- publish前失败无live变化；publish后失败只能rolled-back或recovery-required；
- crash/fault遍历每个journal/publication/cleanup边界；
- rollback不覆盖后继writer并能重建exact base canonical state；
- accepted绑定actual Delta/Impact和required Verification/readback；
- Mutation只写authoritative source inputs；derived artifacts由其canonical owner重新生成，跨revision compensation由Change Management拥有；
- terminal replay不重复副作用；
- 真实transport consumer存在时全部消费同一adapter和结果；无consumer时route/handler/schema/test为零；
- canonical YAML operation只有在production authorization、prepared-before-first-Effect、recovery authorization、Verification和readback闭合后才能激活；Brownfield governed-source operation还必须完成Adopt与source ownership闭包；
- Source Program/module graph中workspace→semantic-mutation reverse dependency、semantic-mutation↔verification reciprocal owner和重复public writer均为零；
- 当前与历史durable state由Change Management完成census：有旧状态则strict one-way migration，无状态则删除无意义Vn path/type/facade与字面测试；测试只消费owner常量和真实parser/migration/Effect/failure行为，不手抄owner、路径、版本或源码字符串。
