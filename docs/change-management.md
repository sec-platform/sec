---
title: 升级、迁移与变更管理
status: stable
domain: change-management
last-reviewed: 2026-07-29
---

# 升级、迁移与变更管理

本文拥有 Upgrade、Migration、Override、Compatibility、Deprecation、Rollback 与 irreversible change 的稳定语义。精确 migration union、文件操作、schema、命令和 diagnostics 由代码与测试唯一拥有。

## 变更对象

SEC 中的升级不是文件替换命令集合。一次变化可能同时影响：

- Block、Registry source 和 trust；
- Semantic Contract、Entity/Fact identity 与 Assertion validity；
- State、Operation、Policy、Permission 和 Effect；
- Target Profile、Type Algebra、Application/Behavior/Program IR；
- Generator、Artifact、Repository layout 和 runtime dependency；
- Documentation、Workflow/Gate、Agent Operation、Release 与 Evidence；
- 生产数据、外部接口、部署顺序和用户可观察行为。

每个领域保持独立 revision；跨域升级通过显式 mapping 和 aggregate transaction 协调，不能用一个 Block version 或文件 hash 代替所有 identity。

## Upgrade Plan

升级必须同时回答：

1. **Identity**：哪些对象保持 identity，哪些被替换、拆分、合并或退役；
2. **Compatibility**：producer/consumer、读写、序列化、runtime 和 release 哪些方向兼容；
3. **Delta / Impact**：哪些 canonical facts、types、state、effects、permissions 和 artifacts 改变；
4. **Migration**：Authoring Source、generated artifact、configuration、runtime state 与生产数据如何迁移；
5. **Verification**：哪些旧保证要重证，哪些新行为和失败模式必须覆盖；
6. **Deployment**：是否需要顺序发布、双读/双写、feature gate、backfill 或停机；
7. **Rollback / Recovery**：失败时能恢复到哪里，哪些操作 forward-only；
8. **Retirement**：旧 owner、adapter、schema、path、Gate 和兼容代码何时删除。

Plan 必须绑定 exact source/current/target revisions，并在 apply 前重新验证。旧 plan 不能在 source、policy、dependency 或 environment 改变后继续使用。

## Compatibility

Compatibility 不是布尔标签。至少区分：

- backward read / write；
- forward read / write；
- source、binary、schema、wire 和 behavior compatibility；
- Host、Toolchain、Target、platform 和 dependency compatibility；
- data migration 与 rollback compatibility；
- rolling deployment 中不同版本同时运行的 compatibility。

Unknown 或未经 physical Evidence 验证的方向不能默认兼容。Compatibility rule 必须版本化并有正面、负面、边界与 cross-version tests。

Breaking change 必须有显式 decision、consumer census、migration path、deprecation window 和 release authorization。仅提高 major version 不自动完成这些义务。

## Override

- **Manual Override**：直接修改 generated target；属于 Drift，不能成为 canonical semantic source。
- **Rule-backed Override**：受治理、可重放、可版本化，并绑定 target、owner、precondition、Provenance 和 Verification。
- **Emergency Patch**：用于明确事故边界，必须有 owner、expiry、回收或正规化计划。

Override 不得写 `control/**` 或伪造 IR/Evidence。改变 Contract、Effect、Permission、Ownership、public API 或 State semantics 的 patch 必须进入显式 Contract/Semantic Mutation 或 migration decision，不能只留下源码差异。

升级遇到 Manual Override 默认阻塞，不按文件时间、三方自动 merge 或 AI confidence 擅自覆盖。用户必须选择保留并治理、转为 rule-backed、吸收到 Authoring Source 或丢弃。

## Migration Contract

每个 migration kind 必须有：

- 唯一 discriminated type 和 version；
- deterministic identity、ordering 与 target scope；
- precondition 和 source revision binding；
- dry-run summary 与 expected effects；
- idempotency/reentrancy 语义；
- apply、partial failure、resume 和 terminal states；
- rollback、compensation 或 forward-only 分类；
- diagnostic、Evidence 与 targeted tests；
- consumer、deployment 和 retirement binding。

Migration 不能通过重复执行“碰运气”恢复。恢复必须从 journal/checkpoint 证明哪些步骤未开始、已提交或结果不确定。

## 数据迁移

生产数据变化通常采用：

```text
Expand → Backfill / Migrate → Verify → Switch → Contract
```

但这只是一种协调模式，不自动保证零停机或零数据丢失。实现前必须具备：

- database/storage Target adapter 与 exact schema identity；
- migration job identity、idempotency、lease 和 checkpoint；
- bounded batch、rate/resource limit 与 resume；
- dual-read/dual-write 或 compatibility policy；
- coverage、consistency、loss/corruption Verification；
- deployment ordering、feature gate 和 observability；
- rollback/forward-fix boundary；
- failure injection、partial rollout 和 production safety tests。

删除旧字段、索引、文件格式、消息或 external contract 是 irreversible point。进入前必须证明所有读者、写者、历史数据、备份、rollback 和长尾 consumer 已裁决。

## Semantic Migration

Semantic identity 保持不等于所有 Facts 永久有效。升级后：

- Contract assertions 从新 Contract 产生；
- derived assertions 从新 canonical rules 重算；
- observed assertions 绑定新 source/runtime revision；
- inferred assertions可以失效并重新推断；
- removed/replaced identity保留 replacement/provenance relation，不复用旧 ID 表示新对象。

Semantic migration 必须报告 Fact/Assertion、state ownership、permission/effect、Generator/Artifact 和 Verification delta，而不只报告文件变化。

## Rollback 与 Recovery

- **Authoring rollback**：恢复 accepted transition 之前的 source/plan revision；
- **Artifact rollback**：从 accepted canonical revision重新生成，不能把旧 output copy 当 authority；
- **Runtime/config rollback**：依赖 Host/Target/Provider 的可逆性和 active process state；
- **Data rollback**：由 migration strategy决定，不能假设所有操作可逆；
- **Forward recovery**：无法安全回退时，通过新 migration 收敛到受支持状态。

每个 migration 必须声明或推导：reversible、compensatable、forward-only、requires-backup、requires-explicit-operator 与 irreversible-after。已发布写入若无法证明 prior state 完整恢复，terminal result 必须是 recovery-required，而不是 failed 后继续。

## Deprecation 与 Retirement

Deprecation 至少包含 owner、受影响 consumer、替代方案、开始/停止支持条件、warning surface、migration Evidence 与 review trigger。Retirement 只有在：

- current main 不再有 producer/consumer；
- historical data 和 release 仍可解释；
- compatibility profile 已退出；
- old Gate、schema、adapter、path 和 docs 已删除或归档；
- clean install/build/runtime Evidence闭合；

之后才完成。保留无人理解的“兼容代码”会形成第二 authority，不能无限延期。

## 冲突优先级

```text
Safety / Policy
> Data integrity
> Authoritative Contract and explicit user decision
> verified compatibility and migration plan
> governed override
> automatic upgrade preference
> manual generated-file modification
```

AI confidence、最新时间、文件修改更多、Provider多数票或自动 merge成功不参与越权裁决。

## 完成判据

升级只有在新状态进入唯一主链、所有 required Verification通过、consumer迁移完成、旧 writer退役、release/rollback边界明确并从新 canonical revision readback 后完成。Plan、dry-run、代码提交、单次测试或 PR 合并都只证明其中一层。
