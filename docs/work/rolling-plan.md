---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-28
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@a2f4463ab94c12346134a46ee3ae0ff4a16082a8`、唯一开放 PR #174、待整合分支 census、exact-base 退出码 `75` 复现和当前源码重算。`runtime-authority-and-package-layout-v1` 已进入 `main`，但隔离物化仍使用伪 source 形状；必须先修复这个主干回归，才能恢复反馈闭环候选的 affected Evidence。Node Host、Bun Toolchain 与生成 Target 仍是三条独立轴。

```text
Isolated Runtime Bundle Layout Repair
→ Development Feedback Loop Hardening
→ Active Documentation Corpus
→ Portable Atomic Workspace Lease
→ Common Node Host + Bun Toolchain Separation
→ Generated Node/Bun Target Profiles
→ Optional Native Capability Adapters
→ Cross-host Determinism + Release Matrix
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if`与最终 reconciliation更新本文件。

## 当前唯一 Work Package

### isolated-runtime-bundle-layout-v1

- 根因：首次 candidate 修复 core 和 asset destination 后仍有两处旧 source-shape 假设：official registry 被写到 package root 下，依赖 relocation 的 `../../node_modules` 又从新 core `dist/index.js` 指向 staging root；前者产生 `MANIFEST-SCHEMA-004`，修复后后者使 TypeScript 标准库缺失。
- 唯一机制：package root、core、runtime assets 与 dependency root 共同构成标准 bundle profile；resource destination 消费 `SEMANTIC_MUTATION_ISOLATED_COMPILER_RESOURCE_DESTINATIONS`，dependency relative URL 从 runner core 与 compiler deps 两个 canonical identity 计算。
- 边界：这是 `STOP_PROOF_RESET` 后的 redesign；保留 staging 的物化与 diagnostic bundle 已分别裁决 registry 和 dependency lookup，不修改通用 resolver、cache identity，也不引入 cwd/env/祖先搜索/全局注册。
- 退出：registry 与 dependency relocation 的最小 sentinel 红转绿后，只重跑被本次 delta 失效的 focused/typecheck/docs/audit/imports/affected；独立 Review、hosted Gate 和 main readback 全部绑定新 exact head。

## 候选 Work Package

### 1. development-feedback-loop-hardening-v1

- 工程结果：把已在本地 `bfa4a5350a6de46a56239d2a4837efe2353d0525` 冻结的反馈闭环候选重放到新 `main`，只保留 formal manifest 已接受的 19-file delta。
- 已证实根治项：test-impact 必须覆盖 `semantic-mutation-isolated-runtime-plan.ts` 的直接 consumer `semantic-mutation-runtime-materialization.test.ts`；worktree bootstrap 必须复用或原子生成 exact compiler dependency/browser cache，不能让相同 lockfile 的嵌套依赖缺项和重复网络安装阻塞每个新 worktree。
- 依赖：本包修复进入 `main`；旧 affected code `75` Evidence 失效。
- 退出：trust-root bootstrap、独立 exact-head Review、hosted Gate 与 main readback完成，并返回 `TASK_RESTART_REQUIRED`。

### 2. active-documentation-corpus-v1

- 工程结果：整合 `docs/active-corpus-authority-v1` 中仍有效的 active corpus authority，拒绝已被 supersede 的旧文档简化分支。
- 依赖：反馈闭环 trust-root 进入新 `main` 后新任务重算。
- 退出：active Markdown、Skill coverage、链接、frontmatter、docs doctor 与 trust-root bootstrap闭合。

### 3. workspace-write-lease-portability-v1

- 工程结果：重算 PR #174 的三个 P1，统一 immutable publication outcome、crash alias recovery 与 shared read-only v2 census。
- 依赖：前两个 trust-root 包进入 `main`；旧 `STOP_PROOF_RESET_3` candidate 不复用。
- 退出：真实 crash boundary 回归、focused/typecheck、独立 Review 与 hosted Gate通过。

### 4. common-node-host-and-toolchain-separation-v1

- 工程结果：默认公共 CLI 静态图不加载 Bun host API；Bun executable 由独立 Toolchain authority 解析。
- 依赖：portable lease 已进入 `main`。
- 退出：Node 22/24 clean-package read/write smoke 与 Bun common-bundle smoke 各自通过。

### 5. generated-node-bun-target-profiles-v1

- 工程结果：canonical Target Runtime Profile 驱动 scripts、types、dependencies、lock/container lowering。
- 依赖：common Node host 与 Toolchain 分离已闭合。
- 退出：Node/Bun target capability 均由唯一 profile 约束；后续 optional adapter 与 cross-host release matrix 再接管。

## Gate、单写者与重算

- A0是本窗口全部Gate owner；相同`gate_key + tested head + profile`的未失效结果复用。
- 上述 active→5 严格串行；任何时刻最多一个正式 active manifest，单一纵向切片默认不创建子 Agent。
- SEC main、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现supersede或全仓审计新决定性finding触发live resolver与全窗口重算。
