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
manifestDigest: sha256:20a15dabe01606f5da1440c86151460b5cabd75b2e8bef4c48910e5da0cdcb94
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `trusted-verifier-causal-closure-v1`（Issue #178）从
`main@26dcb43c77c9bdfebee35efc217113c958ed017d` 激活。前驱
`repository-information-lifecycle-v1`（Issue #282）已完成 post-merge trust repair
并关闭；旧 manifest 的 durable machine consumers 已迁移后从 active directory 删除。
当前包把 verifier trust-root 从目录近似收敛为唯一 machine registry、explicit static
privileged surfaces 与 exact causal runtime TCB closure，并由 GitHub Actions 承载物理
candidate-as-SUT regression。完整执行闭包只存在于本 pointer 选中的 frozen manifest。
