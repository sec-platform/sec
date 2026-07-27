---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-27
---

# SEC 滚动近期计划

本窗口从 `main@3f0df59e31e0bf5c39c5ce774c2abb8ccbfbb1df`、长期 Goal revision `sha256:555a187d…f676`、Issue #132 与最新仓库事实重新计算。直接写入 main 的 Agent Skills提交没有 PR、Review或CI，并使 active pointer指向已归档 manifest、删除受 repository-runtime合同保护的`.mcp.json`；本包先恢复执行控制面和技能治理，再继续产品主线。

```text
Agent Skills Hardening V1
→ publication 后 active pointer resolver = none
→ SM-4A Shared Adapter + CLI/Workbench Thin Transports
→ Nexus Exact-tree Census Refresh
→ P2 Blockless Source Ownership Foundation
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if`与最终 reconciliation更新本文件。

## 当前唯一 Work Package

### agent-skills-hardening-v1

- 工程结果：把四个不合规范且含危险命令的 Skill重建为严格 Agent Skills投影；恢复`.mcp.json`；以实际仓库合同测试锁定 Skill identity、触发边界、dispatch payload、merge前置条件、Work Package轮换、Worker验证和 test-impact owner。
- Owner：仅 Agent Skill、AGENTS短投影、governance test-impact声明、focused合同、当前 Work Package与两个控制面；不修改产品编译器、CI workflow、docs-doctor实现或完整开发运行 Kernel。
- Trust boundary：`platform/shared/test-impact-rules/governance.ts`属于 verifier trust root，candidate不得自证；采用独立 exact-head Review与受信 base-side manual bootstrap。
- 退出：16个 changed path全部唯一 owned；Skill严格 identity与危险命令负例通过；repository docs零 error；`.mcp.json`合同恢复；typecheck、docs、imports与focused tests通过；merge后 main readback和任务分支清理完成。

## 候选 Work Package

### 1. sm4a-shared-adapter-cli-workbench-v1

- 产品结果：闭合一个既有 Semantic Mutation operation 的 shared product adapter，并让 CLI 与 Workbench 成为同一 adapter 的薄 transport；不扩展 operation catalog，不混入 Task Envelope v2。
- 依赖：Agent Skills治理与控制面先闭合；从最新 `main`复用唯一 trusted authorization ingress、operation registry、revision与pipeline authority。
- 退出：同一 operation经 CLI与Workbench产生同一 canonical plan/Delta/Impact语义并走同一 verification/authorization seam；transport不拥有业务规则。

### 2. nexus-exact-tree-census-refresh

- 产品结果：启动时绑定最新 Nexus commit/tree，重算 path/mode/object、entrypoints、EPR、Skills、mechanism decisions、public/deployed surfaces与retirement前置。
- 依赖：SEC Skill/control-plane修复与P1产品闭包先完成；ledger authority保持A0单写者。
- 退出：classification/decision达到100%，unclassified/undecided为0；Parity与owner迁移未完成前不得声称吸收完成。

### 3. p2-blockless-source-ownership-foundation

- 产品结果：从已进入 main 的 SM-4A source-authority seam建立 App/source-module/import-session的canonical Semantic Source Owner，Block不再是语义存在的前置许可证。
- 依赖：P1 shared adapter + CLI/Workbench薄transport与Nexus Census均先闭合。
- 退出：每个 writable region唯一 owner，ownership迁移不伪造Entity/Fact identity，现有SM-2/SM-3 transaction与CAS/recovery authority不分叉。

## Gate、单写者与重算

- A0是本窗口全部 Gate owner；相同 `gate_key + tested head + profile`的未失效结果复用。
- 当前治理修复、P1产品闭包、Nexus Census与P2 foundation按依赖串行；任何时刻最多一个正式active manifest。
- SEC/Nexus main变化、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现supersede或Census新前置触发live resolver与全窗口重算。
