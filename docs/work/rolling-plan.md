---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-10
---

# SEC 滚动近期计划

本窗口从 live `main@33216029c751fd55a1bace1b5ce63d3937a0064c` 重新计算。PR #340
候选 `702abeca7110b03451cef195a4e17efd3461e536` 已持久化并保持单父/clean，但
Review `3745507962` 证明 old-main bootstrap 运行 candidate checker 自证。此前对 #340 的
Review、trusted-bootstrap 与 Gate 结果不能弥补这个 trust-root 缺口。

## 当前唯一 Work Package

### trusted-bootstrap-base-first-repair-v1

Owners：Issue #311，`ci-verification-maintainer` 与
`development-governance-maintainer`。

目标是先用一个直接基于当前 main 的最小 bridge 建立唯一 explicit candidate-root checker：

```text
trusted-base code / parser / policy / toolchain / dependencies
→ validated explicit candidate Git/file data root
→ trusted PRE closure receipt
→ credential-free candidate SUT regression
→ trusted POST closure receipt
→ exact immutable-field equality
→ bootstrap verdict
```

Bridge 必须：

- 只改 bootstrap workflow、TCB closure owner、既有 CI verifier入口、三个直接合同测试和
  control-plane takeover；不吸收 PR #340 的产品 delta；
- 为 root、每个 source/import/module read 与 digest 使用一个 canonical reader；选择 root 后
  不能回退 ambient cwd、环境变量或 module-owned `compilerRoot`；
- 将候选视为数据，trusted verdict 前不 import/执行 candidate checker、generator、package
  script、dependency tree 或 tests；
- 对 base 不理解的 policy/schema/entrypoint/edge 扩展返回
  `manual-bootstrap-required`；
- 用 disjoint base/candidate roots、exact SHA/tree/clean/realpath fences、去凭据执行和 PRE/POST
  receipt 关闭 substitution、path escape 与 TOCTOU；
- 不能由新 checker 自己授权 merge。只接受冻结 old-base transition evidence、独立
  exact-head Review、一次 expected-head squash merge 和 exact new-main tree readback；
- merge 后立即结束旧 epoch并报告 `TASK_RESTART_REQUIRED`。

## 候选 Work Package

### 1. verification-action-trusted-cutover-v10

Bridge 进入新 main 后，从新的 exact trust revision 重新冻结。V10 以已持久化 V9 tree/diff
为 preservation input，通过 `(old main, bridge main, V9 candidate)` 三方 blob/mode parity
重建为新 main 的唯一直接子提交；重叠的 checker/workflow/test 路径以 bridge 为基线语义重放，
禁止整文件 ours/theirs 覆盖。

V10 必须创建新的 manifest/base/digest，原子切换 pointer 与 rolling plan，并重新获得
exact-head Review、trusted-rooted bootstrap、merge authorization。旧 head 的任何 Review、
Evidence、Session、artifact 或 bootstrap receipt 都是 stale。只有 V10 新 PR/ref/tree parity
持久化后，才可把旧 PR #340 head 作为 superseded history处理。

### 2. semantic-impact-failure-routing-v1

Bridge 与 V10 完成 new-main readback 后，才从 then-latest main 重算；本候选不占用当前
bridge writer，也不能进入当前写集。

### 3. feedback-scheduler-hermetic-runtime-v1

Bridge 与 V10 完成 new-main readback 后，才从 then-latest main 重算；本候选不占用当前
bridge writer，也不能进入当前写集。

### 4. compiler-incremental-toolchain-v1

Bridge 与 V10 完成 new-main readback 后，才从 then-latest main 重算；本候选不占用当前
bridge writer，也不能进入当前写集。

## 后续但暂不占 formal writer

- Issue #178 的 causal TCB 历史完成事实仅作为 bridge old-base transition 的来源；bridge
  合并后必须按新 trust revision 重新读取，不能复用旧 Evidence。
- Issue #327 的 repository structural convergence 继续由 V10 后的新 main 重算；当前 bridge
  只保存其需求，不吸收其产品 delta。
- Issue #314 的 architecture maturity 与 delivery closure 继续由后续候选消费；当前 bridge
  不取得该 Program 的 writer authority。

## 重新规划硬触发器

任一条件成立立即停止并从 then-latest main 重算：

1. bridge 不是 `33216029c751fd55a1bace1b5ce63d3937a0064c` 的唯一直接子提交；
2. candidate write set 超出 frozen manifest，或出现任何 PR #340 产品 delta；
3. trusted checker 导入/执行 candidate verifier、generator、config、dependencies 或 tests；
4. root/path/blob/tree/tool/receipt identity 漂移、reparse、非普通文件或 PRE/POST 不一致；
5. base 不理解的 closure delta 被解释为 passed，而不是 manual-bootstrap-required；
6. bridge 试图以自己的 checker、workflow 或 candidate tests授权自己；
7. exact-head independent Review仍有 P0-P2，或 manual transition evidence未绑定 exact head/tree；
8. 相同 failure fingerprint 在因果输入未变时被 blind rerun；
9. main、PR、branch、manifest、trust revision 或 runner input发生漂移；
10. bridge merge 后没有先完成 new-main readback与 `TASK_RESTART_REQUIRED` 就继续 V10。

## 加速验收

只运行一个 bridge-focused 合同批次、一次必要的 typecheck/TCB reconciliation 和一次独立
manual bootstrap。速度不能来自少测、放宽 parser/path/identity、重复 rerun 或让 candidate
结果升级成 authority；所有复用与失效都按 exact base/head/tree/manifest/tool/receipt记录。
