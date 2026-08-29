---
title: 升级、迁移与变更管理
status: stable
domain: change-management
last-reviewed: 2026-08-06
---

# 升级、迁移与变更管理

本文拥有 Upgrade、Migration、Compatibility Decision、Implementation Binding migration、Override、Deprecation、Compensation、Forward Recovery 与 irreversible change 的稳定语义。单次 Authoring/Governed Source transaction 的 plan、publish、journal、rollback、recovery 和 terminal state只由 `docs/semantic-mutation.md` 及其代码合同拥有。

旧新Engineering snapshots和Implementation Bindings的确定性结构比较由`docs/delta-and-impact.md`拥有；本文消费`Fact Delta`、`ImplementationBindingDelta`、Impact和physical Evidence，不建立第二Comparator。精确 migration union、schema、deployment protocol、命令和 diagnostics 由代码与测试唯一拥有。

## 变更对象

SEC 中的升级不是文件替换命令集合。一次变化可能同时影响：

- Block、Registry source和trust；
- Provider、Adapter、package/version/config与Implementation Binding；
- Semantic Contract、Entity/Fact/Responsibility identity与Assertion validity；
- State、Operation、Policy、Permission和Effect；
- Target Profile、Type Algebra、Application/Behavior/Target Program IR；
- Generator、Artifact、Repository layout和runtime dependency；
- Documentation、Workflow/Gate、Agent Operation、Release和Evidence；
- 生产数据、外部接口、部署顺序和用户可观察行为。

每个领域保持独立 revision；跨域升级通过显式mapping、ordered operations和aggregate migration协调，不能用一个Block version、package version或文件hash代替所有identity。

## 与 Semantic Mutation 的边界

Semantic Mutation拥有一次canonical/source写入的：

```text
plan → CAS → journal → stage → verify → publish
→ canonical rebuild → transaction rollback/recovery → terminal result
```

Change Management不复制上述状态机，不拥有workspace lease、source-byte CAS、file backup、commit fence或transaction terminal。

Change Management拥有跨revision和跨系统的：

- Compatibility Assessment / Decision；
- Implementation Binding迁移；
- producer/consumer迁移；
- schema/data/backfill；
- rollout和deployment ordering；
- compensation与forward recovery；
- irreversible boundary；
- deprecation、retirement和Support transition。

一个Migration可以调用一个或多个Semantic Mutation transaction、Composition publication或Provider operation，但必须只通过typed plan/result references连接。`accepted | rejected | rolled-back | recovery-required` 是transaction事实；Migration根据这些结果决定继续、补偿、暂停、forward-fix或operator intervention，不能改写transaction结果。

## Upgrade Plan

升级必须同时回答：

1. **Identity**：哪些对象保持identity，哪些被替换、拆分、合并或退役；
2. **Delta**：Fact、Binding、Artifact与Runtime哪些结构变化已由唯一Delta owner计算；
3. **Compatibility**：producer/consumer、读写、序列化、runtime、Provider behavior和release哪些方向兼容；
4. **Impact**：哪些Responsibilities、consumers、effects、permissions、artifacts和support surfaces受影响；
5. **Migration**：Authoring Source、generated artifact、configuration、Binding、runtime state与生产数据如何迁移；
6. **Verification**：哪些旧保证要重证，哪些新行为和失败模式必须覆盖；
7. **Deployment**：是否需要顺序发布、双读/双写、feature gate、backfill、canary或停机；
8. **Recovery strategy**：哪些步骤可由transaction rollback恢复，哪些需要compensation、forward recovery、backup或operator；
9. **Retirement**：旧owner、Provider、Adapter、Binding、schema、path、Gate和兼容代码何时删除。

Plan必须绑定exact source/current/target revisions、Fact/Binding Delta revisions、old/new Implementation Binding revisions、Compatibility rule revisions、required operations和deployment environment，并在执行前重新验证。旧Plan不能在source、policy、dependency、provider、consumer、Delta、Evidence或environment改变后继续使用。

## Compatibility

Compatibility不是布尔标签。至少区分：

- backward read / write；
- forward read / write；
- source、binary、schema、wire和behavior compatibility；
- Semantic Contract compatibility；
- Provider/Adapter/default behavior compatibility；
- Host、Toolchain、Target、platform和dependency compatibility；
- data migration与transaction rollback compatibility；
- rolling deployment中不同版本同时运行的compatibility。

