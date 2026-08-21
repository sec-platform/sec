---
name: sec-exact-head-review
description: 对机器已冻结的 exact candidate 做独立、对抗式缺陷判断；不拥有 candidate identity、Review 状态机、Gate 或修复实现。
---

# sec-exact-head-review

本 Skill 仅在 trusted applicability 选中后加载；只消费 Operation Read Plan 已准入事实，`effectAuthority=none`。

## 适用边界
- 适用：exact base/head/tree 已冻结且 reviewer independence 已由机器 owner 证明，需要不可约的对抗式 Review 判断；或 finding 需要判断是否真实违反 canonical invariant。
- 不适用：candidate 仍会变化、独立性未成立、只需查询 Review/thread/check 状态，或已有 validator 可直接判定。

## 已准入输入
- 仅使用 Read Plan 给出的 exact diff/changed symbols、scope/owner/acceptance、相关 canonical contract、Verification Evidence 与 Review facts。
- 缺关键 owner/Evidence 返回 `review-unresolved`，不浏览旧 PR、历史评论、全仓代码或其他 Skill。

## 判断职责
1. 从真实 diff 反向验证每个变化的 owner、scope、acceptance 与 consumer closure。
2. 主动寻找遗漏 consumer、反向因果、弱化 assertion、临时 probe、生成物漂移、自证路径、权限越界和恢复空洞。
3. 对每个 finding 给出最强替代解释；只有 Evidence 能排除替代解释时才提升严重度。
4. 明确已审 surface 与未知边界，不用“没看到问题”替代覆盖说明。

## 判断输出
- `reviewJudgement`：exact candidate identity ref、P0/P1/P2 findings、每项 path/symbol/invariant/evidence、未知边界与 clean/no-clean 结论。
- 正式 Review submission/state 仍由机器 owner 发布和读取。

## 停止与回退
- 完整 findings/clean judgement 已形成时停止；finding 交还实现 owner。
- candidate identity 变化时旧 judgement 立即 stale，并对新 exact candidate 重新 applicability/read-plan。

## 禁止
- 不把作者自评、PR body、旧 Review、旧 head Evidence 或测试绿灯当独立 Review。
- 不直接改码、不触发 Gate/merge，不把 Reviewer 变成第二 writer。

## 语义权威（非自动读取）
以下只声明优先级；是否读取仍由当前 Read Plan 决定：
- `docs/development-governance.md`
- `docs/verification-governance.md`
- 当前 candidate 对应的 canonical domain owner
- Review/merge 状态的确定性机器 owner
