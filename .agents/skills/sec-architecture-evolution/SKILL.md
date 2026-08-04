---
name: sec-architecture-evolution
description: 在 canonical owner、公共合同、identity/revision、pipeline 或恢复边界确需变化时完成架构裁决；普通纵切片不触发。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-architecture-evolution

## 触发
- Role 为 Integrator/Auditor/Maintainer，operation=`design`，且单一 owner seam 无法解决根因。

## 不触发
- authority 和 migration 已冻结；局部缺陷可在现有 contract 内修复。

## 输入
- 用户 Goal、唯一 authority、现有机制链、consumer/impact、失败与迁移证据。

## 权限与路径
- 默认只读；只有 Envelope 明确授予时修改 canonical authority/contract tests。

## 允许工具与操作
- 机制重建、竞争方案比较、有限只读 Census 或 bounded spike。

## 前置门禁
- 适用性决策为 `applicable`；跨仓或广泛变化有 exact-revision Evidence。

## 执行
- 从理论目标反推对象、身份、状态 owner、写权限、错误与恢复。
- 攻击第二 writer/loader/revision、反向因果、不可逆迁移和长期双写。
- 选择唯一 canonical owner，并明确旧路径退出。
- authority first：先冻结机制与公共合同，再拆最小实现包。

## 完成证据
- 唯一 owner、机制图、不变量、替代方案、迁移/退役和反转条件。

## 停止与恢复
- 设计可交给 Worker，或出现决定性 unknown；新证据改变根假设时整体重算。

## 禁止捷径
- 不先改代码后补 authority，不用新术语包装旧实现，不让 spike 直接合并。

## 权威
- `docs/authority.json`
- `docs/product.md`
- `docs/system-architecture.md`
- `docs/roadmap.md`