Unknown或未经physical Evidence验证的方向不能默认兼容。Compatibility rule必须版本化并有正面、负面、边界与cross-version tests。

Breaking change必须有显式decision、consumer census、migration path、deprecation window和release authorization。提高major version只标记意图，不自动完成这些义务。

Verification PASS、Compatibility成立、implementation entered main和product support是不同对象；任何一项都不能自动推进另一项。

### Compatibility 不是常驻架构

Compatibility code 只允许作为一个有终点的 Migration program 存在，不能成为新旧系统的永久共同 owner。每个仍在执行的旧格式、旧路径、旧 Provider 或旧 API reader 必须由唯一 Change Management owner 机器记录以下事实：

- `oldIdentity`：被退役对象的精确 schema/path/provider/API identity；
- `externalStateClass`：旧状态可能存在的物理边界，禁止用“也许有用户”代替 census；
- `reader` 与 `writer`：旧 reader 和旧 writer 分开登记；cutover 后旧 writer 与 dual-write 必须先删除；
- `census`：bounded、NUL/byte-safe、可重复的旧状态数量与 unknown ledger；
- `converter`：唯一 one-way conversion、CAS、readback 和 failure/recovery owner；
- `exitCondition`：旧状态计数为零、unknown 为零、所有 consumer 已切换；
- `retirementAction`：同一批删除旧 reader、parser、adapter、tests、path 和 registry entry；
- `expiry`：没有可验证进展或超过窗口时 fail closed，不自动延期。

只有真实 rolling deployment 中不能原子切换的外部 producer/consumer 才允许短期 dual-read；dual-write 还必须额外证明两个 writer 不会形成冲突 authority，并绑定明确结束 revision。仓库内 caller、测试 fixture、CLI flag、re-export、别名、默认字段和同进程 API 不构成 dual-read/dual-write 的理由：consumer 可以同批迁移时必须直接 breaking cutover，旧面当场删除。

测试只保留两类 Migration proof：旧物理状态严格转换后的公共 readback，以及 incompatible/unknown/partial state 的 fail-closed。只镜像旧版本号、旧字段存在、兼容 alias 可调用或旧 writer 仍能写入的测试必须删除；当 exit condition 满足时，conversion tests 与 reader 一同退休，历史 Evidence 保持不可变但不继续进入执行集合。

### 版本存在证明

`V1`、`V2`、schema/version/revision字段和版本dispatcher都不是“为未来留余地”的默认架构。只有至少两个可观察状态必须被
同一真实consumer区分，且存在协议协商、持久状态解释、跨进程/跨发布并存、外部Provider兼容或有终点的Migration之一时，
版本身份才是`required`。只有一个当前实现、全部caller可原子迁移、旧状态已经consumer-zero，或版本只出现在名称、常量、
fixture与测试中时，版本机制属于`orphan | duplicate-owner`：删除`V1/V2/Vn`后缀、版本字段、分派、兼容层、migration壳与
相应字面测试，直接保留唯一当前语义名称。

真实版本边界必须由其语义owner一次性声明并被机器consumer实际使用，至少绑定versioned subject、比较/协商语义、支持窗口、
old/new consumer集合、Compatibility Decision、Migration/rollback或forward-recovery、retirement condition和Evidence失效规则。
产品release、Contract/schema、Provider/Adapter protocol、持久状态format、source revision、operation epoch与Evidence revision彼此
独立，禁止共享一个泛化`version`或靠全局递增序号联动。测试验证跨版本行为、真实旧状态转换和不兼容边界，不验证数字本身；
最后一个旧consumer退役时，版本reader、转换代码和测试必须在同一变更中删除，历史Git/Evidence负责解释过去。

## Implementation Compatibility Assessment

Change Management消费由Delta/Impact authority生成的`ImplementationBindingDelta`，再结合Semantic Contract、Compatibility rules、Target/Runtime facts、consumer requirements和physical Evidence产生版本化Assessment：

```text
ImplementationBindingDelta
+ Semantic Contract / Acceptance
+ Compatibility rule revisions
+ Target / Runtime / deployment facts
+ conformance / behavior / consumer Evidence
→ Compatibility Assessment
→ Compatibility Decision
→ Migration obligations
```

Assessment至少绑定：

