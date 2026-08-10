---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-10
---

# 当前唯一 Active Work Package

```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/verification-action-trusted-cutover-v10.md
manifestDigest: sha256:91a06d6c531efeb6a7078e07de7b5ccdf7bfec61729eddf7f2ce5e41d1bdd15b
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

Work Package `verification-action-trusted-cutover-v10` 从受信 bridge main
`caa4a5a6000c02f47011b3bd192e529b85bb78c3` 激活。其 preservation source 仅为 H340
`702abeca7110b03451cef195a4e17efd3461e536` / tree
`73c16e6f3047e568862abe8c0a4c2d18e9e39612`，86-record mechanical plan 固定为
`sec-v10-preservation-plan-v1` / 19,449 bytes /
`sha256:8f9eac1d3412523b3494ecc0a225ef105550be127132a59bb5d7a38baaddebd4`。旧的
90-record explicit digest `sha256:abe25c409edacb06537ef4526e39ff7699ecac53fa5d121617d630edc8c50d47`
仍可复算，但已被四个 Review repair 转为 semantic overlap 后的计划取代。

最终 write set 恰为 100 路径：86 个 exact blob/mode mechanical records、12 个从 M1 bridge
语义重放的 overlaps（包含 `docs/verification-governance.md`、`verification-action-github-provider.ts`
与 `verification-session.ts`）、V10 manifest 新增与 bridge manifest 删除。V9 与 kernel-finalization
manifest 均保持不存在；所有旧 Review/Gate/Evidence/Session/bootstrap/merge authorization
均已 stale。M1 checker 的预期 `manual-bootstrap-required` 不能提升为 PASS，只能进入冻结的
expected-head manual transition；merge 后必须 exact new-main readback 并报告
`TASK_RESTART_REQUIRED`。
