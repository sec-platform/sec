---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-26
---

# SEC 滚动近期计划

本窗口从 `origin/main@f1df074b8080b97882ff2afd3b1a110ce42512c4`、长期 Goal revision `sha256:555a187d…f676`、PR #137/#143/#144/#145、scope attestation `30197172677`、永久 Quick FAIL `30196624646`、exact-head Review、Issue #132 与本地 ref/worktree 状态重新计算。Windows runtime/V11、SM-4A trusted authorization ingress 与 root hygiene 已进入 `main`；trusted ingress 不等同于 P1 完成。

```text
Root Hygiene Postmerge Reconciliation V1 (仅在 pointer 选中候选时 active)
→ publication 后 active pointer = none
→ SM-4A Shared Adapter + CLI/Workbench Thin Transports (next-ready)
→ Nexus Exact-tree Census Refresh
→ P2 Blockless Source Ownership Foundation
```

本计划在候选发布前只有一个 resolver-selected active package；同一 manifest blob 进入 default branch 后 resolver 返回 `none`，只保留三个 next-ready 候选。候选不是授权、完成声明或永久 Backlog；任一 reload 事件发生后必须从新事实整体重算。

## 当前唯一 Work Package

### root-hygiene-postmerge-reconciliation-v1

- 工程结果：只发布 PR #145 已进入 `main@f1df074`、旧输入已物理退役、P1 尚余 shared adapter + CLI/Workbench 薄 transport 等已经发生的事实。
- Owner：新 frozen manifest 与三个控制面；产品、CI、Goal、canonical architecture/docs owner 均禁止修改。
- 选择语义：candidate manifest 尚未出现在 live default branch 时它是唯一 active；相同 blob 发布后 resolver 返回 `none`，本节不再代表活动授权。
- 退出：docs/lifecycle/scope/Review 通过并进入 main；随后本地/远端只保留 `main`，worktree 只保留仓库根，`main...origin/main = 0/0`。

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
- Postmerge publication、P1 剩余闭包、Nexus Census 与 P2 owner foundation 按依赖串行；任何时刻最多只有一个正式 active manifest。
- SEC/Nexus main 变化、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership 反证、实现 supersede 或 Census 新前置均触发 live resolver 与全窗口重算。
