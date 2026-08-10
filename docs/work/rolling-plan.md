---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-10
---

# SEC 滚动近期计划

本窗口从 bridge 后受信 `main@caa4a5a6000c02f47011b3bd192e529b85bb78c3` 重新计算。
H340 `702abeca7110b03451cef195a4e17efd3461e536` / tree
`73c16e6f3047e568862abe8c0a4c2d18e9e39612` 只作为 preservation input；其 Review、Gate、
Evidence、Session、bootstrap receipt 与 merge authorization 均已 stale，不能迁移到 V10。

## 当前唯一 Work Package

### verification-action-trusted-cutover-v10

Owners：Issue #311，`ci-verification-maintainer` 与
`verification-control-plane-maintainer`、`development-governance-maintainer`。

目标是在 M1 上精确重建已持久化的 V9 产品语义，同时保留 bridge 建立的 explicit
candidate-root trust boundary：

```text
H340 commit/tree
→ 86 exact blob/mode mechanical records
M1 bridge truth + preserved V9 intent
→ 12 semantic overlap replays
→ V10 manifest add + bridge manifest delete
→ exact 100-path one-parent candidate on M1
```

V10 必须：

- 以 preservation digest
  `sec-v10-preservation-plan-v1` / 19,449 bytes /
  `sha256:8f9eac1d3412523b3494ecc0a225ef105550be127132a59bb5d7a38baaddebd4`
  约束 86 个 non-overlap records，逐个保持 H340 source blob 与 mode；旧的 90-record explicit digest
  `sha256:abe25c409edacb06537ef4526e39ff7699ecac53fa5d121617d630edc8c50d47` 可复算，但已被四个 Review repair
  的 semantic-overlap 重分类取代；
- 新 plan 使用可独立复算的 canonical compact JSON；旧 `sha256:31a4a5f8c6746616ee1b92910afe70f8146f60eec5c50155674b22fe8afbe422`
  序列化不可复算且已退役，不能作为 Evidence；
- V10 raw manifest digest sha256:91a06d6c531efeb6a7078e07de7b5ccdf7bfec61729eddf7f2ce5e41d1bdd15b
  与 active pointer byte-exact 一致；
- 将 12 个 overlap 从 M1 bridge truth 语义重放；其中 `docs/verification-governance.md` 保留
  identity-independent T2 epoch activation semantics。禁止整文件 ours/theirs 覆盖 explicit
  candidate-root、PRE/POST receipt、path/identity 与 fail-closed 合同；
- 保持 `verification-action-trusted-cutover-v9.md` 与
  `verification-action-kernel-finalization-v1.md` 不存在，仅新增 V10 manifest并删除 bridge
  manifest；
- 让最终 M1→V10 diff 恰为 100 个唯一路径，且 V10 是 M1 的唯一直接子提交；
- 将 M1 trusted checker 的 `manual-bootstrap-required` 保持为非 PASS，并仅通过冻结的
  M1-rooted transition evidence、独立 exact-head Review 与一次 expected-head manual merge集成；
- merge 后读取 exact new-main commit/tree 与 100-path结果，运行 ordinary-candidate canary，
  并在进一步 trust-epoch 工作前报告 `TASK_RESTART_REQUIRED`。

## 候选 Work Package

### 1. semantic-impact-failure-routing-v1

V10 完成 new-main readback 后，才从 then-latest main 重算；本候选不占用当前 V10 writer，
也不能进入当前写集。

### 2. feedback-scheduler-hermetic-runtime-v1

V10 完成 new-main readback 后，才从 then-latest main 重算；本候选不占用当前 V10 writer，
也不能进入当前写集。

### 3. compiler-incremental-toolchain-v1

V10 完成 new-main readback 后，才从 then-latest main 重算；本候选不占用当前 V10 writer，
也不能进入当前写集。

## 后续但暂不占 formal writer

- Issue #178 的 causal TCB 历史完成事实只作为 M1-rooted manual transition 的输入；不能把旧
  Evidence、Review 或 bootstrap receipt 复用为 V10 PASS。
- Issue #327 的 repository structural convergence 继续由 V10 后的新 main 重算；当前 V10
  只保存其需求，不吸收其产品 delta。
- Issue #314 的 architecture maturity 与 delivery closure 继续由后续候选消费；当前 V10
  不取得该 Program 的 writer authority。

## 重新规划硬触发器

任一条件成立立即停止并从 then-latest main 重算：

1. V10 不是 `caa4a5a6000c02f47011b3bd192e529b85bb78c3` 的唯一直接子提交；
2. preservation source 不再是 H340 `702abeca7110b03451cef195a4e17efd3461e536` / tree
   `73c16e6f3047e568862abe8c0a4c2d18e9e39612`；
3. 86-record digest、任一 mechanical source blob/mode 或 deletion/addition identity 漂移；
4. 12 个 semantic overlap（含 `docs/verification-governance.md`、`verification-action-github-provider.ts` 与
   `verification-session.ts`）不是从 M1 语义重放，或覆盖
   bridge 的 explicit candidate-root合同；
5. 最终 write set 不等于 frozen 100 paths，或 V9/kernel-finalization manifest重新出现；
6. M1 不理解的 trust-root delta 被解释为 passed，而不是 `manual-bootstrap-required`；
7. candidate checker、workflow、tests 或 H340 旧 proof试图授权 V10 merge；
8. exact-head independent Review仍有 P0-P2，或 manual transition evidence未绑定 exact head/tree；
9. main、PR、branch、manifest、trust revision、runner input 或相同 failure fingerprint发生未处理漂移；
10. merge 后没有先完成 exact new-main readback、ordinary canary 与
    `TASK_RESTART_REQUIRED` 就继续后续 trust-epoch 工作。

## 加速验收

先完成一次 100-path parity/replay census，再运行一个 V10-focused 合同批次、一次必要的
typecheck/TCB reconciliation 与一次独立 M1-rooted transition。速度不能来自少测、放宽
parser/path/identity、重复 rerun 或把 `manual-bootstrap-required` 升级成 PASS；所有复用与失效
都按 exact base/head/tree/manifest/tool/receipt记录。
