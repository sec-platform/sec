# 升级迁移与 Override 规范

> 目标：解决工程编译器最容易失败的两件事：升级不是一次性脚手架，人工改动不会在下一次编译时全部丢失。

## 1. 目标

- 允许 block 版本升级
- 允许人工或后续 AI 做局部 override
- 保持上游规格仍然是权威输入
- 在升级与 override 冲突时有可预测行为

## 2. Override 分类

### Manual Override

- 人工直接改生成产物
- 默认不被视为权威源

### Rule-backed Override

- 通过规则文件、slot 描述或 override spec 产生
- 可回写为长期配置

### Emergency Patch

- 为热修复而产生
- 必须在后续阶段回收或固化

## 3. `overrides/` 区规则

### `v0.1`

- 目录可预留，不要求启用

### `v0.2+`

- 默认结构：

```text
overrides/
  rules/
  patches/
  manifests/
```

### 规则

- override 只能通过显式映射接入主项目
- override 不得直接替换 lock 或 provenance

## 4. override 清单

### `override-manifest.yaml`

```yaml
overrides:
  - id: customer-list-hotfix
    target: src/app/customers/page.tsx
    reason: emergency-ui-fix
    source: manual
    appliesAfter:
      - compose
    conflictsWith:
      - entity/customer-basic@>=0.2.0
```

## 5. 升级流程

### 输入

- 当前 `graph.lock.json`
- 目标 block version
- block upgrade metadata
- 当前 overrides

### 步骤

1. 读取当前 lock
2. 检查目标版本兼容性
3. 读取 migration plan
4. 评估受影响文件
5. 检查与 overrides 的冲突
6. 生成 upgrade plan
7. 执行 migration
8. 重新 compose
9. 重新 verify
10. 更新 provenance 与 lock

## 6. 冲突优先级

升级与 override 冲突时，优先级从高到低：

1. 显式安全/政策限制
2. 数据迁移要求
3. Rule-backed Override
4. 官方 block 升级
5. Manual Override

### 默认策略

- 若官方升级会破坏 manual override，默认阻塞升级并要求显式决策。
- 若 rule-backed override 可以自动重放，允许升级后重放并再验证。

## 7. migration 类型

- `codemod`
- `file-replace`
- `prisma-migration`
- `config-rewrite`
- `slot-contract-update`

### migration 合同字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | migration id |
| `kind` | 是 | migration 类型 |
| `entry` | 是 | 执行入口 |
| `fromVersion` | 是 | 起始版本范围 |
| `toVersion` | 是 | 目标版本 |
| `requiresVerification` | 否 | 默认 true |

## 8. 回写策略

### 推荐顺序

1. 如果人工修改能表达为 slot description，则回写到 slot
2. 若能表达为规则文件，则写为 `overrides/rules/*`
3. 若只能表达为代码 patch，则写 `override-manifest.yaml`

### 不推荐

- 长期依赖 manual override 停留在生成区源码中

## 9. 升级安全门槛

### `v0.2` 最低要求

- 支持至少一个 block 的 minor 升级
- 支持冲突检测
- 支持升级后 verify

### `v1` 要求

- 支持多块升级计划
- 支持 override 冲突分析
- 支持 provenance 级影响面说明

## 10. 回滚

### 触发条件

- migration 执行失败
- verify 失败且 repair 无法通过
- provenance 更新失败

### 回滚内容

- block version
- install artifacts
- lock 状态
- provenance 状态

## 11. 延期项

- 自动三方 merge
- 跨项目 override 共享
- UI 级 upgrade center