- exact `ImplementationBindingDelta` identity/revision；
- old/new Binding与ResolutionDecision references；
- affectedSemantic Contract、Responsibility、Operation、Artifact和consumer；
- source/binary/schema/wire/behavior/Target/dependency方向；
- timeout、retry、redirect、cancellation、idempotency、consistency、logging、telemetry、error和serialization判断；
- compatible、compatible-with-adapter、migration-required、breaking、unknown或unsupported；
- required conformance、deployment、recovery和retirement；
- rule、Evidence、environment、coverage、expiry与unknown frontier。

Change Management不得：

- 重新比较old/new Binding payload或重新运行Resolver；
- 按包名、semver、API相似度、作者release note或类型检查结果生成raw Delta；
- 把未执行、unsupported、stale或coverage不足的Evidence解释为兼容；
- 用Migration可行性反向修改Delta事实；
- 用性能、流行度或现有用户数量抵消合同、安全、权限或数据完整性失败。

包名相同、类型检查通过、API签名兼容、semver minor/patch或作者宣称non-breaking都不能替代Behavior Compatibility。

## Implementation Binding Migration

实现升级只有四种合法结果：

1. **Contract preserved**：Assessment证明新Binding完整满足原Semantic Contract；冻结新Decision/Binding并重证。
2. **Adapter-preserved**：新版默认行为变化，但版本化Adapter/config可以显式恢复原合同；迁移Adapter/Binding并重证。
3. **Provider switch**：原Provider不再合格，Implementation Resolver基于新的validated inputs选择另一个合格候选；产生新Binding、Binding Delta、Compatibility Decision、consumer/artifact迁移和旧Provider退役。
4. **Semantic migration**：任何候选都无法保持原合同，且用户/Policy明确接受行为变化；必须先修改Semantic Contract，再重新Resolution。

以下均被禁止：

- dependency bump静默改变语义；
- 因旧Provider不可用自动换成“最像”的实现；
- 用户pin绕过hard eligibility、安全、权限或Target限制；
- Adapter通过吞掉错误、隐藏Effect或降低Acceptance伪装兼容；
- 新Binding进入Target Program或package materialization前没有Binding Delta和Compatibility Decision。

Implementation Resolver只产生候选Decision/Binding；Delta/Impact owner产生Binding Delta/Impact；Change Management拥有Compatibility与迁移协调；Verification拥有物理结果；Dependency/Runtime owner拥有物理materialization和support事实。

## Override

- **Manual Override**：直接修改generated target；属于Drift，不能成为canonical semantic source。
- **Rule-backed Override**：受治理、可重放、可版本化，并绑定target、owner、precondition、Provenance和Verification。
- **Implementation Override**：用户`require/pin/custom`某实现的受治理输入；只能限制候选，不能绕过hard eligibility。
- **Emergency Patch**：用于明确事故边界，必须有owner、expiry、回收或正规化计划。

Override不得写 `control/**` 或伪造IR/Evidence。改变Contract、Effect、Permission、Ownership、public API或State semantics的patch必须进入显式Contract/Semantic Operation或Migration decision，不能只留下源码差异。

升级遇到Manual Override默认阻塞，不按文件时间、三方自动merge或AI confidence擅自覆盖。用户必须选择：保留并治理、转为rule-backed、吸收到Authoring Source或丢弃。

## Migration Contract

每个Migration kind必须有：

- 唯一 discriminated type和version；
- deterministic identity、ordering和target scope；
- current/target revision与preconditions；
- Fact/Binding Delta、old/new Binding、Compatibility Decision和resolver policy references（适用时）；
- dry-run summary与expected effects；
- constituent Engineering Operations / transactions；
- idempotency、reentrancy与resume语义；
- apply、partial failure、pause、resume和migration terminal；
- reversible、compensatable、forward-only、requires-backup、requires-operator等分类；
- Compatibility、Verification、Evidence和deployment binding；
- consumer、deprecation和retirement binding。

Migration不能通过重复执行“碰运气”恢复。它必须根据每个transaction journal/result、migration checkpoint和external system Evidence证明哪些步骤未开始、已提交、已补偿或结果不确定。

## 数据迁移

生产数据变化通常采用：

```text
Expand → Backfill / Migrate → Verify → Switch → Contract
```

但这只是协调模式，不自动保证零停机或零数据丢失。实现前必须具备：

