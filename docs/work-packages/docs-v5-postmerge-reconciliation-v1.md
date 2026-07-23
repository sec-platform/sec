---
schema: codex-development-work-package-v1
id: docs-v5-postmerge-reconciliation-v1
tracking: none
base: 7dbcdc4349348b4f0af446df548af3083ad7d43d
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v9
tasks:
  - id: postmerge-control-plane-reconciliation
    owner: a0
    ownedPaths:
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/docs-v5-postmerge-reconciliation-v1.md
forbiddenPaths:
  - .github/
  - .githooks/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/00-文档索引与一致性规则.md
  - docs/01-用户能力模块化开发-主题整理稿.md
  - docs/02-工程编译器-MVP-PRD与架构稿.md
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/05-编译器核心实现规格.md
  - docs/06-Registry与Block协议规范.md
  - docs/07-Pass状态机、错误码与恢复机制.md
  - docs/08-Verification、Provenance与Graph规范.md
  - docs/09-AI Runtime、任务信封与治理规范.md
  - docs/10-升级迁移与Override规范.md
  - docs/11-Workbench与可视化规范.md
  - docs/12-编译管道与行为流图示.md
  - docs/13-独立工具分发与打包规划.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/architecture/
  - docs/archive/
  - docs/evidence/
  - docs/goals/
  - docs/governance/
  - docs/scripts/
  - docs/superpowers/
  - docs/work/README.md
  - platform/
  - scripts/
  - source/
  - project/
  - control/
  - tests/
acceptance:
  - "The control plane is recomputed from origin/main@7dbcdc4349348b4f0af446df548af3083ad7d43d, tree c2019e0547be2871dae8195ec59a39a214593043, the nine-file Goal revision sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676, current Git worktrees/refs, and live GitHub PR/Issue/CI/Review facts."
  - "PR #138 is recorded as merged, its source head 260aa6c57991b40e225b5d8a35b5a3b7500b5d07 is tree-equal to the squash commit, and the completed V5 package is no longer selected as active work."
  - "The original replacement package is recorded as an audited, unsafe, superseded input; it is not executed, copied into the candidate, promoted to a second documentation authority, or represented as a reusable installer."
  - "current-state contains observed facts only: open Draft/conflicting PR #137, this package's stable PR #139 number/base/branch tracking identity, an explicitly invalidated bootstrap snapshot, one open navigation Issue #132, exact non-self-referential local/remote heads, explicit external exact-head/review/CI binding for this candidate, dirty-worktree protection, reusable/invalidated evidence, and current blockers. It contains no candidate acceptance or future Gate plan, and no acceptance condition depends on PR #139 remaining Draft."
  - "rolling-plan selects this one bounded closeout plus two to five candidates derived from current dependencies; it does not copy the stable P0-P12 DAG or grow a permanent backlog."
  - "The active pointer selects exactly this manifest by path and raw-byte digest; the manifest is the only complete execution envelope."
  - "The next runtime package is not executed until this closeout enters main and a new main/Goal/PR/branch reconciliation chooses one canonical successor among PR #137, local 377a487, local 50a5f29, and tree-duplicate ddf5cda."
  - "The exact candidate changes only the four owned paths, contains no production, verifier trust-root, replacement-source, historical evidence, user-root, generated, probe, or artifact drift, and passes the selected documentation, manifest, YAML, patch, GitNexus and hosted Quick gates."
tests:
  - "active-documentation-focused: bun test tests/unit/active-documentation-contract.test.ts tests/contract/test-impact.test.ts tests/integration/project-runtime.test.ts --timeout 180000"
  - "docs-doctor: bun run docs:doctor"
  - "manifest-contract: parse this frozen manifest with scripts/codex/work-package-contract.ts and attest the full base-to-candidate changed records have exactly one owner and no forbidden path"
  - "yaml-parse: parse docs/work/current-state.yaml and this manifest frontmatter with the repository YAML dependency"
  - "patch-whitespace: git diff --check 7dbcdc4349348b4f0af446df548af3083ad7d43d --"
  - "gitnexus-compare: detect_changes compare against main after the final candidate is frozen"
  - "hosted: one exact-head Scope followed by one exact-head Quick; no Full or standalone Risk"
