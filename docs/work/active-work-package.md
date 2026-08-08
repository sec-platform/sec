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
manifest: docs/work-packages/verification-session-action-reuse-v1.md
manifestDigest: sha256:74803378b99b6d7cfd9b480832138462ac7d2f13e7e46f504589e66ae4b9f07c
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `verification-session-action-reuse-v1`（Issue #311，消费 Issue #179/#316）
从 `main@49fdb7cd3be991742061621e3add982107e50367` 激活。

前驱 `trusted-verifier-causal-closure-v1`（Issue #178）已完成并经 new-main readback；
本次只消费其 causal TCB / trusted-bootstrap 事实，不重新打开其产品范围。2026-08-08
#327 的数小时执行暴露 scope avalanche、重复昂贵 Action 与 proof-reset amplification，
因此 Verification/Development Throughput 已从“已路由后继”升级为当前真实 blocker。

当前包只在 ordinary-SUT `scripts/codex/verification-session*` seam 建立
content-addressed VerificationAction、Run Journal、reuse/invalidation 和 cheap-before-expensive
调度合同；明确禁止修改 causal TCB、workflow、dev-runner、Test Impact trust rules、
CI Evidence 与 merge authority。后继 trust-aware cutover 必须从新 `main` 单独冻结。
