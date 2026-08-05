---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-05
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/default-branch-health-repair-v1.md
manifestDigest: sha256:8895bc6a2503bf02f4ab0154135c6e8c37079a4c8f994124605f6ae8a080b428
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package default-branch-health-repair-v1 (Issue #280) 修复 main@4b27555b 的
TCB closure 测试漂移与 default-branch 来源健康状态。manifest 保留在
docs/work-packages/ 直到下一个 Work Package 接管 pointer 后归档。

完整执行闭包只存在于所选 frozen manifest。selected manifest 在下一个 Work Package
原子接管 pointer 前保持于 docs/work-packages/，不得先行归档。