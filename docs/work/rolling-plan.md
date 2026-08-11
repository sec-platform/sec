---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-11
---

# SEC 滚动近期计划

本窗口从 V10 收口后的受信 `main@7543d37ad733432cbc2ddddd205c98f574e882c4` 重新计算。
V10（`verification-action-trusted-cutover-v10`）已按 frozen manifest 合入 new main：
`Manifest-Digest: sha256:91a06d6c531efeb6a7078e07de7b5ccdf7bfec61729eddf7f2ce5e41d1bdd15b`
与 new main 字节一致，`Independent-Exact-Head-Review: P0=0 P1=0 P2=0`，
`Manual-Transition-Receipt` 与 `TCB-Trust-Revision` 绑定 exact base/head/tree；
100-path write set 与 new-main tree readback 一致。旧 Review/Gate/Evidence/Session/
bootstrap receipt 均已 stale，不能迁移到本窗口。`TASK_RESTART_REQUIRED` 由本新会话满足。

## 当前唯一 Work Package

### bootstrap-repair-348-347-v1

Bootstrap Repair Wave #348 + #347，单个隔离 candidate、一个 frozen Work
Package、两个独立 owner Task：

- Task A（Issue #348）Imports Effect-Purity Cutover：统一 pure Import
  Transform Kernel，`imports:check` 纯比较零写、`imports:transform` 显式
  有界写、freeze 仅 seal identity 并返回 typed `needs-import-transform`、
  pre-commit/pre-push 与 `check:*` 永不写 source/index、退役
  `imports:prepare`、sort-and-combine 与 remove-unused 分责、双 worktree
  index 隔离 witness；
- Task B（Issue #347）Verification Fast-Path Integrity：GitHub Review
  GraphQL `Actor.id` 查询形态修复与 typed `provider-schema-unsupported`、
  writer/reviewer/hosted-verification provider identity 分离与 availability
  epoch（quota/credits 原始文本不入工程状态、同 epoch unavailable 不重试）、
  implementation session 不能签发 independent Review receipt、#345 假
  Independent Review 路径负向回归、protected root local-main 终态
  `LOCAL_MAIN_READY | LOCAL_MAIN_SYNC_BLOCKED(reason)`、integration trailer
  只来自 validated receipt。

#207/#311 兼容性已在 exact base `7297da11b11145fa958a8ec468e98e9be4dfa351`
上由 `resolveParallelConflict` 证明为 `parallel-safe`（witness 记录于
manifest 正文）。本包完成后返回 `TASK_RESTART_REQUIRED`，等待下一
trusted-main session；不关闭 parent #321/#311，不继续 #346/#275/#349。

## 候选 Work Package

### 1. semantic-impact-failure-routing-v1

当前 bootstrap-repair-348-347-v1 完成并完成 new trusted-main readback 后，才从
then-latest main 重算；本候选不占用当前 writer，也不能进入当前写集。

### 2. feedback-scheduler-hermetic-runtime-v1

当前 bootstrap-repair-348-347-v1 完成并完成 new trusted-main readback 后，才从
then-latest main 重算；本候选不占用当前 writer，也不能进入当前写集。

### 3. compiler-incremental-toolchain-v1

当前 bootstrap-repair-348-347-v1 完成并完成 new trusted-main readback 后，才从
then-latest main 重算；本候选不占用当前 writer，也不能进入当前写集。

## 后续但暂不占 formal writer

- Issue #178 的 causal TCB 历史完成事实只作为 trusted-base manual transition 的输入；
  不能把旧 Evidence、Review 或 bootstrap receipt 复用为当前 PASS。
- Issue #327 的 repository structural convergence 继续由后续新 main 重算；当前包
  只保存其需求，不吸收其产品 delta。
- Issue #314 的 architecture maturity 与 delivery closure 继续由后续候选消费；当前包
  不取得该 Program 的 writer authority。

## 重新规划硬触发器

任一条件成立立即停止并从 then-latest main 重算：

1. main、PR、branch、manifest、trust revision、runner input 或相同 failure fingerprint
   发生未处理漂移；
2. 本包 changed path 超出 frozen ownedPaths 或命中 forbiddenPaths；
3. decision 状态机、quarantine、scope intersection 的 focused/adversarial 测试缺失或未通过；
4. 任何 Skill 正文、registry 或 applicability 代码出现第二事实源，或 Skill 试图自授权；
5. 未先完成 exact-head independent Review（P0-P2 清零）就宣称 merge-ready；
6. merge 后没有先完成 exact new-main readback 与 `TASK_RESTART_REQUIRED` 就继续
   后续 trust-epoch 或治理工作。

## 加速验收

先完成一次 decision 状态机 adversarial 批次（none-required/ambiguous/conflict/stale/
quarantine/superseded/zero-candidate），再运行一次必要的 typecheck、docs-doctor 与
控制面解析。速度不能来自少测、放宽 parser/path/identity、重复 rerun 或把
`manual-bootstrap-required` 升级成 PASS；所有复用与失效都按 exact base/head/tree/
manifest/tool/receipt 记录。
