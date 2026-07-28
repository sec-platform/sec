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
manifest: docs/work-packages/runtime-authority-and-package-layout-v1.md
manifestDigest: sha256:07badf24ccb653de4169df132074a64258c6d5b912492159a24df5e88a8f3811
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

共享 resolver只在candidate manifest Git blob SHA-256与`manifestDigest`一致、live default branch不含同path+digest时选择该唯一manifest；default branch包含同一blob后返回`none`。default ref stale/unavailable、path不canonical、candidate drift或多个选择均fail closed。

完整执行闭包只存在于所选frozen manifest。selected manifest在下一个 Work Package原子接管 pointer前保持于`docs/work-packages/`，不得先行归档。
