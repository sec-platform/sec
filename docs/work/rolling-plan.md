---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-28
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@a2f4463ab94c12346134a46ee3ae0ff4a16082a8`、全部本地/远端 branch census、open PR、exact-head Review 与 hosted Evidence 重算。目标是把仍有独有且合法的能力按依赖进入 `main`；spike、保存快照、已吸收候选和带 P1/失败 Gate 的 head 只保留证据或先修复，不机械合并。

```text
Merge Gate Changed Record Identity Bootstrap
→ Isolated Runtime Bundle Layout
→ Verification Feedback Loop Hardening
→ Active Documentation Corpus
→ Portable Atomic Workspace Lease
→ Remaining Runtime / Toolchain Seams
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if`与最终 reconciliation更新本文件。

## 当前唯一 Work Package

### merge-gate-changed-record-identity-v1

- 工程结果：base-side merge gate 对 changed records 按值比较，不再把 JavaScript 属性插入顺序误认为 Git 身份差异。
- 根因：GitHub API 产生 `{status,path,previousPath}`，exact Git parser 产生 `{status,previousPath,path}`；当前 canonicalizer 只排序数组，`JSON.stringify` 因字段顺序不同误拒绝 PR #181。
- 最小边界：只修改 `scripts/codex/merge-gate.ts` 与其 contract regression；不改 workflow、API observation、Evidence、revision、Gate plan 或产品代码。
- Trust boundary：候选修改 verifier trust root，禁止 candidate 自证和重复 hosted Quick；只允许 trusted-base focused/TCB、独立 exact-head Review与manual bootstrap。
- 退出：单提交direct-child candidate的focused/typecheck/docs/audit/imports与base-side TCB closure满足；手工集成并readback后返回`TASK_RESTART_REQUIRED`。

## 候选 Work Package

### 1. isolated-runtime-bundle-layout-v1

- 工程结果：compiler isolated child 的 bundle、resource 与 dependency root 共享 canonical runtime inventory。
- 依赖：changed-record identity bootstrap进入新`main`。
- 退出：PR #181 的旧 Scope/Quick保留为产品树诊断证据；bootstrap使base/head/manifest identity变化后，重冻一个新单提交并对新exact identity各执行一次Scope/Quick与独立Review，不运行重复local Risk。

### 2. development-feedback-loop-hardening-v1

- 工程结果：CI changed paths只采集一次raw records，trusted resolver preflight在AGENTS、蓝图与orientation Skill一致fail closed。
- 依赖：isolated runtime进入`main`后重冻；旧`bfa4a53`的deterministic affected失败和Review P1保持无效证据，不得原样重跑。
- 退出：两个P1和focused缺口闭合，trust-root manual bootstrap进入新`main`。

### 3. active-documentation-corpus-v1

- 工程结果：active中文文档权威与当前代码、Goal、测试和CI保持一致。
- 依赖：反馈环trust epoch进入`main`。
- 退出：在新base单提交重冻，独立Review与required `full` Evidence只运行一次。

### 4. workspace-write-lease-portability-v1

- 工程结果：以 Node 标准能力实现单一 portable lease protocol，保持 no-replace 原子性、完整 owner publication、heartbeat、stale recovery、commit fence 与 deterministic errors。
- 依赖：PR #174 的protocol alias、publication durability和gate census三个P1完成重新设计与focused evidence。
- 退出：Windows、Linux ext4/WSL2 的真实跨进程竞争与崩溃恢复通过；`bun:ffi` 不再属于 common write authority，可留在显式 Bun/verification adapter。

### 5. remaining-runtime-and-toolchain-seams-v1

- 工程结果：已证明未被前述候选吸收的runtime/toolchain能力按现有authority DAG继续闭合；spike与local-dirty snapshot不进入`main`。
- 依赖：portable lease与全部待合正式分支完成或被准确阻塞。
- 退出：所有剩余heads都有进入`main`、被吸收、明确禁止合并或带准确blocker四类之一的持久证明。

## Gate、单写者与重算

- A0是本窗口全部Gate owner；相同`gate_key + tested head + profile`的未失效结果复用。
- 上述顺序严格串行；任何时刻最多一个正式active manifest与一个candidate epoch。同一exact Gate identity只执行一次，确定性失败在输入变化前直接复用。
- SEC main、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现supersede或全仓审计新决定性finding触发live resolver与全窗口重算。
