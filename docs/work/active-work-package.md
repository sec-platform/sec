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
manifest: docs/work-packages/verification-session-action-reuse-t1-1-defect-closure-v1.md
manifestDigest: sha256:c931321ea4773de98bc4c84d59cb4cacfa00f9e4d7d7bcdf0ae482e61281e9f7
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `verification-session-action-reuse-t1-1-defect-closure-v1`（Issue #311 T1.1，
消费已合并 action-reuse kernel 的 ordinary-SUT 缺陷闭包）从
`main@1d301987e86cc791bddd8e9fbd27885413b022f8` 激活。

前驱 `trusted-verifier-causal-closure-v1`（Issue #178）已完成并经 new-main readback；
本次只消费其既有 causal TCB / trusted-bootstrap 事实，不重新打开其产品范围。
PR #335 已合并；本 T1.1 只修 ordinary-SUT action identity、plan state ownership 和
owner-reentrancy，T2 trust-root migration、Review-Stable Barrier 与 physical merge
authorization 保持后继边界。

当前包只在 ordinary-SUT `scripts/codex/verification-action-*` seam 收束
content-addressed VerificationAction、Run Journal、reuse/invalidation、machine-state
resolution 与 cheap-before-expensive 调度合同；明确禁止修改 causal TCB、workflow、
dev-runner、Test Impact trust rules、CI Evidence 与 merge authority。后继 trust-aware
cutover 必须从新的 `main` 单独冻结。
