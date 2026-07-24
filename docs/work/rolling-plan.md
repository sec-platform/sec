---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-24
---

# SEC 滚动近期计划

本窗口从`origin/main@4ef0d38f726ce38d931ea66e859d20214469c69e`、九文件Goal revision `sha256:555a187d…f676`、live resolver、开放Draft PR #137、Issue #132、外部exact-head Review/CI、retained worktree custody与GitNexus impact重新计算。#142已squash merge，V5 docs-doctor semantic superset与V10 trust root已进入main；上一manifest在live default branch解析为`none`。PR #137仍位于旧base且冲突，只有失败merge-gate，不能提供完成或验证授权。

```text
Runtime Canonical Line + PR #137 Reconciliation V1 (active)
→ Dirty Root / Branch / Worktree Reconciliation
→ Nexus Exact-tree Census Refresh
→ SM-4A Trusted Authorization Ingress Reconciliation
```

本计划只有一个active package与三个候选。候选不是授权、完成声明或永久Backlog；任一reload事件发生后必须从新事实整体重算。

## 当前唯一 Work Package

### runtime-canonical-line-and-pr137-reconciliation-v1

- 产品结果：在新main上重建唯一 runtime dependency/Node/browser/staging/verification authority，消除旧分支竞争实现与Playwright dependency/browser revision漂移。
- 根因：旧runtime线从V9/V10前的base长期分叉；range dependency允许generated runtime与已物化browser cache使用不同revision，历史局部PASS又不能组合为affected PASS。
- Owner：runtime dependency identity/lifecycle、staged plan、isolated child、verification/telemetry/process-isolation、对应tests、canonical docs、V11 V1 trust root与三个动态控制面；Engineering IR、process executor、hooks、Goal/governance与历史evidence禁止修改。
- 退出：focused owner contracts、type/import/docs/control/scope、最终exact-head canonical affected真实PASS、其后一次Risk、独立Review与V11人工bootstrap闭合；successor进入main后#137准确标为absorbed并关闭。

## 候选 Work Package

### 1. dirty-root-and-branch-reconciliation-v1

- 工程结果：逐项裁决dirty root、上游Goal/replacement inputs、legacy roadmap、local branches与retained worktrees；有价值内容进入canonical owner，证明无独有内容后才删除。
- 约束：不得reset/checkout覆盖用户bytes，不用0/0或branch名证明可删；每个ref按tree/diff/PR/consumer判断adopt/archive/retire。
- 退出：root可安全快进；完成使命的local/remote branch与worktree物理清理；只保留仍有未合并价值的ref。

### 2. nexus-exact-tree-census-refresh

- 产品结果：在启动时绑定最新Nexus commit/tree，重算path/mode/object、entrypoints、EPR、Skills、mechanism decisions、public/deployed surfaces与retirement前置。
- 依赖：不预先冻结未来baseline；ledger authority保持A0单写者。
- 退出：classification/decision达到100%，unclassified/undecided为0；六维Parity与owner迁移未完成前不得声称吸收完成。

### 3. sm4a-trusted-authorization-ingress-reconciliation-v1

- 产品结果：从retained SM-4A line与最新main重新证明一个trusted local Workbench/CLI ingress，只覆盖既有`add-state-transition`纵向闭包。
- 依赖：runtime与dirty-root reconciliation合并后重新计算authority、revision、测试与branch custody；旧V9 branch不提供完成证明。
- 退出：一个shared adapter进入canonical SM-3 transaction，CLI/Workbench保持薄transport，无第二authorization/source writer，真实合同与集成Gate通过。

## Gate、单写者与重算

- A0是本窗口全部Gate owner；相同`gate_key + tested head + profile`的未失效结果复用。Contract Freeze统一拥有其登记测试，不逐项重复执行。
- Runtime/V11 trust root、dirty ref reconciliation、Nexus ledger与SM-4A按依赖串行；只读审查不能创建第二formal package。
- SEC/Nexus main变化、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现supersede或Census新前置均触发live resolver与全窗口重算。
