---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-28
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/document-authority-simplification-v1.md
manifestDigest: sha256:43b6d9d994632b6ec499a1363e5bee2458bde80ebf45402adf699937d74305b6
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

共享 resolver 只在 candidate manifest 的 raw Git blob SHA-256 与 `manifestDigest` 一致、live default branch 不含同 path + digest 时选择该 manifest。default ref stale/unavailable、candidate drift、非 canonical path 或多个选择均 fail closed。
