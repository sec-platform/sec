---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-24
---

# SEC 滚动近期计划

本窗口从 `main@7dbcdc4`、九文件 Goal revision `sha256:555a187d…f676`、两个开放 PR #137/#139、Issue #132、CI/Review、全部 worktree/ref 与最新 GitNexus Census重新计算。PR #137 的当前快照为 Draft/conflicting；#139 只在 tree内冻结 number/base/branch tracking identity，其 bootstrap Draft/head/Gate快照随最终 refreeze失效，最终 candidate head、Review与 hosted evidence在仓库外按 exact head绑定，避免 tree自引用。PR #138 已通过 Scope、Quick、merge gate并以 tree-equal squash进入 `main`；原 V5 replacement installer已被选择性 reconciliation取代，不能再次运行。当前唯一正式包是 **Docs V5 Post-merge Reconciliation V1**。

```text
Docs V5 Post-merge Reconciliation V1 (active)
→ Runtime Canonical Line + PR #137 Reconciliation
  → SM-4A Trusted Authorization Ingress Reconciliation
  → Docs-doctor V5 Semantic Superset Bootstrap
→ Dirty Root / Legacy Roadmap Branch Reconciliation
→ Nexus Phase 0A Exact-tree Census
```

本计划只维护一个 active package 与五个候选；候选不是授权、完成声明或永久 Backlog。

## 当前唯一 Work Package

### docs-v5-postmerge-reconciliation-v1

- 结果：把已合并的 V5 文档迁移从旧候选状态收口为最新 `main`、PR/Issue、CI/Review、worktree/ref 与 evidence事实，并选择下一唯一产品闭包。
- 根因：frozen candidate不能自引用最终 squash SHA；因此 `main` 中三个控制面仍把已合并 PR #138记录为 active/open，并使用旧 base。
- Owner：`docs/work/current-state.yaml`、`rolling-plan.md`、active pointer与本 manifest；稳定 DAG、产品架构、代码、tests与 verifier trust root全部禁止修改。
- 退出：四个 changed paths唯一归属；current-state只含事实；pointer digest一致；focused active-doc tests、docs doctor、YAML、manifest scope、patch、GitNexus compare与一次 exact-head Scope/Quick通过；Review/merge-gate无阻塞；结果进入 `main` 后重算。

## 候选 Work Package

### 1. runtime-canonical-line-and-pr137-reconciliation-v1

- 产品结果：在新 `main`/Goal authority上选择唯一 runtime implementation/evidence line，吸收仍有效的 #137、local `377a487` 与 `50a5f29` 内容，删除重复 owner、probe与失效动态控制面。
- 根因：PR #137 已落后且与 V5 main在六路径重叠、四路径文本冲突；本地 successor、observability line和 `ddf5cda` alternative并非同一 ancestry，不能机械 merge或按时间选新者。
- Prerequisite：当前 post-merge control package先进入 `main`；重新冻结 base、Goal revision、manifest、owned production/test/evidence surface与 manual-bootstrap边界。
- 验证：先消费而不掩盖 `ec97412 + affected-tests + quick` 的 immutable FAIL（3 pass / 1 fail、`SEMANTIC-MUTATION-010`、`artifact-read`，该 head 的 Risk 未运行且禁止）；仍有效的 runtime unit/V10 policy与 diagnostic evidence只能分类，不能组合成 PASS。只执行一次新 identity的 precommand attribution正文；真实 repair冻结后一次 canonical affected，PASS后才允许一次 Risk。verifier trust-root变化禁止 hosted self-certification。
- 退出：唯一 canonical runtime owner进入 `main`；#137 Review/CI/冲突闭合或被准确标为 absorbed/superseded；`aa9eb30`、`7c9da6c`、`e9ef842` 三条已包含于 `50a5f29` 的 refs与 `de5f84e`、`f6dd49b` 两条已包含于 `cf0183d` 的 refs，以及经证明 tree-duplicate 的 alternative均安全清理。

### 2. sm4a-trusted-authorization-ingress-reconciliation-v1

- 产品结果：把 trusted-local policy接入既有 canonical Semantic Mutation authorization ingress，为后续 shared CLI/Workbench adapter建立唯一入口。
- 依赖：runtime canonical line先进入 `main`；对 `bca9102` 与非等价 `b753b55`按最终 blob、合同和测试比较后重放，不复用旧 exact-head证据。
- 边界：SM-2继续拥有 source adapter/path authority，SM-1继续拥有 request/plan/result revision；不混入 Task Envelope v2、AI或第二 writer。
- 退出：focused owner contract、canonical affected、适用 Risk、imports/type/docs与Review在同一最终 head闭合；被替代 branch清理。

### 3. docs-doctor-v5-semantic-superset-bootstrap-v1

- 工程结果：在保留全部 legacy diagnostics 的前提下，把 V5 owner/frontmatter/status/唯一 H1、重复 V4 authority、repo path与禁用路径 differential policy纳入一个 canonical doctor。
- 依赖：先关闭 runtime/CI revision seam，冻结新的 verifier revision与人工 bootstrap策略；不得让候选脚本使用同一 revision自证。
- 验证：legacy positive/negative fixtures、V5 differential fixtures、cross-platform bytes、manual bootstrap evidence与独立 review。
- 退出：旧诊断零回退、false-positive受控、trust-root revision进入 `main`，replacement payload中的弱 doctor永久退役。

### 4. dirty-root-and-legacy-roadmap-reconciliation-v1

- 工程结果：在不丢失用户修改的前提下审计并收敛 dirty root与 `docs/sec-product-roadmap-rebase`；把真实新增价值吸收到最新 owner，删除生成块、被 main取代的重复 bytes与完成使命的 branch/worktree。
- 范围事实：root落后五提交并含 AGENTS/settings与未跟踪 V4/V5输入；roadmap worktree含七个 tracked和两个 untracked真实修改。两者都禁止 reset/checkout式清理。
- 约束：V4 Goal与 replacement包只按 exact path/hash处理；原始输入的物理删除与 Git authority migration分批；`.claude/settings.json`删除必须先确认其当前 owner与意图。
- 退出：每项 dirty byte都有 adopt/archive/retire裁决；无第二文档 authority；root可安全更新；branch/worktree只在内容已进入 `main`或明确退役后清理。

### 5. nexus-phase-0a-exact-tree-census

- 产品结果：绑定 exact Nexus commit/tree，物化完整 path/mode/object inventory，追踪 entrypoints、EPR 29/29、Skills 11/11、mechanism decisions、public/deployed surfaces与 retirement前置。
- 执行方式：只读采集可并行；ledger写入、authority决策与 parity/retirement仍由 A0串行。Census不能成为第二 formal active package。
- 退出：tracked path classification与 mechanism decision为100%，unclassified/undecided为0并生成 deterministic manifest；这仍不证明 accepted parity或 retirement完成。

## 单写者、Gate 与整体重算

- 同一时刻只有一个 formal active package。Goal/roadmap、runtime owner、authorization owner、verifier revision与 Nexus ledger按依赖串行冻结。
- 每个 Gate只有一个 `gate_owner`；相同 `gate_key + tested head + profile` 的未失效结果必须复用，历史 FAIL/diagnostic不能包装成 PASS。
- 任一 merge/close、相关 SEC/Nexus `main`变化、新 CI/Review blocker、architecture/authority反证、实现 supersede、Nexus Census新前置或长期 Goal更新后，先刷新 current-state，再整体重算本窗口。
