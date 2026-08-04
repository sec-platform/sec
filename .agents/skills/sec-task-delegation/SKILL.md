---
name: sec-task-delegation
description: 把 frozen Work Package 收窄为独立角色的 Task Envelope；没有真实并行收益时不分派。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-task-delegation

## 触发
- Role=Integrator，operation=`delegate`，至少两个完全不重叠 seam 或需要独立 Reviewer。

## 不触发
- 单一纵切片由当前执行者完成更快；同一 owner 或资源存在冲突。

## 输入
- base、owner、paths/resources、acceptance、tests、stop/reload 条件。

## 权限与路径
- 只签发 Envelope/角色配置；不替角色写 owned seam。

## 允许工具与操作
- Agent spawn、Envelope、只读 Reviewer、结果消费。

## 前置门禁
- 完整 Envelope、agent-spawn capability、disjoint proof。

## 执行
- 每个 Envelope 一个角色、一个 operation、一个可收口结果。
- 同一 canonical type/pipeline/authority 保持单写者。
- Worker 不 merge/hosted Gate/递归分派；Reviewer 只读。

## 完成证据
- Envelopes、disjoint proof、角色结果和 Reconciliation Delta。

## 停止与恢复
- 角色完成或返回 blocker；失联不 polling，交回 A0 重算。

## 禁止捷径
- 不为“多看一眼”创建 Agent，不把并发当进度。

## 权威
- `AGENTS.md`
- `docs/development-governance.md`
- `.codex/agents/`
