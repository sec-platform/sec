---
title: 升级、迁移与变更管理
status: stable
domain: change-management
last-reviewed: 2026-08-04
---

# 升级、迁移与变更管理

本文拥有 Upgrade、Migration、Compatibility、Override、Deprecation、Compensation、Forward Recovery 与 irreversible change 的稳定语义。单次 Authoring/Governed Source transaction 的 plan、publish、journal、rollback、recovery 和 terminal state只由 `docs/semantic-mutation.md` 及其代码合同拥有。

精确 migration union、schema、deployment protocol、命令和 diagnostics 由代码与测试唯一拥有。

## 变更对象

SEC 中的升级不是文件替换命令集合。一次变化可能同时影响：

- Block、Registry source和trust；
- Semantic Contract、Entity/Fact/Responsibility identity与Assertion validity；
- State、Operation、Policy、Permission和Effect；
- Target Profile、Type Algebra、Application/Behavior/Target Program IR；
- Generator、Artifact、Repository layout和runtime dependency；
- Documentation、Workflow/Gate、Agent Operation、Release和Evidence；
- 生产数据、外部接口、部署顺序和用户可观察行为。

每个领域保持独立 revision；跨域升级通过显式mapping、ordered operations和aggregate migration协调，不能用一个Block version或文件hash代替所有identity。

## 与 Semantic Mutation 的边界

Semantic Mutation拥有一次canonical/source写入的：

```text
plan → CAS → journal → stage → verify → publish
→ canonical rebuild → transaction rollback/recovery → terminal result
```

Change Management不复制上述状态机，不拥有workspace lease、source-byte CAS、file backup、commit fence或transaction terminal。

Change Management拥有跨revision和跨系统的：

- Compatibility判断；
- producer/consumer迁移；
- schema/data/backfill；
- rollout和deployment ordering；
- compensation与forward recovery；
- irreversible boundary；
- deprecation、retirement和Support transition。

一个Migration可以调用一个或多个Semantic Mutation transaction，但必须只通过typed plan/result references连接。`accepted | rejected | rolled-back | recovery-required` 是transaction事实；Migration根据这些结果决定继续、补偿、暂停、forward-fix或operator intervention，不能改写transaction结果。

## Upgrade Plan

升级必须同时回答：

1. **Identity**：哪些对象保持identity，哪些被替换、拆分、合并或退役；
2. **Compatibility**：producer/consumer、读写、序列化、runtime和release哪些方向兼容；
3. **Delta / Impact**：哪些canonical facts、types、state、effects、permissions和artifacts改变；
4. **Migration**：Authoring Source、generated artifact、configuration、runtime state与生产数据如何迁移；
5. **Verification**：哪些旧保证要重证，哪些新行为和失败模式必须覆盖；
6. **Deployment**：是否需要顺序发布、双读/双写、feature gate、backfill、canary或停机；
7. **Recovery strategy**：哪些步骤可由transaction rollback恢复，哪些需要compensation、forward recovery、backup或operator；
8. **Retirement**：旧owner、adapter、schema、path、Gate和兼容代码何时删除。

Plan必须绑定exact source/current/target revisions、Compatibility rule revisions、required operations和deployment environment，并在执行前重新验证。旧Plan不能在source、policy、dependency、consumer或environment改变后继续使用。

## Compatibility

Compatibility不是布尔标签。至少区分：

- backward read / write；
- forward read / write；
- source、binary、schema、wire和behavior compatibility；
- Host、Toolchain、Target、platform和dependency compatibility；
- data migration与transaction rollback compatibility；
- rolling deployment中不同版本同时运行的compatibility。

Unknown或未经physical Evidence验证的方向不能默认兼容。Compatibility rule必须版本化并有正面、负面、边界与cross-version tests。

Breaking change必须有显式decision、consumer census、migration path、deprecation window和release authorization。提高major version只标记意图，不自动完成这些义务。

