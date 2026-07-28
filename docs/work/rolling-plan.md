---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-28
---

# SEC 滚动近期计划

本窗口从 `main@2513f640c91eafbe6eaecd1d33227fbfa59da11c`、开放 Issue #132/#167、当前代码与文档控制面重新计算。当前包只修正文档权威和约束生效模型；不修改产品语义或 CI workflow。

```text
Document Authority Simplification
→ Development Run Kernel Shadow
→ Runtime Authority Closure
→ SM-4A Shared Adapter + Thin Transports
→ P2 Blockless Source Ownership
```

## 当前唯一 Work Package

### document-authority-simplification-v1

- 结果：`AGENTS.md`、`04` 与 Skill/Kernel 文档职责互斥；硬合同、授权、启发式、事实和 Evidence 分层。
- 约束修复：删除宽泛 Markdown coverage fallback；未登记 `docs/**/*.md` fail closed，并由既有 Agent governance fast test 固定。
- 状态修复：`current-state.yaml` 不再维护完整能力清单，只保存 resolver 前提和兼容 prerequisite。
- 边界：只修正既有治理合同测试；不修改 Skill 行为、test-impact trust root、docs-doctor trust root、产品实现、Workflow 或测试/CI 架构。
- 退出：focused Agent governance、docs doctor、repository audit、typecheck、imports 与 required exact-head Evidence 通过；merge 后 readback 并重新计算计划。

## 候选 Work Package

### 1. development-run-kernel-shadow-v1

- 结果：stable runId、Git common-dir 状态、不可变 capsule/event、phase/locks、repository fingerprint、deterministic nextTransition 和 crash/stale-lock tests。
- 依赖：当前文档与行为 authority 简化进入 `main`。
- 退出：无 Hook 条件下完成 open→reconcile→transition→close；跨 worktree 单写者和恢复证据闭合。

### 2. runtime-authority-node-baseline-v1

- 结果：落实 Issue #167 的 Semantic Core/runtime/toolchain/target profile 分层，闭合 Node LTS 公共 CLI baseline 与 Bun toolchain 边界。
- 依赖：重新核验当前 Node/Bun release 状态与 public CLI import graph。
- 退出：Node baseline、Bun 专有 runtime adapter、生成项目 profile 和 release validation 都有机器合同。

### 3. sm4a-shared-adapter-cli-workbench-v1

- 结果：一个既有 Semantic Mutation operation 通过 shared product adapter 被 CLI 与 Workbench 复用；transport 不拥有业务规则。
- 依赖：Kernel Shadow 与 Runtime Authority 不再改变执行/分发边界。
- 退出：两种 transport 产生相同 canonical plan/Delta/Impact 语义并共享 verification/authorization seam。

### 4. p2-blockless-source-ownership-foundation

- 结果：建立 App/source-module/import-session 的 canonical Semantic Source Owner，Block 不再是语义存在的前置许可证。
- 依赖：P1 shared adapter 闭合。
- 退出：每个 writable region 唯一 owner，迁移不伪造 Entity/Fact identity，transaction/CAS/recovery authority 不分叉。

## 重算触发

`main`、PR head/base/merge/close、CI/Review blocker、Goal revision、authority/ownership 反证、实现 supersede 或全仓审计的新决定性 finding 变化时，重新运行 resolver 并整体重算本窗口。候选不是授权；任何时刻只有 pointer 选择的一个 frozen manifest 可执行。
