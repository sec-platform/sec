---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-02
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/verification-artifact-claim-summary-v1.md
manifestDigest: sha256:affb15a21586db42a944e61067db2bb414f42c64aed1b40c6d2ec32ca80c46c6
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

共享 resolver 只在 candidate manifest Git blob SHA-256 与 `manifestDigest` 一致、live default branch 不含同 path+digest 时选择该唯一 manifest；default branch 包含同一 blob 后返回 `none`。default ref stale/unavailable、path 不 canonical、candidate drift 或多个选择均 fail closed。

完整执行闭包只存在于所选 frozen manifest。selected manifest 在下一个 Work Package 原子接管 pointer 前保持于 `docs/work-packages/`，不得先行归档。
