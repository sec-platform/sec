---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-08
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/trusted-verifier-causal-closure-v1.md
manifestDigest: sha256:dac0f41dbe1e86b5f2253d680c83260be90dfb3607ef6294ac2b4b2e23651e50
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `trusted-verifier-causal-closure-v1`（Issue #178）从
`main@26dcb43c77c9bdfebee35efc217113c958ed017d` 激活。前驱
`repository-information-lifecycle-v1`（#282）已完成 post-merge trust repair
并关闭。当前包把 verifier trust-root 从目录近似收敛到 static privileged
surfaces + actual causal runtime TCB closure；完整执行闭包只存在于本 pointer
选中的 frozen manifest。
