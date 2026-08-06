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
manifest: docs/work-packages/active-documentation-corpus-convergence-v2.md
manifestDigest: sha256:bc49a9eb2bcad34f7a0d873070b830d616951eb9eee6b58887266a2aa902ca45
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `active-documentation-corpus-convergence-v2`（Issue #235）从
`main@2d7187f4fc16301e25a142bdd62340d9670a4a9f` 重建，统一承载当前文档语料收缩、
审计结论 owner 路由、registry v2、历史字节 fixture 迁移和后继计划重算。

旧 PR #273 及其 manifest、Review、Evidence 和动态 identity 只作为实现来源，不授予
当前候选任何 authority。完整执行闭包只存在于本 pointer 选中的 frozen manifest；
manifest 在下一个 Work Package 原子接管 pointer 前保持于 `docs/work-packages/`。
