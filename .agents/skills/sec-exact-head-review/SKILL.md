---
name: sec-exact-head-review
description: 用于 frozen exact head 的独立架构、证据、权限和范围审查；不用于边实现边审查或用 PR body 代替 diff。
compatibility: SEC 仓库；按本 Skill 的权威、权限和验证边界执行。
---

# sec-exact-head-review

## 触发
- candidate已冻结且需要独立 Review、REQUEST_CHANGES处理或 trust-root审计。

## 不触发
- HEAD仍会变化；Reviewer与实现写者没有独立性。

## 输入
- exact base/head/tree、manifest、changed records、authority、tests、Evidence、threads。

## 权限与路径
- Reviewer只读exact candidate、authority、Evidence与GitHub review面。

## 允许工具与操作
- diff/commit/manifest读取、Review/thread/status查询、静态/架构审查。

## 前置门禁
- candidate frozen且Reviewer独立；base/head/tree固定。

## 执行
1. 从真实 diff验证 scope、owner、authority和acceptance。
2. 主动寻找反向因果、遗漏 consumer、弱化断言、临时 probe、生成物漂移和自证路径。
3. 将 Review绑定 exact head；head变化立即标记 STALE。
4. 区分 COMMENT、APPROVE、CHANGES_REQUESTED和未解决 thread。

## 完成证据
- 绑定exact head的Review state、findings、threads、REQUEST_CHANGES。

## 停止与恢复
- 给出 P0/P1/P2 finding或无 finding；不得替代物理 Gate。
- head变化Review立即STALE；finding交还实现或A0，不直接改码。

## 禁止捷径
- 不把作者自评、PR body、旧 Review或旧 head Evidence当成当前通过。

## 权威
- `AGENTS.md`
- `docs/04-AI自主实现执行蓝图.md`
- `scripts/codex/merge-gate.ts`
