---
schema: codex-development-work-package-v1
id: verification-result-claim-migration-v1
tracking: none
base: c13a229e53e5de818f3c8dd9f980ddd6023562a4
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: migrate-verify-summary
    owner: verify-claim-worker
    ownedPaths:
      - platform/shared/verification-types.ts
      - platform/compiler/verify/verify-project.ts
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/run-policy-gate.ts
      - platform/orchestrator/verify-orchestrator.ts
      - tests/unit/verification-claim-migration.test.ts
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/verification-result-claim-migration-v1.md
      - docs/archive/work-packages/ci-verification-flow-fix-v1.md
forbiddenPaths:
  - bun.lock
  - platform/shared/ci-contract.ts
  - platform/shared/verification-result-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/ci-artifact-contract.ts
  - platform/shared/verification-artifact-contract.ts
  - scripts/codex/sec-merge-bootstrap.ts
  - scripts/codex/work-package-contract.ts
  - scripts/codex/parallel-work-package-contract.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/ci-verification.ts
  - scripts/ci-pr-risk.ts
  - .github/workflows/
  - docs/work/current-state.yaml
  - tests/e2e/
acceptance:
  - "platform/compiler/verify/verify-project.ts summarizeReport no longer allows skipped lanes to silently produce summary status 'passed'; overall 'passed' requires all required claims to be 'passed' via CodexDevelopmentAggregateVerificationClaimsV1."
  - "platform/compiler/verify/verify-project.ts emits VerificationClaimResultV1 claims for fast and runtime lanes, mapping legacy passed/failed/skipped via mapProductVerificationStatus."
  - "platform/compiler/verify/run-policy-gate.ts emits a policy claim with explicit applicability (required/optional/not-applicable) instead of silently skipped."
  - "platform/compiler/verify/run-runtime-verification.ts service-mode 'passed' is represented as not-run with reasonCode current-runner-not-owning-environment when acceptance was not executed."
  - "platform/orchestrator/verify-orchestrator.ts writeBlockedVerificationSnapshot emits failed claims instead of mixed skipped+failed."
  - "tests/unit/verification-claim-migration.test.ts covers: all-lane fast-passed+runtime-skipped no longer yields overall passed; policy skipped with no policies yields not-run not passed; service mode without acceptance yields not-run; drift failure yields failed claims."
  - "docs/archive/work-packages/ci-verification-flow-fix-v1.md exists (previous WP archived)."
  - "docs/work/active-work-package.md pointer updated to verification-result-claim-migration-v1 with status conditional."
  - "docs/work/rolling-plan.md updated: ci-verification-flow-fix-v1 moved to completed, verification-result-claim-migration-v1 as current WP."
  - "All focused contracts, typecheck, docs doctor, repository audit pass on one single-parent candidate."
tests:
  - tests/unit/verification-claim-migration.test.ts
  - tests/unit/verification-result-core.test.ts
  - tests/contract/verification-result-contract.test.ts
---

# verification-result-claim-migration-v1

## Problem

Issue #176 Slice 2. The unified verification result model (`verification-result-contract.ts`, PR #204) established 5-state status, 3 dispositions, 4 applicability, 17 reasonCodes, and a claim-based aggregate algorithm. However, the product verification runners still use the legacy 3-state `passed/failed/skipped` model, and `summarizeReport()` in `verify-project.ts:221-240` allows `skipped` lanes to silently produce `summary.status = 'passed'` — the decisive false-green root cause.

## Fix

Migrate the product verification summary to use `CodexDevelopmentAggregateVerificationClaimsV1`:

1. **verify-project.ts**: Replace `summarizeReport()` with claim-based aggregation. Each lane (fast, runtime, policy) emits `VerificationClaimResultV1` via `mapProductVerificationStatus`. Overall `passed` requires all required claims to be `passed`.

2. **run-policy-gate.ts**: Emit a policy claim with explicit `applicability` (required/optional/not-applicable) instead of silently `skipped` when no policies are declared.

3. **run-runtime-verification.ts**: Service-mode `passed` without acceptance execution is represented as `not-run` with `reasonCode: current-runner-not-owning-environment`.

4. **verify-orchestrator.ts**: `writeBlockedVerificationSnapshot` emits failed claims instead of mixed skipped+failed.

5. **verification-types.ts**: Add claim-related types bridging legacy reports to the unified model.

## Scope

This is a product-behavior migration. The unified contract (`verification-result-contract.ts`) is frozen and must not be modified. CI contract, workflow files, and merge-gate infrastructure are out of scope.
