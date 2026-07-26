---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-26
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/windows-browser-launch-path-authority-v1.md
manifestDigest: sha256:6d7934d951dfb23b081f605c9a379516dbf31ca18c268d196f9b0537a4067554
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

共享resolver只在candidate manifest Git blob SHA-256与`manifestDigest`一致、live default branch不含同path+digest时选择该唯一manifest；default branch包含同一blob后返回`none`。default ref stale/unavailable、path不canonical、candidate drift或多个选择均fail closed。

完整执行闭包只存在于所选frozen manifest。`current-state.yaml`不保存当前候选的未来commit/PR/CI/Review身份；这些volatile evidence由resolver与外部exact-head Context Capsule绑定。
