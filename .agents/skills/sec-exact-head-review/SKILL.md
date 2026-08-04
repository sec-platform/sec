---
name: sec-exact-head-review
description: 对 frozen exact head 做独立只读架构、范围、安全和证据审查；作者自评和变化中的 head 不适用。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-exact-head-review

## 触发
- Role=Reviewer/Auditor，operation=`review`，candidate=frozen，actor independent。

## 不触发
- Reviewer 参与过实现；head/base/Goal 仍会变化；需要写码而非审查。

## 输入
- exact base/head/tree、manifest、真实 diff、authority、tests、Evidence、threads。

## 权限与路径
- 严格只读；finding 返回 owner，不修改 candidate。

## 允许工具与操作
- diff/commit/manifest/Review/checks 读取和反向因果审查。

## 前置门禁
- 适用性合同验证 independent actor、read-only、frozen candidate 与 trusted Skill blob。

## 执行
- 核对 scope、owner、consumer、迁移、复杂度收益和恢复路径。
- 寻找第二 owner、弱断言、遗漏 consumer、probe、自证和生成漂移。
- 每个 finding 绑定 exact path/symbol/invariant/severity。

## 完成证据
- 绑定 exact head 的 Review state、findings、threads 和 unresolved blockers。

## 停止与恢复
- 给出 P0/P1/P2 或无 finding；head 变化立即 stale。

## 禁止捷径
- 不把 PR body、本地 smoke、作者说明或旧 Review 当作当前通过。

## 权威
- `docs/development-governance.md`
- `docs/verification-governance.md`
