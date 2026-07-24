---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-24
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/docs-authority-content-normalization-v1.md
manifestDigest: sha256:476231018a1459724f20d2f00243c32660eabc3f77ef9837a6ee6c5deeab3080
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

共享 resolver只在 candidate manifest Git blob SHA-256与`manifestDigest`一致、live default branch不含同 path+digest时选择该唯一 manifest；default branch包含同一blob后返回`none`。default ref stale/unavailable、path不canonical、candidate drift或多个选择均fail closed。

完整执行闭包只存在于所选 frozen manifest。`current-state.yaml`不保存当前候选的未来commit/PR/CI/Review身份；这些 volatile evidence由resolver与外部exact-head Context Capsule绑定。
