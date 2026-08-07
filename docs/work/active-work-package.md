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
manifest: docs/work-packages/repository-information-lifecycle-v1.md
manifestDigest: sha256:f5575743efec3ef55db348144235dd7d76516495ec733216226f05b209301d59
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `repository-information-lifecycle-v1`（Issue #282）从
`main@f6ddbfe441bdafe3f22e12b1fb08e4899242a7e7` 激活。前驱
`verification-control-plane-foundation-v1`（#311）已闭合（PR #322/#323 进入
`main`，terminal closeout receipt 已发布）。本包对 `2d7187f4... → 6cbe65d8...`
全部 removed/renamed blobs 建立 machine-readable disposition，绑定 Nexus
absorption ledger（29 EPR）缺口，并扩展现有 repository audit。
完整执行闭包只存在于本 pointer 选中的 frozen manifest。
