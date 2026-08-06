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
manifest: docs/work-packages/implementation-resolution-architecture-convergence-v1.md
manifestDigest: sha256:3dc86fc2d07d12afcb39e5f808177842aa1e9f5b03c5070c0b58a11a21e5e62d
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `implementation-resolution-architecture-convergence-v1`（Issue #307）从
`main@334c7717e9ed7ed40c250be9a9acc2f2fea77d83` 重建并激活，统一承载 Implementation
Resolution 设计的 canonical owner 融合、authority registry 更新、生成索引重算和
后继计划路由。前驱 `active-documentation-corpus-convergence-v2`（Issue #235）已通过
PR #284 合并，其 manifest、Review、Evidence 和动态 identity 只作为实现来源，不授予
当前候选任何 authority。完整执行闭包只存在于本 pointer 选中的 frozen manifest；
manifest 在下一个 Work Package 原子接管 pointer 前保持于 `docs/work-packages/`。
