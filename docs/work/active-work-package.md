---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-04
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/canonical-architecture-convergence-v1.md
manifestDigest: sha256:878ec1c02d44b4c496f828bc4ef4aaabf35cdbf412fdb3a9c4942190e1d7657d
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

共享 resolver 只在 candidate manifest Git blob SHA-256 与 `manifestDigest` 一致、live default branch 不含同 path+digest 时选择该唯一 manifest；default branch 包含同一 blob 后返回 `none`。default ref stale/unavailable、path 不 canonical、candidate drift 或多个选择均 fail closed。

完整执行闭包只存在于所选 frozen manifest。selected manifest 在下一个 Work Package 原子接管 pointer 前保持于 `docs/work-packages/`，不得先行归档。
