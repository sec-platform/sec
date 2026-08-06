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
manifest: docs/work-packages/frozen-digest-canonical-form-repair-v1.md
manifestDigest: sha256:a5cc84eceb17277801dd074af34f7c0acf804b2a7e92591017d6254b1bdb8e81
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `frozen-digest-canonical-form-repair-v1`（Issue #309）从
`main@6cbe65d86a985678a123d466149be6fad990100d` 重建并激活，修复 `4b27555b`
canonical sha256 refactor 后 9 个 canonical-form 测试文件（8 semantic-mutation + 1 impact-propagation）的 frozen digest
不匹配问题。前驱 `active-documentation-corpus-convergence-v2`（Issue #235，PR
#284）已合并，其 manifest、Review、Evidence 和动态 identity 只作为实现来源，不授予
当前候选任何 authority。完整执行闭包只存在于本 pointer 选中的 frozen manifest；
manifest 在下一个 Work Package 原子接管 pointer 前保持于 `docs/work-packages/`。
