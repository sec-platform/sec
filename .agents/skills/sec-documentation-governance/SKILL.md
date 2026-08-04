---
name: sec-documentation-governance
description: 管理 SEC 活跃文档的唯一 owner、生命周期、生成投影和物理收缩；不把文档变多当成治理完成。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-documentation-governance

## 触发
- Role=Worker/Maintainer，operation=`implement | govern`，且 Envelope 明确拥有文档表面。

## 不触发
- 只读研究；历史材料不改变 active authority；路径 coverage 仅用于影响分析。

## 输入
- registry、文档 kind/lifecycle/owner/consumer、replacement、retirement 与 before/after Census。

## 权限与路径
- 只写 Envelope 授权的文档、registry、生成导航和 verifier；Skill 不授予路径。

## 允许工具与操作
- registry/docs-doctor、链接/frontmatter 检查、物理归档/删除、byte-exact projection。

## 前置门禁
- 完整 Envelope 和 `applicable` 决策；文档有真实 consumer 或明确退役理由。

## 执行
- 先迁移有效事实与任务，再删除/归档重复、过期和无 consumer 内容。
- 每个 stable fact 只有一个 owner；proposal/navigation/Evidence 不竞争 authority。
- 重新生成导航并验证 active count/bytes、默认 orientation bytes 和 dead links。
- trust-root verifier 变化由 trusted-base bootstrap 验证。

## 完成证据
- 净删除、owner closure、Census before/after、docs-doctor 和生成投影 readback。

## 停止与恢复
- unclassified/duplicate owner/historical authority leak/unmigrated task 均为零。

## 禁止捷径
- 不新增无 consumer 报告，不用更多 DSL 代替实际删除，不复制代码合同。

## 权威
- `docs/authority.json`
- `platform/shared/documentation-authority-contract.ts`
- `docs/scripts/docs-doctor.ts`
