---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-27
---

# SEC 滚动近期计划

本窗口从 `main@9043b7f0e22f9437a85bae59726456eb57ceb874`、长期 Goal、Issue #132、当前无开放PR的GitHub事实和全仓审计重新计算。现包先修复 Skill coverage 只覆盖“已知路径”的定义缺口，把全部 tracked paths、候选启发式行为和跨 owner 架构演进纳入独立执行闭包，并清除文档、测试和脚本中的重复行为 authority；完成后再按V19 trust epoch进入Development Run Kernel。

```text
Repository Audit / Heuristic Extraction / Architecture Skill V1
→ Development Run Kernel Shadow
→ Project Hook Activation + Compact Resume Proof
→ SM-4A Shared Adapter + CLI/Workbench Thin Transports
→ P2 Blockless Source Ownership Foundation
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if`与最终 reconciliation更新本文件。

## 当前唯一 Work Package

### repository-audit-skill-v1

- 工程结果：新增 `sec-repository-audit`、`sec-heuristic-governance`、`sec-architecture-evolution`；17个Skill与17个repository behavior一一绑定；提供 `audit:repository` tracked-path审计器；把`docs/04`收缩为稳定协议与Skill路由；归档已完成旧manifest。
- 审计修复：消除agent-skill合同中的第二路径白名单、已删除MCP/report路径的死test owner、`discover-all`的platform-only/500条截断、sandbox dependency第二authority和`docs/05`损坏路径。
- Trust boundary：`package.json`、Agent Skill contract、test-impact ownership和合同测试均属于toolchain/verifier trust root；candidate不得自证，必须独立exact-head Review与受信base-side manual bootstrap。
- 退出：全部changed records唯一owned；17 Skill标准章节和行为owner闭合；全tracked-path audit无critical/high finding；docs doctor、focused tests、typecheck、imports和mandatory selected Risk完成；merge后readback并返回`TASK_RESTART_REQUIRED`。

## 候选 Work Package

### 1. development-run-kernel-shadow-v1

- 工程结果：实现stable runId、Git common-dir状态、repository-level prompt intake、不可变capsule/event事务、phase+locks、repository fingerprint、deterministic nextTransition和crash/stale-lock tests；Hook保持shadow未启用。
- 依赖：当前审计/Skill authority进入main并由新任务重新加载。
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
- 审计/Skill治理、Kernel、Hook、P1产品与P2 foundation按依赖串行；任何时刻最多一个正式active manifest。
- SEC main、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现supersede或全仓审计新决定性finding触发live resolver与全窗口重算。
