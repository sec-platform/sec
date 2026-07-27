---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-27
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/agent-skills-and-v19-alignment-v2.md
manifestDigest: sha256:28d39ded9867a6020d7283f108fce4288a5717e700b7274d265a0f0efe99a3d8
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

共享 resolver只在candidate manifest Git blob SHA-256与`manifestDigest`一致、live default branch不含同path+digest时选择该唯一manifest；default branch包含同一blob后返回`none`。default ref stale/unavailable、path不canonical、candidate drift或多个选择均fail closed。

完整执行闭包只存在于所选frozen manifest。selected manifest在下一个 Work Package原子接管 pointer前保持于`docs/work-packages/`，不得先行归档。
