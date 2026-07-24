---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-24
---

# SEC 滚动近期计划

本窗口从 `origin/main@2065492f55bab75f65cf124c048fc6b849be73f9`、九文件 Goal revision `sha256:555a187d…f676`、live resolver、开放PR identity #137/#141、Issue #132、外部exact-head Review/CI状态、V5 replacement审计、文档引用图、docs-doctor输出与 Nexus freshness反证重新计算。#141创建后的全窗口重算未改变DAG或候选顺序；PR的Draft/merge/head/Review/CI不在计划中复制，由live resolver持续提供。上一 manifest 已在 live default branch解析为`none`，本 pointer现只选择 **Docs Authority Content Normalization V1**。

```text
Docs Authority Content Normalization V1 (active)
→ Docs-doctor V5 Semantic Superset Bootstrap V1
→ Runtime Canonical Line + PR #137 Reconciliation
→ Dirty Root / Branch / Worktree Reconciliation
→ Nexus Exact-tree Census Refresh
```

本计划只有一个 active package与四个候选。候选不是授权、完成声明或永久 Backlog；任一 reload事件发生后必须从新事实整体重算。

## 当前唯一 Work Package

### docs-authority-content-normalization-v1

- 结果：将 `AGENTS.md` 收敛为短投影；产品主链只由`02`拥有；active CI authority不再累积历史 SHA/PR/run；两个不存在的 template path改为可验证 provenance；Nexus ledger显式标记 source-revision invalidation。
- 根因：V5选择性迁移保留了latest-main代码事实，但仍把 stable policy、历史 evidence与外部 source input path混在 active owner中；Nexus记录值已被 live default branch的117-path delta失效。
- Gate反馈：首次exact-head Quick通过，但base-side Gate发现历史archive被Git识别为`C099`、GitHub API识别为`added`；archive必须以可逆引用快照保留base原文并消除copy identity，禁止修改verifier trust root来放宽一致性。
- Owner：文档权威图、Agent projection、执行/CI policy、Goal mirror、Provider/Nexus ledgers与三个控制面；产品、tests、CI verifier和runtime均禁止修改。
- 退出：旧CI全文进入 historical archive；active docs无旧 run ledger或第二产品主链；ledger provenance不依赖不存在路径；Nexus current coverage不再冒充fresh；focused docs/control/CI-path contracts、docs doctor、YAML、patch、GitNexus与exact-head Review闭合。

## 候选 Work Package

### 1. docs-doctor-v5-semantic-superset-bootstrap-v1

- 工程结果：保留现有 file URI、广义 repo path与deprecated-token诊断，同时加入 required owner、唯一H1、frontmatter/status、禁用V4实体、Unicode/path、historical/future-output语义与三个控制面 lifecycle检查。
- 依赖：本包先冻结 active/historical owner边界；`docs/scripts/docs-doctor.ts`属于 verifier trust root，必须使用新 revision与人工 bootstrap，不由candidate自证。
- 退出：legacy+V5 positive/negative/differential fixtures跨平台通过，当前8个warning被按真实语义归零而非删除历史记录或加宽排除。

### 2. runtime-canonical-line-and-pr137-reconciliation-v1

- 产品结果：从届时新`main`选择唯一 runtime implementation/evidence line，解决 Draft #137 的冲突与 immutable affected failure，吸收或准确 supersede其他本地候选。
- 依赖：文档与doctor trust-root包完成；重新读取 #137 head/base/Review/CI及所有 runtime worktree bytes。
- 退出：一个 canonical runtime owner进入`main`，失败根因有最小复现与Gate，#137被合并或准确关闭，替代分支不再保留第二实现。

### 3. dirty-root-and-branch-reconciliation-v1

- 工程结果：逐项裁决用户 dirty root、上游 Goal/replacement inputs、legacy roadmap、已包含branches与retained worktrees；有价值内容进入 canonical owner，确认无独有内容后才删除。
- 约束：不得 reset/checkout覆盖用户 bytes，不用0/0或branch名证明可删；每个ref按 tree/diff/PR/consumer判断 adopt/archive/retire。
- 退出：root可安全快进；完成使命的local/remote branch与worktree物理清理；只保留仍有未合并价值的ref。

### 4. nexus-exact-tree-census-refresh

- 产品结果：在启动时绑定最新 Nexus commit/tree，重算path/mode/object、entrypoints、EPR 29/29、Skills、mechanism decisions、public/deployed surfaces与retirement前置。
- 依赖：当前`bc2c3b3…`仅是 freshness反证，不预先冻结未来 baseline；ledger authority写入保持A0单写者。
- 退出：classification/decision达到100%，unclassified/undecided为0；未完成六维Parity与owner迁移前仍不得声称吸收完成。

## Gate、单写者与重算

- A0是本窗口全部Gate owner；相同 `gate_key + tested head + profile` 的未失效结果复用，历史archive只能提供线索。
- 文档authority、doctor trust root、runtime owner与Nexus ledger按依赖串行；只读审计不能创建第二formal package。
- 任一 SEC/Nexus `main`变化、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现supersede或Census新前置均触发 live resolver与全窗口重算。
