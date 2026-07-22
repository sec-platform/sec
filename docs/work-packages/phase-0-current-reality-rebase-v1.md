---
schema: codex-development-work-package-v1
id: phase-0-current-reality-rebase-v1
tracking: issue-132
base: ea8d1287dd6d41ed84d198904a55906a345907ec
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v8
tasks:
  - id: phase-0-authority-and-control-planes
    owner: a0
    ownedPaths:
      - README.md
      - docs/00-文档索引与一致性规则.md
      - docs/02-工程编译器-MVP-PRD与架构稿.md
      - docs/03-MVP实施计划与路线图.md
      - docs/09-AI Runtime、任务信封与治理规范.md
      - docs/11-Workbench与可视化规范.md
      - docs/14-Engineering IR与语义事实规范.md
      - docs/architecture/brownfield-import.md
      - docs/architecture/engineering-workspace-ir.md
      - docs/architecture/sec-ts-ir-layers.md
      - docs/goals/SEC-Engineering-Workspace-Compiler.md
      - docs/governance/nexus-absorption-and-conformance.md
      - docs/governance/nexus-absorption-ledger.yaml
      - docs/governance/nexus-absorption-report.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/phase-0-current-reality-rebase-v1.md
forbiddenPaths:
  - .github/workflows/
  - AGENTS.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - scripts/
  - platform/
  - tests/
  - source/
  - project/
  - control/
acceptance:
  - "The repository contains three separate control planes: current-state records only observed facts, rolling-plan contains only the active package plus two to five candidates, and active-work-package selects exactly one canonical frozen manifest without copying its envelope."
  - "The repository Agent contract in docs 04 resolves the active selector to the existing executable docs/work-packages manifest authority instead of introducing a competing Work Package schema or path."
  - "README and docs 00, 02, 03, 09, 11, and 14 agree that Engineering IR and Semantic Mutation SM-0 through SM-3 are in main, Phase 0 is the current docs-only closure, and SM-4A is the sole next product package."
  - "The exact-main dependency cycle between ir-identity and ir-revision is recorded as a real HIGH/CRITICAL-impact blocker and an independent canonical-primitives Work Package before SM-4A; Phase 0 neither edits production code nor claims that blocker is fixed."
  - "SM-4A first exposes one additive Mutation-owned authorization ingress over existing normalization and source-owner/path-policy algorithms, then uses one shared trusted Workbench/CLI adapter for add-state-transition; the adapter owns no canonical allowlist, revision, or path resolution, and Task Envelope v2 / AI are deferred to SM-4B / SM-4C."
  - "The Goal mirror binds both upstream Markdown files by raw-byte SHA-256 and one documented combined revision, and current-state observes that revision without copying future plans."
  - "SEC-TS IR layers, Engineering Workspace IR, Brownfield Import, and Nexus absorption/conformance each have one canonical planning owner and do not claim planned types or capabilities are implemented."
  - "Evidence Ledger versus FactAssertion, canonical input snapshot versus the existing semantic loader/bundle, verification intent versus executable Gate/run evidence, and Repository/Application/Brownfield/Program module identities versus SemanticGeneratorPlan each have explicit retain/migrate/retire and single-writer boundaries."
  - "The Nexus ledger and report bind exact commit e75caa28dcbc1ffa6e893b5539f85c8177346cd3, Git tree 3a8ad6bedd56fd92db141c45ec687b75263364c2, and 1439 tracked paths while explicitly reporting census, parity, and retirement as incomplete."
  - "Issue 132, branch, PR, plans, reports, and scheduled plan-revalidation are described only as navigation/evidence and never as completion authority."
  - "No product, test, CI, import, hook, verifier trust-root, dependency, generated project, control artifact, or user-owned root-worktree change is included."
  - "Documentation health, patch whitespace, frozen Work Package parsing/ownership, and GitNexus compare scope checks pass for the exact candidate diff."
tests:
  - "phase0/yaml-strict: strict YAML parse of docs/work/current-state.yaml and docs/governance/nexus-absorption-ledger.yaml"
  - "phase0/manifest-scope: actual Work Package parser plus exact base-to-candidate changed-record ownership over all 18 paths"
  - "bun run docs:doctor"
  - "git diff --check ea8d1287dd6d41ed84d198904a55906a345907ec HEAD --"
  - "node .gitnexus/run.cjs detect-changes --repo . --scope compare --base-ref ea8d1287dd6d41ed84d198904a55906a345907ec"
---

# Phase 0 Current Reality Rebase V1

## Architectural goal

