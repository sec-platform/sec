---
schema: codex-development-work-package-v1
id: verification-claim-aggregate-correctness-v1
tracking: issue-215
base: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: verification-claim-aggregate-correctness
    owner: verification-truth-worker
    ownedPaths:
      - platform/shared/verification-result-contract.ts
      - platform/compiler/verify/verify-project.ts
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/run-policy-gate.ts
      - tests/unit/verification-result-core.test.ts
      - tests/unit/verification-claim-migration.test.ts
      - tests/unit/verification-claim-aggregate-correctness.test.ts
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/verification-claim-aggregate-correctness-v1.md
      - docs/work-packages/affected-selection-trust-boundary-v1.md
      - docs/archive/work-packages/affected-selection-trust-boundary-v1.md
forbiddenPaths:
  - package.json
  - bun.lock
  - bunfig.toml
  - tsconfig.json
  - .gitattributes
  - .editorconfig
  - .prettierrc.json
  - .github/workflows/
  - docs/authority.json
  - docs/goals/
  - scripts/codex/
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - platform/shared/test-impact-contract.ts
  - platform/shared/affected-test-inventory.ts
  - platform/shared/verification-artifact-contract.ts
  - platform/shared/ci-artifact-contract.ts
  - platform/shared/ci-artifact-types.ts
  - platform/shared/ci-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/ci-evidence-composition-policy-registry.ts
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-evidence-reuse-contract.ts
  - platform/shared/ci-execution-environment.ts
  - platform/dev-runner/
  - platform/registry/
  - platform/orchestrator/
  - platform/policies/
  - platform/upgrade/
  - source/
  - project/
  - control/
  - tests/e2e/
  - tests/integration/
acceptance:
  - "VerificationClaimDefinitionV1.owningEnvironments is enforced through one canonical environment key; a passed/reused gate from a non-owning or unidentified environment cannot support the claim."
  - "Claim and overall aggregation is independent of claims/gates input order and follows failed > invalidated > unsupported > not-run > passed; the decisive reason comes from an actual highest-priority claim."
  - "Duplicate claim ids, duplicate gate ids, duplicate requiredGateIds, missing required gates and unsupported legacy reused Evidence fail closed with deterministic diagnostics/results."
  - "A policy gate proved not-applicable is reported but its claim is omitted from the required claim set; required policy missing/execution failure remains blocking."
  - "Full runtime verification with zero unit or acceptance files and no Target/Profile applicability proof is invalidated/selection-unresolved; service mode cannot support the full runtime claim."
  - "Existing skipped-to-passed and affected-selection regressions remain closed."
  - "The frozen counterexample matrix covers wrong/correct environment, status permutations, duplicate/missing identities, policy applicability, zero runtime tests and legacy reused Evidence without environment."
  - "Focused tests, typecheck, docs:doctor, imports organization, repository audit, hosted exact-head verification and independent Review pass before merge."
tests:
  - tests/unit/verification-result-core.test.ts
  - tests/unit/verification-claim-migration.test.ts
  - tests/unit/verification-claim-aggregate-correctness.test.ts
---

# verification-claim-aggregate-correctness-v1

Issue #215. Close the four verified truth gaps left after PR #211 without widening into Test Impact, CI Evidence V3, Evidence DAG or Hermetic Runtime.

## Root cause

The unified result vocabulary exists, but the aggregate does not consume owning environments, overall precedence is iteration-order dependent, the product summary always creates a required policy claim even when the gate is proved not-applicable, and the runtime runner can project an empty required test selection as passed.

## Counterexample-first execution

The first candidate commit freezes executable counterexamples before changing production behavior. The candidate remains Draft/red until the canonical owners are changed; tests must not be weakened or deleted to obtain green.

## Completion boundary

The final candidate must update the canonical aggregate and product projections, preserve #206 selection truth, pass all required gates, merge through the trusted path, then archive the prior manifest and reconcile the new main.
