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
manifest: docs/work-packages/repository-information-data-ownership-v1.md
manifestDigest: sha256:3aca6ada234a31bd1b2ce79edb860b787a5d240879b40fdcde991dcee3ade154
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `repository-information-data-ownership-v1`（Issue #327）从
`main@49fdb7cd3be991742061621e3add982107e50367` 激活。前驱
`trusted-verifier-causal-closure-v1`（Issue #178）已完成 old-trusted candidate-as-SUT、
独立 Review、squash merge 与 new-main readback并关闭；旧 manifest 由本 candidate
在 pointer 原子接管时退役。

当前包只拥有 Issue #282 repository information machine data 的首个结构收敛切片：
把 146 条 deleted/renamed blob exact records 与 16 个 durable claim families 从 generic
`repository-audit.ts` 中迁到 provider-neutral data/contract owner，同时保持 audit 行为兼容。
Nexus 29 EPR records 因 canonical ledger strict validator 属于 causal TCB，已回退到后继独立
trusted-bootstrap-aware slice，不在当前普通 SUT 包中偷改 trust boundary。
