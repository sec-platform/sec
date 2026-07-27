---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-27
---

# SEC 滚动近期计划

本窗口从 `main@3f0df59e31e0bf5c39c5ce774c2abb8ccbfbb1df`、长期 Goal revision `sha256:555a187d…f676`、Issue #132 与最新仓库事实重新计算。当前包先把整个仓库的启发式行为和全部 Markdown 纳入 Agent Skills coverage，并按用户最新决定正式退役 Graph-It-Live 与 GitNexus MCP入口；随后按 V19 的 trust epoch顺序落地可验证续跑，再恢复产品主线。

```text
Agent Skills and V19 Alignment V2
→ Development Run Kernel Shadow
→ Project Hook Activation + Compact Resume Proof
→ SM-4A Shared Adapter + CLI/Workbench Thin Transports
→ Nexus Exact-tree Census Refresh
→ P2 Blockless Source Ownership Foundation
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if`与最终 reconciliation更新本文件。

## 当前唯一 Work Package

### agent-skills-and-v19-alignment-v2

- 工程结果：建立十四个标准 AgentOperation Skill；机器分类全部 tracked Markdown和已知启发式运行面；新增Skill/Kernel canonical authority；修复控制面；退役`.mcp.json`、`gitnexus:mcp`和`cleanup-mcp.ps1`，保留GitNexus analyze/status与Graphify CLI。
- Owner：Agent Skills、Skill coverage contract、AGENTS短投影、文档权威图、focused合同、package MCP入口退役、当前 Work Package与两控制面；不实现Kernel、Hook或产品编译器。
- Trust boundary：`package.json`、`platform/shared/agent-skill-contract.ts`与`platform/shared/test-impact-rules/governance.ts`命中toolchain/verifier trust root，candidate不得自证；采用独立 exact-head Review与受信 base-side manual bootstrap。
- 退出：全部实际changed records唯一owned；十四Skill标准章节通过；全Markdown分类和启发式表面覆盖为零遗漏；MCP入口与残留脚本退役；V19 marker与pointer digest通过；focused/typecheck/docs/imports和mandatory selected Risk完成；merge后readback并返回`TASK_RESTART_REQUIRED`。

## 候选 Work Package

### 1. development-run-kernel-shadow-v1

- 工程结果：实现stable runId、Git common-dir状态、repo-level prompt intake、不可变capsule/event事务、phase+locks、repository fingerprint、deterministic nextTransition和crash/stale-lock tests；Hook保持shadow未启用。
- 依赖：当前Skill/V19 authority进入main并由新任务重新加载。
- 退出：无Hook条件下完成open→reconcile→transition→close模拟；跨worktree单写者、崩溃恢复和Evidence identity通过；不改变现有Quick/Risk authorization。

### 2. codex-compact-resume-activation-v1

- 工程结果：在已进入main的Kernel上启用单dispatcher Project Hooks，闭合UserPromptSubmit intake、PreCompact/PostCompact、SessionStart(compact)、PreToolUse恢复锁、PostToolUse fingerprint、retention和terminal receipt。
- 依赖：Kernel Shadow先完成并`TASK_RESTART_REQUIRED`。
- 退出：manual compact、session-only auto compact、进程重启和新session bind均保持task、authorization、phase、candidate、Evidence与nextTransition不漂移；覆盖外工具边界准确声明。

### 3. sm4a-shared-adapter-cli-workbench-v1

- 产品结果：闭合一个既有 Semantic Mutation operation 的 shared product adapter，并让 CLI 与 Workbench 成为同一 adapter 的薄 transport；不扩展operation catalog，不混入Task Envelope v2。
- 依赖：Hook Activation进入main并由新任务通过真实续跑验收。
- 退出：同一operation经CLI与Workbench产生同一canonical plan/Delta/Impact语义并走同一verification/authorization seam；transport不拥有业务规则。

### 4. nexus-exact-tree-census-refresh

- 产品结果：绑定最新Nexus commit/tree，重算path/mode/object、entrypoints、EPR、Skills、mechanism decisions、public/deployed surfaces与retirement前置。
- 依赖：P1产品闭包先完成；ledger authority保持A0单写者。
- 退出：classification/decision达到100%，unclassified/undecided为0；Parity与owner迁移未完成前不得声称吸收完成。

### 5. p2-blockless-source-ownership-foundation

- 产品结果：从已进入main的SM-4A source-authority seam建立App/source-module/import-session的canonical Semantic Source Owner，Block不再是语义存在的前置许可证。
- 依赖：P1 shared adapter与Nexus Census均先闭合。
- 退出：每个writable region唯一owner，ownership迁移不伪造Entity/Fact identity，现有SM-2/SM-3 transaction与CAS/recovery authority不分叉。

## Gate、单写者与重算

- A0是本窗口全部Gate owner；相同`gate_key + tested head + profile`的未失效结果复用。
- Skill/V19治理、Kernel、Hook、P1产品、Nexus Census与P2 foundation按依赖串行；任何时刻最多一个正式active manifest。
- SEC/Nexus main变化、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现supersede或Census新前置触发live resolver与全窗口重算。
