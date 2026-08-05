---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-06
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/default-branch-health-repair-v2.md
manifestDigest: sha256:aff35bea51ce40a7099903701ba649db661472a55bb774e33a98e7d597fff1d2
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `default-branch-health-repair-v2` (Issue #280) 用于完成 v1 post-merge
closure 的根因闭包：修复完整 import-organization 缺陷集、统一 audit 与 pointer
生命周期语义，并将 revision-health 改为 exact-subject external physical Evidence
的 validated projection。manifest 保留在 `docs/work-packages/` 直到下一个 Work
Package 原子接管 pointer 后归档。共享 resolver 只在 candidate manifest Git blob
SHA-256 与 `manifestDigest` 一致、live default branch 不含同 path+digest 时选择
该唯一 manifest；default branch 包含同一 blob 后返回 `none`。default ref
stale/unavailable、path 不 canonical、candidate drift 或多个选择均 fail closed。

完整执行闭包只存在于所选 frozen manifest。selected manifest 在下一个 Work Package
原子接管 pointer 前保持于 `docs/work-packages/`，不得先行归档。
