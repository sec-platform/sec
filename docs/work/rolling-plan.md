---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-24
---

# SEC 滚动近期计划

本窗口从`origin/main@4dbfc3fe0dcbae5c24ca6f80ac339ae065d1222e`、九文件Goal revision `sha256:555a187d…f676`、live resolver、开放Draft PR #137、Issue #132、外部exact-head Review/CI、V5 replacement审计、docs-doctor differential输出与GitNexus impact重新计算。#141已squash merge且source tree与main tree相同；上一manifest在live default branch解析为`none`。Draft #137位于旧base、冲突且proposal V10未进入main，不能预留revision或提供本包证据。

```text
Docs-doctor V5 Semantic Superset Bootstrap V1 (active)
→ Runtime Canonical Line + PR #137 Reconciliation
→ Dirty Root / Branch / Worktree Reconciliation
→ Nexus Exact-tree Census Refresh
```

本计划只有一个active package与三个候选。候选不是授权、完成声明或永久Backlog；任一reload事件发生后必须从新事实整体重算。

## 当前唯一 Work Package

### docs-doctor-v5-semantic-superset-bootstrap-v1

- 工程结果：把legacy与V5文档诊断统一为结构化scanner；八个historical/future-output假阳性归零；三控制面共享canonical parser；V1 trust root从v9人工bootstrap到v10。
- 根因：replacement scanner会回退legacy诊断，main scanner又把frozen Work Package identifier当current link；scanner本身缺少直接negative/differential Contract Freeze owner。
- Owner：doctor policy/CLI、control-plane rolling parser、doctor Contract Freeze target、V10 V1 revision/artifact namespace及三个动态控制面；product/runtime/Goal/replacement source禁止修改。
- 退出：Windows+POSIX合同、完整Contract Freeze、V10 focused、control lifecycle、typecheck/imports/affected、real docs doctor、scope/diff/GitNexus与双独立Review闭合；candidate不运行hosted self-verification，人工bootstrap后进入main。

## 候选 Work Package

### 1. runtime-canonical-line-and-pr137-reconciliation-v1

- 产品结果：从新main与所有retained runtime worktree bytes选择一个canonical implementation/evidence line，解决Draft #137冲突、immutable affected failure与V10被本包占用后的revision迁移。
- 依赖：本包先合并；重新读取#137 head/base/Review/CI、六个冲突面、local-only integration heads与真实runtime test evidence。
- 退出：一个runtime owner进入main，失败根因有最小复现与Gate；#137被合并或准确标为absorbed/superseded，不保留第二实现。

### 2. dirty-root-and-branch-reconciliation-v1

- 工程结果：逐项裁决dirty root、上游Goal/replacement inputs、legacy roadmap、local branches与retained worktrees；有价值内容进入canonical owner，证明无独有内容后才删除。
- 约束：不得reset/checkout覆盖用户bytes，不用0/0或branch名证明可删；每个ref按tree/diff/PR/consumer判断adopt/archive/retire。
- 退出：root可安全快进；完成使命的local/remote branch与worktree物理清理；只保留仍有未合并价值的ref。

### 3. nexus-exact-tree-census-refresh

- 产品结果：在启动时绑定最新Nexus commit/tree，重算path/mode/object、entrypoints、EPR、Skills、mechanism decisions、public/deployed surfaces与retirement前置。
- 依赖：不预先冻结未来baseline；ledger authority保持A0单写者。
- 退出：classification/decision达到100%，unclassified/undecided为0；六维Parity与owner迁移未完成前不得声称吸收完成。

## Gate、单写者与重算

- A0是本窗口全部Gate owner；相同`gate_key + tested head + profile`的未失效结果复用。Contract Freeze统一拥有其登记测试，不逐项重复执行。
- Doctor trust root、runtime owner、dirty ref reconciliation与Nexus ledger按依赖串行；只读审查不能创建第二formal package。
- SEC/Nexus main变化、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现supersede或Census新前置均触发live resolver与全窗口重算。
