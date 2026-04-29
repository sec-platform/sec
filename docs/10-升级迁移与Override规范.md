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

## 5. Migration 合同字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 唯一标识 |
| `kind` | 是 | migration 类型 |
| `entry` | 是 | 执行入口路径 |
| `fromVersion` | 是 | 起始版本范围 |
| `toVersion` | 是 | 目标版本 |
| `requiresVerification` | 否 | 默认 true |

## 6. 回写策略

按优先级：slot description → model / view mutation → rule-backed patch → code patch → private block。

不推荐长期依赖 manual override 留在生成区源码中。

## 7. 升级安全门槛

- 支持至少一个 block 的 minor 升级 ✅
- 支持冲突检测 ✅
- 支持 dry-run plan 预览 ✅
- 支持 upgrade diagnostics ✅
- 支持重新 verify 和 provenance 更新 ✅
- `platform upgrade <block-id> <target-version> [--dry-run] --json [--compact]` ✅
- `platform upgrade plan [--json --compact]`（只读检查）✅
- `platform upgrade diagnostics [--json --compact]`（只读诊断）✅
