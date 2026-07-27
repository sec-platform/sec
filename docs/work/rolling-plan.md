---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-28
---

# SEC 滚动近期计划

本窗口从 `main@9043b7f0e22f9437a85bae59726456eb57ceb874`、Issue #132、旧候选 #166/#169、final exact-head Review 与 Risk Evidence Review 重新计算。现包保留已经形成的审计、Skill、合同、测试和文档闭包，只根治 tracked content coverage、跨行 Agent 指令抽取和 Risk manifest raw-blob identity 三个已证实缺口；完成后再按 V19 trust epoch 进入 Development Run Kernel。

```text
Repository Audit + Risk Trust-root Closure V2
→ Development Run Kernel Shadow
→ Project Hook Activation + Compact Resume Proof
→ SM-4A Shared Adapter + CLI/Workbench Thin Transports
→ P2 Blockless Source Ownership Foundation
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if`与最终 reconciliation更新本文件。

## 当前唯一 Work Package

### repository-audit-trust-root-closure-v2

- 工程结果：保留 `sec-repository-audit`、`sec-heuristic-governance`、`sec-architecture-evolution`、17 个行为 owner、文档去重和完整 `discover-all`；为每个 exact-tree tracked entry 增加显式 content-coverage ledger。
- 审计修复：未知扩展、超大文本、tests 中的 operational comment、submodule、NUL/invalid text和已知二进制边界都有决定性覆盖结果；跨行 heading/list/fence 中的 Agent 指令不再逃逸。
- Evidence 修复：Risk与Quick/Full producer共用 captured HEAD ordinary Git blob reader；CRLF checkout和运行期间HEAD/tree漂移不能改变 manifestDigest/inputDigest；旧七项绿色记录只保留诊断价值。
- Trust boundary：candidate改变Risk producer、Agent Skill contract和test-impact trust root，不能自证；最终只允许一个single-parent head、一次fresh selected Risk、独立exact-head Review和受信base-side manual bootstrap。
- 退出：全部changed records唯一owned且forbidden交集为零；focused/typecheck/docs/audit/imports通过；fresh Risk artifact通过raw Git identity校验；merge后readback并返回`TASK_RESTART_REQUIRED`。

## 候选 Work Package

### 1. development-run-kernel-shadow-v1

- 工程结果：实现stable runId、Git common-dir状态、repository-level prompt intake、不可变capsule/event事务、phase+locks、repository fingerprint、deterministic nextTransition和crash/stale-lock tests；Hook保持shadow未启用。
- 依赖：当前审计与 Risk trust-root authority进入main并由新任务重新加载。
- 退出：无Hook条件下完成open→reconcile→transition→close模拟；跨worktree单写者、崩溃恢复和Evidence identity通过；不改变现有Quick/Risk authorization。

### 2. codex-compact-resume-activation-v1

- 工程结果：在已进入main的Kernel上启用单dispatcher Project Hooks，闭合UserPromptSubmit intake、PreCompact/PostCompact、SessionStart(compact)、PreToolUse恢复锁、PostToolUse fingerprint、retention和terminal receipt。
- 依赖：Kernel Shadow先完成并`TASK_RESTART_REQUIRED`。
- 退出：manual compact、session-only auto compact、进程重启和新session bind均保持task、authorization、phase、candidate、Evidence与nextTransition不漂移；覆盖外工具边界准确声明。

### 3. sm4a-shared-adapter-cli-workbench-v1

- 产品结果：闭合一个既有 Semantic Mutation operation 的 shared product adapter，并让 CLI 与 Workbench 成为同一 adapter 的薄 transport；不扩展operation catalog，不混入Task Envelope v2。
- 依赖：Hook Activation进入main并由新任务通过真实续跑验收。
- 退出：同一operation经CLI与Workbench产生同一canonical plan/Delta/Impact语义并走同一verification/authorization seam；transport不拥有业务规则。

### 4. p2-blockless-source-ownership-foundation

- 产品结果：从已进入main的SM-4A source-authority seam建立App/source-module/import-session的canonical Semantic Source Owner，Block不再是语义存在的前置许可证。
- 依赖：P1 shared adapter闭合；必要Nexus exact-tree Census作为独立只读Evidence lane，不抢占产品owner。
- 退出：每个writable region唯一owner，ownership迁移不伪造Entity/Fact identity，现有SM-2/SM-3 transaction与CAS/recovery authority不分叉。

## Gate、单写者与重算

- A0是本窗口全部Gate owner；相同`gate_key + tested head + profile`的未失效结果复用。
- 审计/Risk trust-root、Kernel、Hook、P1产品与P2 foundation按依赖串行；任何时刻最多一个正式active manifest。
- SEC main、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现supersede或全仓审计新决定性finding触发live resolver与全窗口重算。
