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
manifestDigest: sha256:3f2daa9747a1e574d92d72656e621eedf3a1cf2b7cc4a5a3f774d88d1f92452c
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `default-branch-health-repair-v2` (Issue #280) 完成 v1 post-merge
closure 的根因闭包：修复 14 个 imports:check 失败、移除 audit 对合法 post-merge
状态的 false positive finding、重构 revision-health receipt 为 per-revision
lattice-derived Evidence。manifest 保留在 `docs/work-packages/` 直到下一个 Work
Package 接管 pointer 后归档。共享 resolver 只在 candidate manifest Git blob
SHA-256 与 `manifestDigest` 一致、live default branch 不含同 path+digest 时选择
该唯一 manifest；default branch 包含同一 blob 后返回 `none`。default ref
stale/unavailable、path 不 canonical、candidate drift 或多个选择均 fail closed。

完整执行闭包只存在于所选 frozen manifest。selected manifest 在下一个 Work Package
原子接管 pointer 前保持于 `docs/work-packages/`，不得先行归档。
