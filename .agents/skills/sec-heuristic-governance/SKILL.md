---
name: sec-heuristic-governance
description: 把真实 Agent 判断收敛到唯一 Skill，把可确定规则下沉到代码；不创建万能 Skill 或行为 DSL。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-heuristic-governance

## 触发
- Role=Auditor/Maintainer，operation=`audit | implement | govern`，且存在重复、冲突或未拥有的启发式。

## 不触发
- 规则可由类型/Schema/validator 完全确定；只改排版或历史内容。

## 输入
- 候选行为 path/text、owner、trigger/exclusion、consumer、现有 Skill 与代码合同。

## 权限与路径
- 只写 Envelope 授权的 Skill/agent contract/tests；Skill 仍是 guidance。

## 允许工具与操作
- 语义去重、确定性/启发式分类、适用性 profile 与 focused tests。

## 前置门禁
- 完整 Envelope、trusted applicability decision；candidate Skill 只作为 SUT。

## 执行
- 先把可确定算法交回代码 owner。
- 同一行为只保留唯一 Skill owner，其他表面仅引用。
- 修改现有 Skill 优先于新增 Skill；本项目不得新增第 18 个万能 Skill。
- 验证 path coverage 仅用于影响分析，不作为 runtime selector。

## 完成证据
- 候选分类、唯一 Skill、删除的重复指导、适用性测试和 trust-root readback。

## 停止与恢复
- 无 orphan/duplicate/catch-all-only 行为；新规则有当前 consumer。

## 禁止捷径
- 不把产品字段、Gate 算法或动态状态复制进 Skill，不为每个文件建 Skill。

## 权威
- `docs/development-governance.md`
- `platform/shared/agent-skill-contract.ts`