Verification PASS、Compatibility成立、implementation entered main和product support是不同对象；任何一项都不能自动推进另一项。

## Override

- **Manual Override**：直接修改generated target；属于Drift，不能成为canonical semantic source。
- **Rule-backed Override**：受治理、可重放、可版本化，并绑定target、owner、precondition、Provenance和Verification。
- **Emergency Patch**：用于明确事故边界，必须有owner、expiry、回收或正规化计划。

Override不得写 `control/**` 或伪造IR/Evidence。改变Contract、Effect、Permission、Ownership、public API或State semantics的patch必须进入显式Contract/Semantic Operation或Migration decision，不能只留下源码差异。

升级遇到Manual Override默认阻塞，不按文件时间、三方自动merge或AI confidence擅自覆盖。用户必须选择：保留并治理、转为rule-backed、吸收到Authoring Source或丢弃。

## Migration Contract

每个Migration kind必须有：

- 唯一 discriminated type和version；
- deterministic identity、ordering和target scope；
- current/target revision与preconditions；
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

- database/storage Target adapter与exact schema identity；
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

Semantic Migration必须报告Fact/Assertion、Responsibility、state ownership、permission/effect、Generator/Artifact和Verification delta，而不只报告文件变化。

## Recovery Strategy

Migration recovery至少区分：

- **transaction rollback**：由Semantic Mutation恢复一个写入transaction的exact prior source/canonical state；
- **compensation**：通过新操作抵消已完成外部Effect，但不声称恢复了原历史；
- **forward recovery**：无法安全回退时，通过新Migration收敛到受支持状态；
- **restore from backup**：需要明确backup identity、freshness、loss window和validation；
- **operator-required**：自动系统无法证明安全下一步；
- **irreversible-after**：越过某个点后只允许forward recovery。

Artifact rollback必须从accepted canonical revision重新生成，不能把旧output copy当authority。Runtime/config/data recovery取决于Host/Target/Provider和external system可逆性。

当任一底层transaction为recovery-required时，Migration不能把整体标为failed后继续；必须暂停并绑定唯一恢复流程。

## Deployment 与 rollout

跨版本变更可以需要：

- ordered deploy；
- compatibility window；
- feature flag / canary；
- shadow read/write；
- backfill；
- traffic switch；
- health/SLO/incident observation；
- rollback/forward recovery decision。

部署状态、运行健康和Support Claim由Release/Operations owner拥有。Change Management只定义需要的顺序、兼容和迁移条件，不通过文档或PR状态声明部署成功。

## Deprecation 与 Retirement

Deprecation至少包含owner、受影响consumer、替代方案、开始/停止支持条件、warning surface、Migration Evidence和review trigger。

Retirement只有在以下全部成立后完成：

- current main不再有producer/consumer；
- historical data和release仍可解释；
- Compatibility/Support profile已退出；
- old Gate、schema、adapter、path和docs已删除或归档；
- clean install/build/runtime Evidence闭合；
- Registry/deployment/operations不再引用旧identity。

保留无人理解的“兼容代码”会形成第二authority，不能无限延期。

## 冲突优先级

```text
Safety / Policy
> Data integrity
> Authoritative Contract and explicit user decision
> verified Compatibility and Migration plan
> governed Override
> automatic upgrade preference
> manual generated-file modification
```

AI confidence、最新时间、文件修改更多、Provider多数票或自动merge成功不参与越权裁决。

## 完成判据

Upgrade/Migration只有在：

- 新状态进入唯一主链；
- required transactions有明确terminal并完成readback；
- Compatibility方向和consumer迁移闭合；
-数据/外部Effect完成Verification或明确residual risk；
-部署、compensation/forward recovery和irreversible boundary明确；
-旧writer、adapter、schema和兼容路径退役；
-新canonical revision、release/operations状态和Support maturity分别readback；

之后才完成。Plan、dry-run、代码提交、单次测试或PR合并都只证明其中一层。