- database/storage Target adapter与exact schema/Binding identity；
- migration job identity、lease和checkpoint；
- bounded batch、rate/resource limit和resume；
- dual-read/dual-write或Compatibility policy；
- coverage、consistency、loss/corruption Verification；
- deployment ordering、feature gate和observability；
- transaction rollback、compensation、forward-fix和backup boundary；
- failure injection、partial rollout和production safety tests。

删除旧字段、索引、文件格式、消息或external contract是irreversible point。进入前必须证明所有读者、写者、历史数据、备份、rollback/forward recovery和长尾consumer已裁决。

## Semantic Migration

Semantic identity保持不等于所有Facts永久有效。升级后：

- Contract assertions从新Contract产生；
- derived assertions从新canonical rules重算；
- observed assertions绑定新source/runtime revision；
- inferred assertions可以失效并重新推断；
- Responsibility split/merge/replacement保留显式relation；
- removed/replaced identity不能复用旧ID表示新对象。

仅更换实现且合同保持时，不能为方便升级而重写Semantic identity。Semantic Migration必须报告Fact/Assertion、Responsibility、state ownership、permission/effect、Implementation Binding、Generator/Artifact和Verification delta，而不只报告文件变化。

## Recovery Strategy

Migration recovery至少区分：

- **transaction rollback**：由Semantic Mutation恢复一个写入transaction的exact prior source/canonical state；
- **binding rollback**：恢复旧validated Binding并从accepted canonical revision重新生成，不复制旧output冒充authority；
- **compensation**：通过新操作抵消已完成外部Effect，但不声称恢复了原历史；
- **forward recovery**：无法安全回退时，通过新Migration收敛到受支持状态；
- **restore from backup**：需要明确backup identity、freshness、loss window和validation；
- **operator-required**：自动系统无法证明安全下一步；
- **irreversible-after**：越过某个点后只允许forward recovery。

Artifact rollback必须从accepted canonical revision和validated Binding重新生成，不能把旧output copy当authority。Runtime/config/data recovery取决于Host/Target/Provider和external system可逆性。

当任一底层transaction为recovery-required时，Migration不能把整体标为failed后继续；必须暂停并绑定唯一恢复流程。

## Deployment 与 rollout

跨版本变更可以需要：

- ordered deploy；
- compatibility window；
- feature flag / canary；
- shadow implementation/read/write；
- backfill；
- traffic switch；
- health/SLO/incident observation；
- rollback/forward recovery decision。

部署状态、运行健康和Support Claim由Release/Operations owner拥有。Change Management只定义需要的顺序、兼容和迁移条件，不通过文档或PR状态声明部署成功。

## Deprecation 与 Retirement

Deprecation至少包含owner、受影响consumer、替代方案、开始/停止支持条件、warning surface、Migration Evidence和review trigger。

Retirement只有在以下全部成立后完成：

- current main不再有producer/consumer或accepted Binding引用；
- historical data、Decision、Binding、Delta、Compatibility Decision和release仍可解释；
- Compatibility/Support profile已退出；
- old Provider、Adapter、dependency、Gate、schema、path和docs已删除或归档；
- clean install/build/runtime Evidence闭合；
- Registry/deployment/operations不再引用旧identity。

保留无人理解的“兼容代码”或“备用Provider”会形成第二authority，不能无限延期。备用实现只有在真实failover contract、独立health/freshness、重新Resolution和定期physical proof存在时成立。

## 冲突优先级

```text
Safety / Policy
> Data integrity
> Authoritative Contract and explicit user decision
> verified Compatibility and Migration plan
> governed Override
> automatic upgrade / Resolution preference
> manual generated-file modification
```

AI confidence、最新时间、文件修改更多、Provider多数票、semver标签或自动merge成功不参与越权裁决。

## 完成判据

Upgrade/Migration只有在：

- 新状态进入唯一主链；
- Fact/Binding Delta、old/new Binding、Compatibility Decision和Resolution Decision可追溯；
- required transactions有明确terminal并完成readback；
- Compatibility方向和consumer迁移闭合；
- 数据/外部Effect完成Verification或明确residual risk；
- 部署、compensation/forward recovery和irreversible boundary明确；
- 旧writer、Provider、Adapter、dependency、schema和兼容路径退役；
- 新canonical revision、artifact、release/operations状态和Support maturity分别readback；

之后才完成。Plan、dry-run、代码提交、单次测试、类型检查、依赖安装或PR合并都只证明其中一层。
