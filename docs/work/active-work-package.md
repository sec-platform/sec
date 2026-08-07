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
manifest: docs/work-packages/verification-control-plane-foundation-v1.md
manifestDigest: sha256:61a63604639bc605bc2ee4ddd992b86c62b5e5fb2acab259056ce9f570be2b7f
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `verification-control-plane-foundation-v1`（Issue #311）从
`main@ba5b5c1560604b42725c686062e13fa44a0c6795` 激活。前驱
`branch-ref-lifecycle-enforcement-v1`（#313）已闭合（PR #315/#319 进入 `main`，
self-closeout 与 #280 protected-pending 结算 receipt 已发布并 readback，
manifest 保留为完成记录）。新包建立最小 Verification Session：machine registry
projection、稳定 Manifest 与 FreezeSession 分离、Candidate Tree 与单一 Session
纵切片；#313 的 published receipt 机制作为输入事实消费。
完整执行闭包只存在于本 pointer 选中的 frozen manifest。
