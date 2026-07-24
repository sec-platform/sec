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
manifest: docs/work-packages/runtime-canonical-line-and-pr137-reconciliation-v1.md
manifestDigest: sha256:003f02bbaee054d7b62f1d1f05645da381b7fd1b6df79595491c696a48324a7e
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

共享resolver只在candidate manifest Git blob SHA-256与`manifestDigest`一致、live default branch不含同path+digest时选择该唯一manifest；default branch包含同一blob后返回`none`。default ref stale/unavailable、path不canonical、candidate drift或多个选择均fail closed。

完整执行闭包只存在于所选frozen manifest。`current-state.yaml`不保存当前候选的未来commit/PR/CI/Review身份；这些volatile evidence由resolver与外部exact-head Context Capsule绑定。
