---
schema: codex-development-work-package-v1
id: workflow-provider-decisions-20261001
tracking: none
base: f389347ecd68002537ac6781f6209bb69cd97e1b
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: record-workflow-provider-adoption-and-rejection-boundaries
    owner: implementation-supply-and-design-decisions
    ownedPaths:
      - docs/架构/实现供给与替换.md
      - docs/决策/设计理由-约束与演进.md
      - docs/依据/来源/构建分发与迁移.md
      - .documentation/source-manifest.json
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/document-control-roles-20261001.md
      - config/repository/work-packages/workflow-provider-decisions-20261001.md
forbiddenPaths:
  - AGENTS.md
  - LICENSE
  - LICENSES/
  - README.md
  - bun.lock
  - package.json
  - .github/
  - .agents/
  - .codex/
  - config/external-capabilities/
  - src/
  - tests/
  - crates/
acceptance:
  - This external-maintainer documentation proposal issues no active Work, Gate, health, adoption or automatic integration authority
  - Preserve narrow local orchestration and qualified native process, Git and existing provider responsibilities without introducing a unified execution framework
  - Record why Nx is not the default task execution layer, when Temporal durable execution may be reconsidered and why Dagger remains a conditional materialization alternative
  - Keep cache computation, environment materialization, current authorization, evidence applicability and physical settlement as distinct owner responsibilities
  - Preserve cancellation, started-work settlement, bounded resources, unknown external effects, single-writer migration and recoverable asset retention obligations
  - Record primary-source support, version limits, costs and reopening conditions at the existing architecture, decision and source owners without claiming installation or measured benefit
  - Preserve the unchanged external capability ledger and all runtime, workflow and issue retirement candidates without declaring them adopted or deleted
  - Reuse valid documentation and design checks, refresh only the changed source inventory and recheck the exact corrected Dagger source wording
  - Complete canonical proposal freeze and commit, independent exact-head control review, authorized branch publication and remote readback while root owns main adoption
  - Do not invoke trust-root migration PRE for this prose-only change, rerun product tests, install dependencies or modify Rust
# Existing control-boundary reference; no unchanged runtime test is newly selected.
tests:
  - tests/contract/document-control-plane-lifecycle.test.ts
---

# Preserve workflow framework adoption and rejection reasons

Record the established choices and their reopening conditions in the existing
implementation-supply, design-decision and primary-source owners. The external
capability ledger, provider routing, runtime and existing retirement candidates
are unchanged. Framework capability does not confer SEC authority or completion.
