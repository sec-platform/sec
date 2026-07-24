---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-23
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/docs-control-plane-publication-lifecycle-v1.md
manifestDigest: sha256:d78210c4640caf5f620391431083b0ce18917691755b47c4b2740b1ef0fbb53e
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

选择器只在 candidate manifest 的 Git blob bytes SHA-256 与 `manifestDigest` 一致、且 live default branch不含同 path + digest时解析为该唯一 manifest。default branch包含同一 blob后自动解析为`none`，因此合并不需要再创建只更新自身 lifecycle 的递归 Work Package。default ref不可解析、candidate digest漂移或出现多个选择时均 fail-closed。

完整执行闭包只存在于所选 frozen manifest。`current-state.yaml`只保存 resolver 配置与不依赖当前 publication identity 的稳定事实；candidate exact head、PR、Review、CI与 merge evidence由外部 Context Capsule绑定，不写入这些 versioned控制文件。
