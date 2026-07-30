---
title: 升级迁移与 Override 规范
status: active
last-reviewed: 2026-07-04
---

# 升级迁移与 Override 规范

本文定义 Block/Contract/Artifact 升级、Migration、Override 和 Rollback 边界。

## 1. 原则

升级必须回答四件事：

1. **Identity**：升级前后哪些 Block、Entity、Fact 保持同一身份。
2. **Compatibility**：哪些 Contract 保持，哪些发生 breaking change。
3. **Migration**：Authoring Source、Artifact、State/Data 如何迁移。
4. **Verification**：用什么证据证明新 Revision 可接受。

Upgrade 不是文件替换命令集合；文件 Migration 是当前实现基础，Semantic Migration 是 v0.4 演进方向。

## 2. Override

| 类型 | 含义 | 长期处理 |
| --- | --- | --- |
| Manual Override | 人工直接修改 Generated Target | 识别 Drift，要求显式保留/回收/丢弃 |
| Rule-backed Override | 受治理规则或 Patch | 可重放、可版本化 |
| Emergency Patch | 紧急修复 | 必须有过期/回收计划 |

默认 Authoring 入口：

```text
source/patches/
  override-manifest.yaml
  rules/
  patches/
  manifests/
```

规则：

- Override 不得修改 `control/**`。
- Manual Override 不能成为 canonical semantic source。
- Rule-backed Override 需要 Artifact Provenance。
- 若 Override 改变 Contract、Effect、Permission、Ownership，应形成显式 Semantic Mutation/Contract Patch，而不是只留下源码 Patch。

## 3. 当前升级流程

```text
read current lock
→ validate target version
→ load migrations
→ compute file/install impact
→ detect override conflicts
→ build upgrade plan
→ dry-run / apply migration
→ compose/adapt
→ verify
→ update provenance/lock
→ explain/review
```

当前实现主要围绕文件、配置、Slot Contract 和 DB expand/contract 辅助 Migration。

## 4. 当前 Migration 类型

稳定类型以 `UpgradeMigrationEntry` TypeScript union 为事实源。文档只归类：

- file/directory copy、replace、rename、create、delete。
- JSON config/array/object rewrite。
- text append/replace/regex replace。
- slot contract update。
- DB expand/contract 辅助操作。

新增 Migration kind 必须：

1. 加入 union/type。
2. 明确 dry-run summary。
3. 明确 apply/rollback 语义。
4. 加 targeted integration test。
5. 进入 upgrade diagnostics。

## 5. Semantic Migration 目标

IR Revision 稳定后，Upgrade Plan 增加 Semantic Delta：

```text
Block version delta
Contract schema delta
Entity identity mapping
Fact add/remove/change
State ownership delta
Permission/effect delta
Generator/artifact delta
Verification impact
```

例如：

```text
Ticket.status enum adds PAUSED
```

平台需要判断：

- State identity 是否保持。
- 哪些 transition contract 受影响。
- 哪些 view/API serializer 依赖 enum。
- 数据库是否需要 expand/backfill。
- Acceptance 是否覆盖新状态。

不能只报告“schema.prisma changed”。

## 6. 数据迁移

生产级零停机迁移是目标能力，不是当前已完成保证。

对有状态生产数据，目标标准采用 Expand → Migrate → Contract：

1. **Expand**：新增兼容结构；必要时引入双写/兼容读取。
2. **Migrate**：分批 Backfill，记录进度、失败和校验。
3. **Contract**：确认 Coverage/Consistency 后切换读取，最后删除旧结构。

实现该能力前必须补齐：

- 数据库 target adapter。
- migration job identity/idempotency。
- checkpoint/resume。
- data verification contract。
- rollback boundary。
- deployment coordination。
- production safety tests。

在这些机制没有完成前，文档和 CLI 不得声称“保证零停机、绝不丢数据”。

## 7. 冲突优先级

```text
Safety / Policy
> Data integrity
> Authoritative Contract
> Rule-backed Override
> Official Block upgrade
> Manual Override
```

Manual Override 被升级覆盖时默认阻塞并要求决策。

Authoritative Contract 冲突不能由 AI confidence 或自动 merge 解决。

## 8. Rollback

Rollback 分三层：

- Authoring rollback：恢复 mutation/contract/plan revision。
- Artifact rollback：从 accepted canonical revision 重新生成。
- Data rollback：依赖具体 migration strategy；不可假设所有数据操作可逆。

每个 Migration 必须声明或推导：

```text
reversible
forward-only
requires-backup
requires-explicit-operator
```

## 9. Upgrade 与 Fact Provenance

升级后 Fact 不直接“继承 confidence”。必须根据来源重建：

- Contract Fact 从新 Contract 重新产生。
- Compiler-derived Fact 从新 IR 规则重算。
- Observed Fact 绑定 Runtime Revision。
- Inferred Fact 可失效并重新推断。

Semantic Identity 保持，不等于所有 Fact 永久有效。
