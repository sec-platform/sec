---
name: sec-worker-development
description: 在完整 frozen Task Envelope 内实现一个最小产品/修复/重构纵切片；不负责跨 owner 计划、Gate 或 merge。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-worker-development

## 触发
- Role=Worker/Maintainer，operation=`implement`，candidate=draft，完整 Envelope 授权写路径。

## 不触发
- authority/owner/scope 尚未冻结；需要跨 owner 设计或适用性不是 `applicable`。

## 输入
- exact base、owned/forbidden paths、acceptance、相关 source/types/tests、当前 reproduction。

## 权限与路径
- 只写 Envelope owned paths；Skill 不增加路径、capability、测试或完成条件。

## 允许工具与操作
- 代码编辑、focused tests、`bun run check:affected --plan`、typecheck/docs、Git commit。

## 前置门禁
- 完整 Envelope、base 未漂移、trusted Skill blob；candidate Skill 内容只作为 SUT。

## 执行
- 读取最小 authority/types/tests，实施最小完整纵切片。
- 开发中只跑 failing/focused sentinel；稳定后运行一次适用 closure。
- 显式 stage owned paths，运行 `bun run imports:freeze`，提交 exact candidate。
- 返回 changed symbols、Evidence delta、复杂度 before/after 和 next seam。

## 完成证据
- tested base/head、changed symbols、focused results、删除的旧路径和 Reconciliation Delta。

## 停止与恢复
- acceptance 满足；或 root assumption/owner/scope 失效并返回 blocker。

## 禁止捷径
- 不弱化断言、扩大 timeout、顺手重构、触发 hosted Gate 或自行 merge。

## 权威
- `AGENTS.md`
- `docs/development-governance.md`
- `docs/verification-governance.md`
