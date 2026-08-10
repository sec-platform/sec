---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-10
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/trusted-bootstrap-base-first-repair-v1.md
manifestDigest: sha256:225f64358f4288fd0c1ab90a20bc157c79ff4bf0ad49594e9e853f9fdde07e14
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `trusted-bootstrap-base-first-repair-v1` 从
`main@33216029c751fd55a1bace1b5ce63d3937a0064c` 激活。PR #340 的 exact-head
Review 证明 default-branch bootstrap 在候选 checkout 后执行候选自己的 checker，受信 base
没有显式 candidate-data root，因此当前 V9 候选不能在同一 trust epoch 内修复并认证自己。

本包只引入 base-owned explicit candidate-root checker、PRE/POST receipt 和 steady-state
双根 workflow。Bridge 自身必须通过冻结的 old-base transition evidence、独立 exact-head
Review 与人工 expected-head merge；candidate tests 只能作为旁证。Bridge 进入 main 后立即
`TASK_RESTART_REQUIRED`，所有旧 Review/Gate/Evidence/Session/bootstrap/merge authorization
失效，再从新 main 重建 `verification-action-trusted-cutover-v10`。
