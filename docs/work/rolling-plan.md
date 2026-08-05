---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-05
---

# SEC 滚动近期计划

本窗口从 `main@4b27555b` 重算。PR #278 与直接提交 `4b27555b` 的代码结果已经进入主干，
但两个 default-branch transition 都缺少完整 Work Package、独立 Review 和 successful
`sec/merge-gate`；旧 #273/#274/#276 exact heads 因此全部失效。当前继续只允许一个
formal writer，并按文档收缩 → generated-state → Skill applicability 的真实依赖顺序收口。

## 当前唯一 Work Package

### active-documentation-corpus-convergence-v2

- Issue #235 / PR #273；从 `main@4b27555b` 单提交重建，不复用旧 head 的 Review、CI 或授权。
- registry v2 为 active proposal 绑定 disposition、canonical target、Evidence、
  activation/reversal 和唯一不可物化 retirement tombstone。
- 全 tracked 文档 fail closed：未登记 active 文档、重复 owner、失效投影、tracked
  archive、Evidence/Superpowers 叙事 Markdown 和终态 proposal 残留均阻断。
- `docs/README.md` 只由 registry byte-exact 生成；CRLF-only drift 也失败。
- 历史由 Git、PR、Issue、Actions 承担；真实字节消费者迁入显式 `tests/fixtures/`。
- 主干 canonical primitives 与去冗余结果被保留并成为本包所有新排序/对象判定的唯一 owner。

## 有序后继 Work Package

### 1. generated-state-lifecycle-v1

- Issue #271 / PR #274；必须在 #273 进入新 `main` 并 readback 后，基于该新主干重建。
- 保留其 closed `.tmp/**` registry、writer census、cleanup transaction、settlement 和 TCB
  结果；旧 `a73c0fe5` base/head/Review/Evidence 不得复用。
- 重建时不得恢复 #273 已删除的 archive、旧 active manifest 或重复文档控制面。

### 2. skill-applicability-gate-v1

- Issue #275 / PR #276；必须在重建后的 #274 进入新 `main` 后再重建。
- 保留 bounded Skill guidance、exact applicability decision 和 candidate guidance quarantine；
  不得继续以旧 #274 branch 为 base。
- AGENTS、Skills、governance 与 test-impact 属于 trust-root family，必须独立 Review/bootstrap。

## 候选 Work Package

### 1. merge-authority-hardening-v1

- Issue #279；统一 default-branch transition authority、ruleset readback、post-merge
  provenance audit、admin bypass incident 与 repair/revert PR 入口。
- `.github/`、merge workflow 和 branch protection 属于独立 trust-root family，不能塞入
  #235/#271/#275 自证。

### 2. parallel-resolver-correctness-v1-1

- Issue #207；修正 `requires`、`orderedAfter`、`conflictsWith`、
  authority/path/resource/global-writer 语义并建立 exact-base Integration Epoch Registry。
- `unresolved` 永不授权并行；全部有序后继完成 new-main readback 前继续单写者。

### 3. public-publisher-network-removal-v1

- Issue #247；删除危险网络写入口，禁止 live-worktree copy、替代历史和 force-push publication。

## 全任务保全与环境边界

- `unclassified task = 0`、`task without owner = 0`、
  `task existing only in historical prose/chat = 0` 是完成条件。
- #192 保留 Node/Bun × Windows/Linux runtime/library physical matrix；缺少 Linux physical Evidence 时 cell 只能是 `not-run/unresolved`。
- #193 保留 Dependency Boundaries、成熟轮子采用、Provider 隔离和旧依赖退役。
- #194 保留最新主干 cold/warm benchmark、增量图、资源治理和 clean/incremental parity。
- R4–R16、Verification、Impact、Mutation、Brownfield、Release、Security、Workbench
  继续由 canonical roadmap 和 owning Issues 追踪，不复制进近期计划。

## Gate、单写者与重算

- #235 是当前唯一 formal writer；#274/#276 保持 Draft，不得并行写入控制面。
- required checks：registry parser、corpus census、ownership closure、byte-exact
  docs-doctor、control-plane、test-impact、strict typecheck、repository audit 和独立 Review。
- 任一 `main` 变化、exact-head 变化、CI/Review 阻塞或 authority 假设变化都会使旧 Evidence 失效。
- 合并后从新 `main` 读回 registry/index/control-plane；不得创建 post-merge pointer 修补提交。
