---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-26
---

# SEC 滚动近期计划

本窗口从 `origin/main@aa2355a80041f0cfd41563f58ce0208837c19beb`、长期 Goal revision `sha256:555a187d…f676`、PR #143/#144 合并事实、PR #137 absorbed closeout、Issue #132、hosted Quick/merge-gate、Review 与本地 ref/worktree 状态重新计算。Windows runtime/V11 与 SM-4A trusted authorization ingress 已进入 `main`，但后者不等同于 P1 完成；当前 active 只闭合 repository hygiene，随后先补 shared adapter 与 CLI/Workbench 薄 transport，再进入 P2。

```text
Root Hygiene Closeout V1 (active)
→ SM-4A Shared Adapter + CLI/Workbench Thin Transports
→ Nexus Exact-tree Census Refresh
→ P2 Blockless Source Ownership Foundation
```

本计划只有一个 active package 与三个候选。候选不是授权、完成声明或永久 Backlog；任一 reload 事件发生后必须从新事实整体重算。

## 当前唯一 Work Package

### root-hygiene-closeout-v1

- 工程结果：移除 tracked 机器专属 Claude settings permission allowlist；在 latest main 上记录 SM-4A 真实完成证据；验证 Goal/V4 与 V5 replacement 输入已被 canonical mirror/migration/governance 吸收后删除未跟踪 bytes；最终只保留 clean root `main`。
- Owner：机器专属 Claude settings permission allowlist、新 frozen manifest 与三个控制面；产品、CI、Goal、canonical architecture/docs owner 均禁止修改。
- 证据边界：首个 head `236485b` 的 hosted Quick 因退役配置路径没有 test-impact owner，在 preflight 永久 FAIL 且 0 Gate 执行；不为一次性删除增加永久 CI selector 特例。successor 只更新该事实与 manifest/pointer，由 A0 依据 exact scope、docs/lifecycle、scope attestation 与 Review 做 manual bootstrap。
- 退出：tracked PR 通过 docs/lifecycle/scope/manual-bootstrap 并进入 main；root `AGENTS.md` 与 main blob 一致；未跟踪输入删除；本地/远端仅 `main`；worktree 仅仓库根；`main...origin/main = 0/0`；无 task-local 进程或临时目录。

## 候选 Work Package

### 1. sm4a-shared-adapter-cli-workbench-v1

- 产品结果：闭合一个既有 Semantic Mutation operation 的 shared product adapter，并让 CLI 与 Workbench 成为同一 adapter 的薄 transport；不扩展 operation catalog，不混入 Task Envelope v2。
- 依赖：root hygiene 先闭合；从最新 `main` 复用唯一 trusted authorization ingress、operation registry、revision 与 pipeline authority，不创建第二 source/authorization owner。
- 退出：同一 operation 经 CLI 与 Workbench 产生同一 canonical plan/Delta/Impact 语义并走同一 verification/authorization seam；transport 不拥有业务规则，P1 剩余闭包有实现、测试与 Review 证据。

### 2. nexus-exact-tree-census-refresh

- 产品结果：启动时绑定最新 Nexus commit/tree，重算 path/mode/object、entrypoints、EPR、Skills、mechanism decisions、public/deployed surfaces 与 retirement 前置。
- 依赖：SEC root/branch hygiene 先闭合；ledger authority 保持 A0 单写者。
- 退出：classification/decision 达到 100%，unclassified/undecided 为 0；Parity 与 owner 迁移未完成前不得声称吸收完成。

### 3. p2-blockless-source-ownership-foundation

- 产品结果：从已进入 main 的 SM-4A source-authority seam 建立 App/source-module/import-session 的 canonical Semantic Source Owner，Block 不再是语义存在的前置许可证。
- 依赖：P1 shared adapter + CLI/Workbench 薄 transport 与 Nexus Census 均先闭合；再从最新 main 冻结 owner identity、writable region 与 registry read-only 边界，不得并行启动第二 writer。
- 退出：每个 writable region 唯一 owner，ownership 迁移不伪造 Entity/Fact identity，现有 SM-2/SM-3 transaction 与 CAS/recovery authority 不分叉。

## Gate、单写者与重算

- A0 是本窗口全部 Gate owner；相同 `gate_key + tested head + profile` 的未失效结果复用。
- Root hygiene、P1 剩余闭包、Nexus Census 与 P2 owner foundation 按依赖串行；任何时刻只有一个正式 active manifest。
- SEC/Nexus main 变化、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership 反证、实现 supersede 或 Census 新前置均触发 live resolver 与全窗口重算。
