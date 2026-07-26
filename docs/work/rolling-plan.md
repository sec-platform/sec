---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-26
---

# SEC 滚动近期计划

本窗口从`origin/main@4ef0d38f726ce38d931ea66e859d20214469c69e`、九文件Goal revision `sha256:555a187d…f676`、live resolver、开放Draft PR #137、Issue #132、retained worktree custody和最新exact-head Gate重新计算。`a62f568`因heavy-gate TCB seam缺失永久FAIL；`6f7904c`因Windows dependency publish重复`EPERM`永久FAIL；`eb437f6`因no-spawn test sentinel污染进程级环境永久FAIL。`1699931`的canonical affected真实PASS，但其唯一Risk在2.1秒preflight fail-closed：新增heavy-gate外层入口是顶层`platform/dev-runner.ts`，而mandatory selector只覆盖`platform/dev-runner/`目录，导致`changed-files-unresolved`；Contract Freeze、slow与workspace Gate均未启动。该head永久FAIL且不重跑。当前最小successor只把顶层CLI与子目录归入同一个bounded Risk owner并冻结正反合同；它必须重新获得exact-head affected、一次Risk、Review与main集成。#142已squash merge，PR #137仍位于旧base且冲突，不能提供完成授权。

```text
Windows Browser Launch Path Authority V1 (active)
→ SM-4A Trusted Authorization Ingress Reconciliation
→ Dirty Root / Branch / Worktree Reconciliation
→ Nexus Exact-tree Census Refresh
```

本计划只有一个active package与三个候选。候选不是授权、完成声明或永久Backlog；任一reload事件发生后必须从新事实整体重算。

## 当前唯一 Work Package

### windows-browser-launch-path-authority-v1

- 产品结果：保留`3a72882`重建的唯一runtime/V11 authority，把Windows文件系统可访问路径与Win32可启动路径拆成两个显式合同；由`runtime-dependency-spec`精确绑定全部direct runtime package，由`project-runtime`唯一证明Playwright三包、external Node、physical cache和registry-derived executable，并以有界identity-preserving Windows rename原语发布/回滚compiler dependency generation；isolated plan只消费opaque authority；父级固定proof由staged runner在真实Playwright pre-spawn边界重验；isolated Next服务由SEC verifier直接拥有；affected/Risk由同一worktree heavy-gate owner串行化。
- 根因：`\\?\`解决文件系统寻址但不能保证Chromium从超长module path读取ICU/resources；323字符staged executable失败，同一物理cache的160字符projection成功。后续修复又揭示Playwright teardown不拥有可用的Windows关闭权、test timeout早于production supervisor、project input digest把runtime stamp与Next生成文件误当authoring input。四个边界现分别由launch projection、SEC-owned direct child、deadline-derived budget与canonical derived-output classification拥有。
- Owner：runtime dependency spec、project-runtime唯一publish/browser owner、runtime plan materialization、Windows launch projection、child fixed environment/lifecycle、对应tests、docs/05和三个动态控制面；Engineering IR、process executor、其他installer、hooks、Goal/governance与历史evidence禁止修改。
- 退出：全部direct package exact identity、Playwright cache/executable authority、Windows publish retry/rollback、projection正反/cleanup/target-swap、POSIX plan/materialization、真实Playwright pre-spawn no-spawn、production port ownership/readiness、heavy-gate互斥、proof micro-sentinel、repaired SM-3 sentinel、type/import/docs/control/scope、最终successor exact-head canonical affected真实PASS、其后一次Risk、独立Review与V11人工bootstrap闭合；successor进入main后#137准确标为absorbed并关闭。

## 候选 Work Package

### 1. sm4a-trusted-authorization-ingress-reconciliation-v1

- 产品结果：从retained SM-4A line与runtime successor进入后的最新main重放唯一五路径产品/测试delta，重新证明一个trusted local Workbench/CLI ingress，只覆盖既有`add-state-transition`纵向闭包。
- 依赖：runtime successor先合并；只复用`platform/compiler/index.ts`、source adapter registry、trusted ingress与两份对应测试，不带回旧V9控制面或文档。
- 退出：一个shared adapter进入canonical SM-3 transaction，CLI/Workbench保持薄transport，无第二authorization/source writer，真实合同与集成Gate通过；随后旧SM-4A branch才可删除。

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
- Windows launch/runtime/V11 trust root、dirty ref reconciliation、Nexus ledger与SM-4A按依赖串行；只读审查不能创建第二formal package。
- SEC/Nexus main变化、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现supersede或Census新前置均触发live resolver与全窗口重算。
