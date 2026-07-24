---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-23
---

# SEC 滚动近期计划

本窗口由 `bun scripts/codex/document-control-plane.ts status --json` 的 live resolved current-state、九文件 Goal revision `sha256:555a187d…f676`、代码/测试、隔离 worktree 与 GitNexus radar重新计算。原 V5 replacement 包仅作为已审计输入，不能机械执行。active pointer在 candidate digest尚未进入 live default branch时选择 **Docs Control-plane Publication Lifecycle V1**；同一 digest进入 default branch后自动解析为`none`并触发下一轮重算。

```text
Docs Control-plane Publication Lifecycle V1 (active)
→ Docs Authority Content Normalization V1
  → Docs-doctor V5 Semantic Superset Bootstrap V1
→ Runtime Canonical Line + PR #137 Reconciliation
→ Dirty Root / Branch / Worktree Reconciliation
→ Nexus Exact-tree Census Refresh
```

本计划只维护一个条件 active package 与五个候选；候选不是授权、完成声明或永久 Backlog。resolved main/PR/Issue/CI/Review、Goal、authority或前置发生变化后必须整体重算，不能追加一个同义 post-merge closeout。

## 当前条件选择的唯一 Work Package

### docs-control-plane-publication-lifecycle-v1

- 结果：消除 versioned control plane 对自身最终 commit/PR/merge identity 的依赖，让 active selector在 manifest digest进入 default branch后确定性解析为 `none`，并对 stale snapshot fail-closed。
- 根因：#138 合并后创建 #139 更新旧 SHA；#139 合并后同一问题再次出现。候选无法在自身 Git tree 内记录未来 squash identity，继续提交 closeout会无限递归。
- Owner：`docs/04-AI自主实现执行蓝图.md`、三个 `docs/work` 控制面、本 manifest与一个最小 lifecycle contract test。
- 退出：current-state只含 resolver 配置与稳定事实；不记录当前候选 self lifecycle；pointer使用 Git blob bytes SHA-256；merged/stale/CRLF负例受测试约束；focused tests、docs doctor、manifest/YAML/patch、GitNexus、Review、exact-head Scope与 verifier trust-root人工 bootstrap闭合。`scripts/codex/`候选不得用自身 Quick 结果自证。

## 候选 Work Package

### 1. docs-authority-content-normalization-v1

- 工程结果：把 `AGENTS.md` 收敛为短 projection，产品主链只保留一个 canonical owner，把旧 SHA/PR/run evidence移出 active CI authority，修复两个不存在的 template provenance path，并明确 Nexus ledger已因 source revision变化失效。
- 依赖：本 control-plane lifecycle先进入 `main`，随后从新 main重新冻结 owner、消费者与 test surface。
- 边界：不修改 docs doctor/verifier trust root，不借文档整理声称产品能力完成。

### 2. docs-doctor-v5-semantic-superset-bootstrap-v1

- 工程结果：在保留 legacy diagnostics 的前提下，把 canonical existence、唯一 H1、frontmatter/status、V4 differential、Unicode/path与三个控制面 lifecycle纳入一个 doctor。
- 依赖：authority normalization先冻结 stable owner；verifier trust-root变化使用人工 bootstrap，不由候选自证。
- 退出：legacy与V5正负 fixture、跨平台 bytes、manual bootstrap evidence和独立 Review全部闭合。

### 3. runtime-canonical-line-and-pr137-reconciliation-v1

- 产品结果：以新 `main` 为单一 base，在保存现有 dirty/staged证据的前提下选择唯一 runtime implementation/evidence line，修复 #137 的冲突与 immutable affected failure，吸收或准确 supersede旧 PR。
- 依赖：前三个文档治理包完成或证明与 runtime surface无交集；重新冻结 production/test/evidence owner。
- 退出：单一 canonical runtime owner进入 `main`；#137 CI/Review/冲突闭合或被准确关闭；被包含或替代的 runtime refs/worktrees有内容证明后清理。

### 4. dirty-root-and-branch-reconciliation-v1

- 工程结果：逐字节裁决 dirty root、legacy roadmap、已包含 local branches与 retained worktrees；有价值内容迁入 canonical owner，已被 `main` 吸收或明确退役的内容才物理清理。
- 约束：不得 reset/checkout覆盖用户修改；原 goals/replacement输入只有在 canonical吸收、审计记录与 hash证明完成后才可移除。
- 退出：每项 dirty byte都有 adopt/archive/retire结果；root可安全快进；本地远程只保留仍有未合并价值的 ref。

### 5. nexus-exact-tree-census-refresh

- 产品结果：绑定最新 Nexus commit/tree，重算 path/mode/object inventory、entrypoints、EPR 29/29、Skills、mechanism decisions、public/deployed surfaces和 retirement前置。
- 执行方式：只读采集可并行；ledger authority写入与 parity/retirement仍由 A0串行，Census不能成为第二 active package。
- 退出：tracked path classification与 mechanism decision为100%、unclassified/undecided为0；这仍不证明 accepted parity或 retirement完成。

## 单写者、Gate 与整体重算

- 同一时刻只有一个 formal active package；文档 authority、doctor trust root、runtime owner与 Nexus ledger按依赖串行冻结。
- 每个 Gate只有一个 `gate_owner`；相同 `gate_key + tested head + profile` 的未失效结果必须复用，历史 FAIL/diagnostic不能包装成 PASS。
- 任一 merge/close、相关 SEC/Nexus `main`变化、新 CI/Review blocker、architecture/authority反证、实现 supersede、Nexus Census新前置或长期 Goal更新后，先运行时刷新 current-state，再整体重算本窗口。
