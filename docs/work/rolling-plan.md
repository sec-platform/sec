---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-28
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@f17202dd0c076279e9ab115c722a87856c1cd42f`、全部本地/远端 branch census、open PR、exact-head Review 与 hosted Evidence 重算。merge-gate changed-record identity bootstrap 已进入 `main`；现在先把 PR #181 的独有产品 tree 在新 base 上恢复为 successor 单提交候选，不改写旧 frozen head，也不重复旧 Gate。

```text
Isolated Runtime Bundle Layout
→ Verification Feedback Loop Hardening
→ Active Documentation Corpus
→ Portable Atomic Workspace Lease
→ Remaining Runtime / Toolchain Seams
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if`与最终 reconciliation更新本文件。

## 当前唯一 Work Package

### isolated-runtime-bundle-layout-v1

- 工程结果：compiler isolated child 的 bundle、resource 与 dependency root 共享 canonical runtime inventory。
- 根因：official registry 和 dependency relocation 仍保留 source-shape 假设，导致标准 bundle lookup 与 TypeScript 标准库定位失败。
- 唯一机制：package root、core、runtime assets 与 dependency root 共同构成标准 bundle profile；resource destination 和 dependency relative URL 都从 canonical runtime identity 派生。
- 恢复边界：旧 PR #181、head `023693b` 及其 Gate 只保留为旧 identity Evidence；successor 在 `main@f17202d` 上单提交重冻。产品 blob 未变化的 focused/local Risk 复用，不重复执行；新 exact identity 只允许一次 Scope、一次 Quick及其 selected Risk和一次独立 Review。
- 退出：新 exact identity 的 ownership、控制面、Review、hosted Evidence 与 main readback全部闭合。

## 候选 Work Package

### 1. development-feedback-loop-hardening-v1

- 工程结果：CI changed paths只采集一次 raw records，trusted resolver preflight在 AGENTS、蓝图与 orientation Skill 一致 fail closed。
- 依赖：isolated runtime进入`main`后重冻；旧`bfa4a53`的 deterministic affected失败和Review P1保持无效证据，不得原样重跑。
- 退出：两个P1和focused缺口闭合，trust-root manual bootstrap进入新`main`。

### 2. active-documentation-corpus-v1

- 工程结果：active中文文档权威与当前代码、Goal、测试和CI保持一致。
- 依赖：反馈环trust epoch进入`main`。
- 退出：在新base单提交重冻，独立Review与required `full` Evidence只运行一次。

### 3. workspace-write-lease-portability-v1

- 工程结果：以 Node 标准能力实现单一 portable lease protocol，保持 no-replace 原子性、完整 owner publication、heartbeat、stale recovery、commit fence 与 deterministic errors。
- 依赖：PR #174 的protocol alias、publication durability和gate census三个P1完成重新设计与focused evidence。
- 退出：Windows、Linux ext4/WSL2 的真实跨进程竞争与崩溃恢复通过；`bun:ffi` 不再属于 common write authority，可留在显式 Bun/verification adapter。

### 4. remaining-runtime-and-toolchain-seams-v1

- 工程结果：已证明未被前述候选吸收的runtime/toolchain能力按现有authority DAG继续闭合；spike与local-dirty snapshot不进入`main`。
- 依赖：portable lease与全部待合正式分支完成或被准确阻塞。
- 退出：所有剩余heads都有进入`main`、被吸收、明确禁止合并或带准确blocker四类之一的持久证明。

## Gate、单写者与重算

- A0是本窗口全部Gate owner；相同`gate_key + tested head + profile`的未失效结果复用。
- 上述顺序严格串行；任何时刻最多一个正式active manifest与一个candidate epoch。同一exact Gate identity只执行一次，确定性失败在输入变化前直接复用。
- SEC main、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现supersede或全仓审计新决定性finding触发live resolver与全窗口重算。
