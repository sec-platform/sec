---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-28
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@2513f640c91eafbe6eaecd1d33227fbfa59da11c`、Issue #167、关闭且未合并的 Spike #168、exact-tree 全仓审计和当前源码重算。Node Host、Bun Toolchain 与生成 Target 是三条独立轴；任何阶段都不得用 Bun 下的 `target: node`、类型声明或文档替代真实 Node clean-package 运行证据。

```text
Runtime Authority + Package Layout
→ Portable Atomic Workspace Lease
→ Common Node Host + Bun Toolchain Separation
→ Generated Node/Bun Target Profiles
→ Optional Native Capability Adapters
→ Cross-host Determinism + Release Matrix
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if`与最终 reconciliation更新本文件。

## 当前唯一 Work Package

### runtime-authority-and-package-layout-v1

- 工程结果：`13` 成为唯一 active 中文 runtime/package authority；公共类型分开 Host、Toolchain、Target 与 Evidence；源码和 bundle 共享一个 fail-closed package/runtime layout resolver。
- 当前 Bun 合法边界：Bun 1.3.14 继续拥有 repository install/test/build 和显式 Bun Toolchain 表面；本包不清除合法 Bun adapter，也不修改生成目标。
- Node 边界：2026-07-28 官方 schedule 仍支持 minimum Node 22 / reference Node 24 的后续验证选择，但本包没有 Node 支持声明。
- Trust boundary：`paths.ts` 已属于 verifier trust root；`runtime-layout.ts` 必须登记为 canonical trust file并同步两个 workflow 投影。candidate hosted Gate按设计返回`manual-bootstrap-required`，只允许trusted-base Evidence、独立exact-head Review与admin/manual integration。
- Review reload：首个 frozen head 的独立 Review 发现 compose/emit templates 与 isolated runtime input 仍从 package root 定位；该 P1 使旧 Review 和旧 manifest digest 失效，并触发本包唯一一次 refreeze。
- Proof reset：第二个 frozen head 仍存在 registry/policy/template relative identity 与 isolated staging destination 的竞争定义，已按 `STOP_PROOF_RESET` 停止旧证明。重算后的机制由一个 inventory 同时派生 native relative path、POSIX identity、source/bundle absolute root 与 isolated destination；Workbench catalog 也必须从 package runtime assets 读取，不得从 caller workspace 猜测。
- 退出：布局在 source 与 `dist/index.js` 模式下有负例合同；official registry/policy、compose templates 与 local-view templates 全部从 asset root 解析并由 builder 的同一资源清单复制；全部 changed records 唯一 owned；base-side parser/TCB、focused/typecheck/docs/audit/imports与独立Review满足；手工集成并readback后返回`TASK_RESTART_REQUIRED`。

## 候选 Work Package

### 1. workspace-write-lease-portability-v1

- 工程结果：以 Node 标准能力实现单一 portable lease protocol，保持 no-replace 原子性、完整 owner publication、heartbeat、stale recovery、commit fence 与 deterministic errors。
- 依赖：当前 runtime/package authority 进入 `main` 并 readback。
- 退出：Windows、Linux ext4/WSL2 的真实跨进程竞争与崩溃恢复通过；`bun:ffi` 不再属于 common write authority，可留在显式 Bun/verification adapter。

### 2. common-node-host-and-toolchain-separation-v1

- 工程结果：默认公共 CLI 静态图不加载 Bun host API；Workbench HTTP/process host 使用共同 lifecycle owner；Bun executable 由独立 Toolchain authority 解析。
- 依赖：portable lease 已进入 `main`。
- 退出：`process.execPath` 不再被当作 Bun Toolchain；Node 22/24 clean-package read/write smoke 与 Bun common-bundle smoke 各自通过。

### 3. generated-node-bun-target-profiles-v1

- 工程结果：生成目标以 canonical Target Runtime Profile 驱动 scripts、types、dependencies、lock/container lowering；package manager 与 runtime family 分轴。
- 依赖：common Node host 与 Toolchain 分离已闭合。
- 退出：Node target 无 Bun API/types/lock/container 假设；Bun target 只在声明 capability 后使用 Bun API。

### 4. optional-native-capability-adapters-v1

- 工程结果：Windows filesystem/AppContainer、native helper、development Gate mutex 与其他 host capability 全部进入显式 adapter/capability 边界。
- 依赖：公共 Node/Bun host 与 generated target profile 已真实存在。
- 退出：optional native 能力缺失只产生可行动 capability error，不阻断 common CLI load。

### 5. cross-host-determinism-and-release-matrix-v1

- 工程结果：Node/Bun 同 target 的 canonical outputs 共享唯一 canonicalizer；host path/version/platform/timing 只进入非 canonical Evidence；publication 改为 clean build/pack/install/smoke。
- 依赖：前五个 runtime seam 全部进入 `main`。
- 退出：Node 22/24、Bun、clean npm-compatible install、package surface/resources、Windows launcher、license 与 cross-host determinism 通过；只有本包允许声明 public Node baseline fully supported。

## Gate、单写者与重算

- A0是本窗口全部Gate owner；相同`gate_key + tested head + profile`的未失效结果复用。
- A→F 严格串行；任何时刻最多一个正式 active manifest，单一纵向切片默认不创建子 Agent。
- SEC main、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现supersede或全仓审计新决定性finding触发live resolver与全窗口重算。