---

# Docs V5 Post-merge Reconciliation V1

## Architectural goal

把已通过 PR #138 进入 `main` 的 V5 文档 authority 迁移从“冻结候选状态”收口为最新动态事实，并从新 `main` 重新选择近期执行顺序。本包不再修改稳定路线、产品架构、代码、测试或 verifier；它只关闭候选无法在自身 tree 中记录最终 squash SHA 所造成的 post-merge 控制面失效。

## Context Capsule

- Base/head/branch/PR：`origin/main@7dbcdc4349348b4f0af446df548af3083ad7d43d` / candidate head 未冻结且只由外部 exact-head evidence绑定 / `codex/docs-v5-postmerge-reconciliation-v1` / #139。
- Goal revision：九份用户 V4 Markdown 的 combined revision 为 `sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676`；仓库镜像为 `docs/goals/SEC-Engineering-Workspace-Compiler.md`。
- Replacement input：原 manifest digest 为 `dfebcd615422f7d70fea68537cf4e9c82cd0d81e4ac401fd1c8aaf333890e9c2`，132/132 条目 byte/hash 自洽但 installer 生命周期与语义均 NO-GO；`main@7dbcdc4` 已包含选择性 reconciliation，禁止再次机械覆盖。
- GitHub：开放 PR #137 为 Draft、conflicting，remote head `cf0183d495fbc8223fb8e216393f7f20867e653a`，0 Review/thread/`REQUEST_CHANGES`，无 Scope/Quick；PR #139 只以 number/base `7dbcdc4`/branch作为本包稳定 tracking identity，bootstrap Draft/head/Review/Gate观察已明确标为随最终 refreeze失效，最终 lifecycle由外部 exact-head evidence绑定；唯一开放 Issue #132 只作导航。
- Local candidates：#137 本地 successor `377a4876160e860a39898ae2851f6f7c2c175b5d`、observability line `50a5f29618a4c456e41f46803474e2ed7d069ca2`、tree-duplicate alternative `ddf5cdadb4a4ca130b85822d92dbae9c2fa714c1`、SM-4A candidates 与 dirty roadmap/root worktrees全部保持隔离。
- `gate_owner`：A0 独占本包所有 Gate。PR #138 的 final Quick 只作为 tree-equal baseline；本包四路径变化使文档/affected/Scope evidence失效并在最终 head 上各执行一次。

## Ownership and dependency

四个 owned paths 构成一个不可拆的控制面闭包：manifest 定义范围，pointer 选择 manifest，current-state记录事实，rolling-plan从事实选择下一项。稳定 DAG仍由 `docs/03-MVP实施计划与路线图.md` 独占；产品与代码 authority不在本包范围。

PR #137、runtime candidates、SM-4A、docs-doctor trust root、Nexus Census 与 dirty root/roadmap reconciliation都只是后继候选，不能在本包内执行。任何 user-root 输入、dirty worktree bytes 或旧 branch都不得通过复制、reset、checkout或 installer混入候选。

## Stop, reload and reconciliation

以下任一条件触发停止并从最新事实重算：`origin/main`、Goal九文件集合或 digest变化；PR #137 state/head/base/Review/CI变化；PR #139 的稳定 number/base/branch identity变化，或 planned refreeze/Ready/Scope/Quick/merge-gate lifecycle之外出现新的 Review/CI blocker；第三个开放 PR或新的 Issue出现；任何 owned path需要扩大到稳定 authority、production、test或 verifier trust root；changed records不再恰好由本 manifest唯一拥有；GitNexus Census发现新的前置条件。

完成前必须返回 tested base/head、四个 changed paths、authority/acceptance delta、focused/hosted results、可复用与失效 evidence、blocker、next ready seam，以及 `inspect_ms`、`implement_ms`、`focused_validation_ms`、`wait_ms`、`reconcile_ms`、`context_reload_count` 与 `duplicate_gate_count`。只有 merge 后的新 `main` 与适用证据能证明本包完成。
