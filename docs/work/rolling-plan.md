---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-28
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@1ff00a3883991f5eaf696d29b6d28504b96791b0`、全部本地/远端 branch census、PR/Issue/Review/CI 和 exact tree 重新计算。PR #181 的产品能力已由 successor PR #183 在 `main@f17202dd0c076279e9ab115c722a87856c1cd42f` 上恢复并进入当前 main；旧 head、旧 Review 和旧 Gate 只作为原 identity Evidence，不重复执行。

```text
Verification Feedback Loop Hardening
→ Active Documentation Corpus
→ Portable Atomic Workspace Lease
→ Remaining Runtime / Toolchain Seams
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if` 与最终 reconciliation 更新本文件。

## 当前唯一 Work Package

### development-feedback-loop-hardening-v1

- 工程结果：CI Risk 与 Quick/Full 共享唯一进程编排与 changed-record snapshot；files 只从一次 raw record capture 派生。
- 启动修复：compiler dependency generation 使用短且碰撞安全的 staging 名称，避免长 Windows worktree 扩大 native package extraction 路径。
- 行为修复：resolver executable 只信任 latest default/base，intended candidate workspace 保持独立解析目标；AGENTS 与蓝图只投影 orientation Skill，不维护第二套入口。
- 恢复边界：旧 `bfa4a535` 的 isolated code 75 已由 #183 改变根输入；其 affected FAIL 与 `CHANGES_REQUESTED` Review 保持无效证据，不原样重跑。successor 只验证新 base 与两个 P1 直接失效的最小闭包。
- 退出：single-parent candidate、focused/typecheck/docs/audit/imports、独立 exact-head Review 和受信 base bootstrap 全部闭合；本包改变 verifier、dependency bootstrap 与 Skill trust root，进入 main 后返回 `TASK_RESTART_REQUIRED`。

## 候选 Work Package

### 1. active-documentation-corpus-v1

- 工程结果：机器 registry 取代历史编号、路径 catch-all 和人工 authority 表；active prose 按自然领域原子迁移，旧正文 byte-for-byte 归档。
- 依赖：反馈环 trust epoch 进入 main 并由新任务重新加载。
- 退出：在新 base 单提交重冻；独立 Review 与 required `full` Evidence 只运行一次；merge 后再次 readback 并返回 `TASK_RESTART_REQUIRED`。

### 2. workspace-write-lease-portability-v1

- 工程结果：以 Node 标准能力实现单一 portable lease protocol，保持 no-replace 原子性、完整 owner publication、heartbeat、stale recovery、commit fence 与 deterministic errors。
- 依赖：active documentation trust epoch 进入 main；PR #174 的 protocol alias、publication durability 和 gate census 三个 P1 完成重新设计与 focused evidence。
- 退出：Windows、Linux ext4/WSL2 真实跨进程竞争与崩溃恢复通过；`bun:ffi` 不再属于 common write authority。

### 3. remaining-runtime-and-toolchain-seams-v1

- 工程结果：已证明未被前述候选吸收的 runtime/toolchain 能力按 authority DAG 继续闭合；spike 与 local-dirty snapshot 不进入 main。
- 依赖：portable lease 与全部待合正式分支完成或被准确阻塞。
- 退出：全部剩余 heads 都有进入 main、被吸收、明确禁止合并或带准确 blocker 四类之一的持久证明。

## Gate、单写者与重算

- A0 是本窗口全部 Gate owner；相同 `gate_key + tested head + profile` 的未失效结果复用。
- 上述顺序严格串行；任何时刻最多一个正式 active manifest 与一个 candidate epoch。同一 exact Gate identity 只执行一次，确定性失败在输入变化前直接复用。
- SEC main、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership 反证、实现 supersede 或全仓审计新决定性 finding 触发 live resolver 与全窗口重算。
