---
schema: codex-development-work-package-v1
id: verification-artifact-claim-summary-v1
tracking: issue-217
base: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: verification-artifact-claim-summary
    owner: verification-artifact-contract-worker
    ownedPaths:
      - platform/shared/verification-artifact-contract.ts
      - tests/unit/verification-artifact-claim-summary.test.ts
      - docs/work/active-work-package.md
      - docs/work-packages/verification-artifact-claim-summary-v1.md
      - docs/work-packages/affected-selection-trust-boundary-v1.md
      - docs/archive/work-packages/affected-selection-trust-boundary-v1.md
forbiddenPaths:
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - AGENTS.md
  - README.md
  - platform/shared/verification-result-contract.ts
  - platform/shared/verification-types.ts
  - platform/shared/ci-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/compiler/verify/verify-project.ts
  - platform/compiler/verify/run-runtime-verification.ts
  - platform/compiler/verify/run-policy-gate.ts
  - platform/orchestrator/
  - scripts/codex/
  - scripts/ci-verification.ts
  - scripts/ci-pr-risk.ts
  - .github/workflows/
  - docs/authority.json
  - docs/work/current-state.yaml
  - docs/work/rolling-plan.md
  - source/
  - project/
  - control/
  - tests/e2e/
acceptance:
  - "platform/shared/verification-artifact-contract.ts accepts both the legacy summary shape and the current summary shape with claimSummary; no other unknown summary keys are accepted."
  - "Embedded claimSummary.gates are validated with CodexDevelopmentAssertVerificationGateResultV1; embedded aggregate/claim results receive exact structural validation without duplicating the aggregate algorithm owned by verification-result-contract.ts."
  - "When claimSummary is present, legacy summary.status is passed if and only if claimSummary.overall.overallStatus is passed; every non-passed unified status projects to failed."
  - "Existing no-claimSummary VerificationReport fixtures remain accepted."
  - "tests/unit/verification-artifact-claim-summary.test.ts proves passed and failed current-writer reports classify as passed/failed rather than blocked; inconsistent or forged claimSummary remains blocked."
  - "Issue #217 is closed only after focused tests, existing semantic-mutation verification adapter tests, typecheck, docs doctor, repository audit, and hosted quick evidence pass on the exact candidate."
  - "No changes to verification aggregate semantics, runtime/policy writers, CI workflows, package/lock, or canonical docs."
tests:
  - tests/unit/verification-artifact-claim-summary.test.ts
  - tests/unit/semantic-mutation-verification-adapter.test.ts
---

# verification-artifact-claim-summary-v1

Issue #217. Repair the exact canonical artifact validator after VerificationReport gained
the optional claim-based summary in PR #211.

## Root cause

The canonical writer now emits `summary.claimSummary`, and `VerificationReport` declares it,
but `exactVerificationReport()` still accepts only the legacy three-key summary. Valid
isolated verification artifacts therefore become `blocked` before their physical pass/fail
result can be consumed.

## Fix boundary

- Extend only the artifact serialization validator.
- Reuse the canonical gate validator from `verification-result-contract.ts`.
- Validate aggregate and claim result exact shapes locally, but do not reimplement or alter
  the aggregate algorithm, owning-environment semantics, status lattice, or zero-test policy.
- Derive legacy `summary.status` from claimSummary overall status when present.
- Preserve legacy summary compatibility for unrelated fixtures during migration.

## Non-goals

- Issue #215 aggregate correctness.
- Issue #176 full writer/Evidence migration.
- CI Evidence V3 or workflows.
- Semantic Test Impact, Hermetic Runtime, Evidence DAG, or parallel integration.
