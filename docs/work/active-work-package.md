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
manifest: docs/work-packages/active-documentation-corpus-convergence-v2.md
manifestDigest: sha256:bb13e7834d0729a41c76d2fb18109bd39326a7e4f220d5bd995f1bb213bcfb8f
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

共享 resolver 只在 candidate manifest Git blob SHA-256 与 `manifestDigest` 一致、live
default branch 不含同 path+digest 时选择该唯一 manifest；default branch 包含同一 blob
后返回 `none`。default ref stale/unavailable、path 不 canonical、candidate drift 或多个
选择均 fail closed。

完整执行闭包只存在于所选 frozen manifest。selected manifest 在下一个 Work Package
原子接管 pointer 并完成 new-main readback 前保留；接管完成后直接从当前树删除，不转存
完成态 Markdown 副本。
