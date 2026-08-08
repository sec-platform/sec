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
manifest: docs/work-packages/verification-action-kernel-finalization-v1.md
manifestDigest: sha256:bd16196a06cd18170523407b84e2776e08ddc227a236b9aa70261159087fcefa
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `verification-action-kernel-finalization-v1`（Issue #311 ordinary-SUT
finalization，消费已合并 #338 action-reuse kernel）从
`main@37c8609d5d54b5fb74292cffc83bd7dfcc362988` 激活。

前驱 `trusted-verifier-causal-closure-v1`（Issue #178）与 T1.1 action-reuse repair
均已完成 new-main readback；本次只消费既有 causal TCB / bootstrap 事实，不重新打开
其产品范围。#338 的 tree parity 与 Gate 已完成，但 post-merge audit 仍要求本包在
ordinary-SUT 层封死 owner identity、dependency closure readback、strict ordinary-data
boundary 和 V2 disposable journal migration。

当前包只修改 `scripts/codex/verification-action-*` 与其 focused tests、control-plane
manifest/pointer；明确禁止修改 causal TCB、workflow、dev-runner、Test Impact trust
rules、CI Evidence、merge-gate 与 physical merge authority。`executionClass` 已裁决为
Plan/Scheduler cost policy，从 ActionKey semantic identity 移除。后继 T2 trust-aware
cutover 必须等本包完成 machine-visible Review receipt、Gate 和新的 `main` readback 后
再单独冻结。
