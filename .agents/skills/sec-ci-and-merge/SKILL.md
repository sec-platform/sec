---
name: sec-ci-and-merge
description: 用于 frozen PR 的 Scope、Quick/Full、selected Risk、merge authorization、squash merge与main readback；不用于普通 Worker开发或改写已有 Evidence 的 head。
compatibility: SEC 仓库；按本 Skill 的权威与工具边界执行。
---

# sec-ci-and-merge

## 触发
- frozen same-repository PR已具备 manifest、exact base/head和required local evidence。
## 不触发
- Draft候选未验证；trust-root candidate试图自证；HEAD仍会变化。
## 输入
- PR、expected base/head、manifest path/digest、profile、Review/threads/status。
## 执行
1. Scope dispatch必须携带 pull_request、expected_head、expected_base、manifest_digest。
2. Verification dispatch必须再携带 schema、manifest_path、profile。
3. 同一 exact Gate identity只执行一次；长 Gate独立调用。
4. merge前重读 live PR/base/head、Review、threads、status和manifest。
5. 使用 GitHub squash merge并传 expected head SHA；只有 `merged: true`才完成。
6. merge后读取新 main tree和产品结果，再执行branch/worktree清理。
## 停止条件
- merge readback与cleanup完成，或准确返回 blocker。
## 禁止捷径
- 不 force-push frozen head。
- 不把 skipped、missing、pending、manual-bootstrap-required当PASS。
- 不无条件关闭Issue。
## 权威
- `docs/test-feedback-and-ci-lanes.md`
- `.github/workflows/`
- `scripts/codex/merge-gate.ts`
