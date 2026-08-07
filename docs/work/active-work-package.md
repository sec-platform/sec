---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-07
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/branch-ref-lifecycle-enforcement-v1.md
manifestDigest: sha256:874ec98bda6fbfc675642e31de046c0b7c6ef7dc0c400a1db26e40a45b0a0ef2
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `branch-ref-lifecycle-enforcement-v1`（Issue #313）从
`main@38a5bf80c24ea8703e7ed9a7aff3b7a920d95aff` 激活，承载 PR #308 后控制面结算、
branch/ref terminal receipt 强制、admin/web/connector 旁路检测与 self-closeout。
前驱 `implementation-resolution-architecture-convergence-v1` 已通过 PR #308 进入 `main`；
其稳定架构内容保留，但旧 candidate identity、Review、Gate 和 Evidence 不复用。
完整执行闭包只存在于本 pointer 选中的 frozen manifest。
