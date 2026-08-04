---
name: sec-repository-orientation
description: 为任何 SEC 任务建立 latest main、目标 workspace、PR/CI/Review 和 authority 的最小事实快照；不直接修改代码。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-repository-orientation

## 触发
- operation=`orient`，新任务、恢复或 live facts 可能变化。

## 不触发
- 已有未过期 snapshot 且 Goal/base/target/Role/operation 均未变化。

## 输入
- repository/default ref、intended workspace、PR/Issue/Review/CI、pointer/manifest。

## 权限与路径
- 严格只读；不因 orientation 自动选择 Skill 或写 Work Package。

## 允许工具与操作
- trusted resolver、Git/GitHub read、最小相关 source/authority 读取。

## 前置门禁
- repository identity 和用户任务明确；resolver closure 绑定 trusted base。

## 执行
- 先证明 resolver 来自 trusted default/base。
- 运行 resolver 时保持intended workspace作为resolver cwd或显式target。
- 核对 default ref、workspace、pointer、manifest 和 GitHub facts。
- 输出 applicability 所需 Role/operation/Goal/Envelope binding，不加载完整 Skill 正文。

## 完成证据
- resolved snapshot、exact identities、authority refs 和 reload conditions。

## 停止与恢复
- 形成最小充分快照；任一关键输入 unresolved/invalid 即 fail closed。

## 禁止捷径
- 不把聊天、旧计划、PR body 或历史 branch 当当前事实，不轮询不变状态。

## 权威
- `AGENTS.md`
- `docs/work/current-state.yaml`
- `docs/authority.json`
