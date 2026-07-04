---
title: 升级迁移与 Override 规范
status: stable
last-reviewed: 2026-07-04
---

# 升级迁移与 Override 规范

> 目标：确保 block 升级可控、人工改动不会在下次编译时丢失。

## 1. Override 体系

| 类型 | 说明 |
| --- | --- |
| Manual Override | 人工直接改生成产物，不作为权威源 |
| Rule-backed Override | 通过规则文件/slot 描述产生，可回写为长期配置 |
| Emergency Patch | 热修复产生，必须后续固化 |

### 默认结构

```text
source/patches/
  override-manifest.yaml
  rules/
  patches/
  manifests/
```

`project/overrides/**` 仅保留为兼容期入口。

### override-manifest.yaml

```yaml
overrides:
  - id: customer-list-hotfix
    entry: patches/customer-list.override.ts
    target: src/app/customers/page.tsx
    reason: emergency-ui-fix
    source: manual
    appliesAfter: [compose]
    conflictsWith: [entity/customer-basic@>=0.2.0]
```

### 规则

- override 不得直接替换 `control/**` artifact。
- 人工修改 `project/**` 应识别为 drift，引导回写到 `source/**`。

## 2. 升级流程

1. 读取当前 lock → 2. 检查目标版本兼容性 → 3. 读取 migration plan → 4. 评估受影响文件 → 5. 检查 override 冲突 → 6. 生成 upgrade plan → 7. 执行 migration → 8. 重新 compose → 9. 重新 verify → 10. 更新 provenance 与 lock

## 3. 冲突优先级

| 优先级 | 类型 |
| --- | --- |
| 1 | 显式安全/政策限制 |
| 2 | 数据迁移要求 |
| 3 | Rule-backed Override |
| 4 | 官方 block 升级 |
| 5 | Manual Override |

官方升级若破坏 manual override → 阻塞升级，要求显式决策。Rule-backed override 可自动重放。

## 4. Migration 类型

| 类型 | 说明 |
| --- | --- |
| `file-replace` | 替换单个文件 |
| `copy-file` / `copy-directory` | 从 manifest 根目录复制 |
| `rename-file` / `rename-directory` | 移动重命名 |
| `create-directory` | 创建目录 |
| `delete-file` / `delete-directory` | 删除 |
| `config-rewrite` | JSON 配置 set/delete |
| `json-array-append` / `json-array-remove` | JSON 数组操作 |
| `json-object-merge` | JSON 对象递归合并 |
| `text-append` / `text-replace` / `text-replace-regex` | 文本操作 |
| `slot-contract-update` | Slot 类型/合同变更 |
| `codemod` | AST 级迁移（预留） |
| `prisma-migration` | 数据库 schema 迁移（预留） |

## 5. 有状态数据的“无损升级与平滑迁移 (Zero-Downtime DB Migration)”

代码在编译层是无状态的，写坏了可以一键 Compose 重新生成。但生产环境的真实数据库（SQLite/PostgreSQL）是有状态的。当 Block 发生 Major 版本升级，需要增加非空字段，或者将一对一关系重构为多对多关系时，编译器和升级引擎在物理执行 schema 漂移时，强制实施 **零停机无损数据迁移标准 (Zero-downtime DB Schema Migration)**：

### 5.1 数据库结构双写过渡模式 (Expand & Contract Pattern)

升级引擎执行 `prisma-migration` 动作时，严禁直接对有状态的生产库表执行破坏性字段覆盖或直接 Drop，必须遵循以下 3 步平滑演进：

1. **第一步：结构扩张与双写 (Expand Phase)**：
   - 升级引擎读取 upgrade plan，在数据库中先新增目标新字段（如新版本所需的 `new_email`），并将其暂时设为 `Nullable`。
   - 编译器在此期间生成的过渡代码，在业务层自动对该字段执行 **双写逻辑 (Dual Writing)**，即：每次新增或更新数据时，将数据同时写入 `old_email` 与 `new_email`。
2. **第二步：数据异步平滑搬迁 (Migrate Phase)**：
   - 升级引擎调用后台异步迁移数据服务，在不锁表、不停机的情况下，分批次（Batching）将历史旧字段的数据清洗并搬迁至新字段。
3. **第三步：结构收缩与旧模式废弃 (Contract Phase)**：
   - 当检测到历史数据迁移校验 coverage 达到 100% 后，编译器生成新版本的生产代码，将数据读取端完全切换到 `new_email` 字段，并在业务层去除双写代理逻辑。
   - 最后，升级引擎在下一次平滑维护周期中，安全地在物理表中 Drop 掉老旧的 `old_email` 字段，完成物理结构收缩。

这一规范保证了在大中枢系统的复杂数据漂移中，任何版本升级绝不会发生生产级数据丢失或停机瘫痪。


## 6. Migration 合同字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 唯一标识 |
| `kind` | 是 | migration 类型 |
| `entry` | 是 | 执行入口路径 |
| `fromVersion` | 是 | 起始版本范围 |
| `toVersion` | 是 | 目标版本 |
| `requiresVerification` | 否 | 默认 true |

## 7. 回写策略

按优先级：slot description → model / view mutation → rule-backed patch → code patch → private block。

不推荐长期依赖 manual override 留在生成区源码中。

## 8. 升级安全门槛

- 支持至少一个 block 的 minor 升级 ✅
- 支持冲突检测 ✅
- 支持 dry-run plan 预览 ✅
- 支持 upgrade diagnostics ✅
- 支持重新 verify 和 provenance 更新 ✅
- `platform upgrade <block-id> <target-version> [--dry-run] --json [--compact]` ✅
- `platform upgrade plan [--json --compact]`（只读检查）✅
- `platform upgrade diagnostics [--json --compact]`（只读诊断）✅
