---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-11
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/skill-applicability-gate-v1.md
manifestDigest: sha256:beadbc2343fdfe4f5c118281af244c94a1caa520d5cab66ff5a3807839935d8e
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `skill-applicability-gate-v1` 从受信 `main@7543d37ad733432cbc2ddddd205c98f574e882c4`
激活（Issue #275）。前一包 `verification-action-trusted-cutover-v10` 已完成 new-main readback：
其 manifest digest `sha256:91a06d6c531efeb6a7078e07de7b5ccdf7bfec61729eddf7f2ce5e41d1bdd15b`
与 new main 字节一致，`Independent-Exact-Head-Review: P0=0 P1=0 P2=0`，
`Manual-Transition-Receipt` 绑定 exact base/head/tree；旧 Review/Gate/Evidence/Session/
bootstrap receipt 全部 stale，不得复用。`TASK_RESTART_REQUIRED` 已由本新会话满足。

本指针由受信 main 上的控制面契约（`scripts/codex/document-control-plane.ts`）解析为
candidate activation；本包 merge 后必须执行 exact new-main readback 并报告
`TASK_RESTART_REQUIRED`，之后才允许后续 trust-epoch 或治理工作。
