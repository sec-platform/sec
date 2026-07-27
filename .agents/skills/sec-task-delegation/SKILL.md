---
name: sec-task-delegation
description: 用于把 frozen Work Package 收窄为单个 Worker、Reviewer 或验证角色的 Task Envelope；不用于把同一 authority 并发交给多个写者。
compatibility: SEC 仓库；按本 Skill 的权威、权限和验证边界执行。
---

# sec-task-delegation

## 触发
- Work Package 存在两个以上角色或需要独立 Reviewer。

## 不触发
- 单一纵向切片由 Root直接完成更快；没有真实不重叠 seam。

## 输入
- exact base、branch、owner、owned/forbidden paths、prerequisites、acceptance、tests、gate owner、stop、reload_if。

## 权限与路径
- 只签发/读取Task Envelope和角色配置；不得替角色写owned路径。

## 允许工具与操作
- Agent spawn、Task Envelope、只读Reviewer、完成事件消费。

## 前置门禁
- Work Package frozen；至少两个seam完全不重叠且可独立提交，或存在独立Review需要。

## 执行
1. 每个 Task Envelope只含一个角色和一个可收口结果。
2. 同一 canonical type/revision/builder/pipeline order/authority章节保持单写者。
3. Worker默认 DO NOT MERGE、不得触发 hosted Gate、不得递归分派。
4. Reviewer只读；发现问题返回 exact path/symbol/invariant，不扩大产品 scope。

## 完成证据
- Task Envelopes、owner/path disjoint proof、角色结果与Reconciliation Delta。

## 停止与恢复
- 角色完成并返回 Reconciliation Delta，或明确 blocker后停止。
- Agent失联不polling；继续本地工作或交还A0重算。

## 禁止捷径
- 禁止为了“多看一眼”创建 Agent。
- 禁止主动 list/wait polling。

## 权威
- `AGENTS.md`
- `docs/04-AI自主实现执行蓝图.md`
- `.codex/agents/`