最新 `main` 已实现 canonical/validated Engineering IR、Fact Delta、Impact Propagation 与 Semantic Mutation SM-0～SM-3，但 README 与路线图仍把已完成能力或 Workbench、Task Envelope、AI 混成一个 next。B3 已建立三个分离的近期控制面，但它们仍指向已经合并的 bootstrap；仓库仍缺少长期 Goal 稳定投影以及 SEC-TS/Workspace/Brownfield/Nexus 的 canonical 规划 owner。Phase 0 的 exact-main dependency probe还证实 `ir-identity.ts → ir-revision.ts → ir-identity.ts` 是现存 import cycle；它必须进入独立后续包，不能在本 docs-only closure顺手修改 CRITICAL-impact revision primitive。

本包只修正 authority、近期执行选择与长期架构投影。它不把文档当产品完成，不实现 SM-4A，也不触碰产品/CI/import/hook/verifier trust-root。Nexus 只记录 exact baseline 与 incomplete ledger/report，不能声称 Census 或 Parity 完成。

## Prerequisite and inputs

- SEC base/main：`ea8d1287dd6d41ed84d198904a55906a345907ec`；该 squash tree 与已审查 B3 head `d07af0f6a872fd617c2bffab7d1e2d89245d0f63` 等价；
- GitHub：PR #134 已 squash merge/closed，远端临时 branch 已删除；PR #133 仍为唯一开放 Draft、0 review、0 unresolved thread、0 `REQUEST_CHANGES`，其旧 head/base、manifest digest、Scope 与 Quick evidence因 `main` 和 V1 revision推进而全部失效；唯一 open Issue 为 #132；
- B3 已在 `main` 建立 active-documentation/canonical-path owner、三个控制面的 lifecycle合同与 `ci-verification-v8` trust root；原 Phase 0 的 `docs/04` delta已被B3吸收，因此新 closure收缩为18-path docs diff，不再修改该文件、产品、测试或CI selector；
- `main@eb48eb35` 的 exact dependency Gate仅因 `ir-identity.ts → ir-revision.ts → ir-identity.ts` 失败；B3 的 34-path squash diff不触及 `platform/compiler/ir/**`，因此以“已验证 baseline + disjoint diff impact”继续确认该 cycle 仍是后续独立 blocker。对应 exact GitNexus baseline显示 `digest` CRITICAL（96 upstream / 11 direct / 11 processes）与 `normalizedArtifactTarget` HIGH（8 upstream / 4 direct）；
- Nexus committed baseline：commit `e75caa28dcbc1ffa6e893b5539f85c8177346cd3`、tree `3a8ad6bedd56fd92db141c45ec687b75263364c2`、1,439 tracked paths；相对前一观察值 `1b82ace…` 为单 parent、31-path delta，EPR 29 项与 Project Skills 11 个的 exact count 未变；
- 上游 Goal revision：`sha256:fbe08bd8dd24224b873619fa48746778eeb4357ddb5cd917d6ee45e45134f86d`，由两份 raw Markdown 的 exact digest 按仓库投影文档所述算法组合；
- 根 worktree 的用户 `AGENTS.md`、`.claude/settings.json` 与 `docs/goals/**` 改动不属于本包。

## Gate ownership and evidence

A0 是 `docs:doctor`、patch whitespace、Work Package manifest/scope、GitNexus compare 与 PR/Review/CI reconciliation 的唯一 `gate_owner`。本地 evidence keys 固定为 `phase0/yaml-strict`、`phase0/manifest-scope`、`phase0/docs-doctor-local-preflight`、`phase0/patch-whitespace` 与 `phase0/gitnexus-compare`；hosted keys 为 `sec-scope-attest-v1`、`ci-v8/quick` 与 `sec/merge-gate`。每项都绑定 resolved candidate head/base/profile，不能把同名 baseline 或 working-tree probe记为 exact-head 结果。旧 base、v6 manifest、run `29900753057` 与 `29900819819` 均不可复用；SM-3 产品 evidence 只支撑当前能力陈述，Phase 0 自身必须用新 candidate exact diff 的文档与 scope checks证明。

## Reconciliation delta and stop

每次 stop 返回 tested head/base、changed paths、authority/public delta、acceptance delta、focused results、reusable/invalidated evidence、new blocker、next seam，以及 `inspect_ms`、`implement_ms`、`focused_validation_ms`、`wait_ms`、`reconcile_ms`、`context_reload_count`、`duplicate_gate_count`。不另写叙述性进度文档。

若 base/Goal/authority/ownership、SEC/Nexus main、Review/CI 或 exact baseline 变化，停止扩写并重算；若 acceptance 与 required evidence 满足，立即冻结、提交、发布 Draft PR 并进入 integration，不增加产品实现或规划 backlog。
