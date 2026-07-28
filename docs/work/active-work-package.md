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
manifest: docs/work-packages/isolated-runtime-bundle-layout-v1.md
manifestDigest: sha256:990e130ec010bbb9c3a0f6efac1966adfc661990da60113b04582d52315ce42a
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

共享 resolver只在candidate manifest Git blob SHA-256与`manifestDigest`一致、live default branch不含同path+digest时选择该唯一manifest；default branch包含同一blob后返回`none`。default ref stale/unavailable、path不canonical、candidate drift或多个选择均fail closed。

完整执行闭包只存在于所选frozen manifest。selected manifest在下一个 Work Package原子接管 pointer前保持于`docs/work-packages/`，不得先行归档。
