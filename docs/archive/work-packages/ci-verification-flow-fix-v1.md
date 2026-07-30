---
schema: codex-development-work-package-v1
id: ci-verification-flow-fix-v1
tracking: none
base: 46f92e4b966712e0adc819cf9b200502fb38d0d1
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: fix-verification-flow
    owner: ci-flow-worker
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - scripts/codex/sec-merge-bootstrap.ts
      - tests/unit/sec-merge-bootstrap.test.ts
      - platform/shared/ci-contract.ts
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/ci-verification-flow-fix-v1.md
      - docs/archive/work-packages/verification-result-core-v1.md
forbiddenPaths:
  - bun.lock
  - platform/compiler/
  - platform/orchestrator/
  - platform/dev-runner/
  - scripts/codex/work-package-contract.ts
  - scripts/codex/parallel-work-package-contract.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/ci-verification.ts
  - scripts/ci-pr-risk.ts
  - .github/workflows/sec-merge-gate.yml
  - docs/work/current-state.yaml
  - tests/e2e/
acceptance:
  - "scripts/codex/sec-merge-bootstrap.ts commandAll invokes ensureSingleParent before dispatchScopeAttest and dispatchVerification, so verification only runs on a single-parent head whose parent equals the base."
  - "scripts/codex/sec-merge-bootstrap.ts commandAll no longer calls ensureSingleParent after waitForWorkflowRun for verification."
  - ".github/workflows/compiler-pr-validation.yml no longer contains a 'Fetch PR base for exact tree comparison' step that runs a raw `git fetch` without credentials; the base commit is already available via actions/checkout fetch-depth: 2 for single-parent PRs."
  - ".github/workflows/compiler-pr-validation.yml persists-credentials remains false (security invariant unchanged)."
  - "platform/shared/ci-contract.ts CI_VERIFICATION_PR_STEP_ORDER no longer contains 'Fetch PR base for exact tree comparison' (workflow step removed from contract)."
  - "tests/unit/sec-merge-bootstrap.test.ts documents the commandAll ordering invariant: ensureSingleParent runs before dispatch."
  - "docs/archive/work-packages/verification-result-core-v1.md exists (previous WP archived)."
  - "docs/work/active-work-package.md pointer updated to ci-verification-flow-fix-v1 with status conditional."
  - "docs/work/rolling-plan.md updated: verification-result-core-v1 moved to completed, ci-verification-flow-fix-v1 as current WP."
  - "All focused contracts, typecheck, docs doctor, repository audit pass on one single-parent candidate."
tests:
  - tests/unit/sec-merge-bootstrap.test.ts
  - tests/contract/ci-contract.test.ts
---

# ci-verification-flow-fix-v1

## Problem

Two infrastructure bugs in the verification/merge flow have blocked hosted CI verification since PR #200 and forced a manual squash workaround for every merge:

1. **`compiler-pr-validation.yml` git fetch auth failure**: The workflow uses `actions/checkout` with `persist-credentials: false` (security hardening), then runs a raw `git fetch --no-tags --depth=1 origin <base>`. Without persisted credentials, the fetch fails with `could not read Username for 'https://github.com'`. This has caused every `sec-verify-frozen-v1` dispatch to fail since PR #200.

2. **`sec-merge-bootstrap.ts commandAll` ordering**: `commandAll` dispatches attestation and verification (steps 2-3) BEFORE calling `ensureSingleParent` (step 4). But the verification workflow enforces that the PR head is single-parent (parent === base). For branches with multiple commits, verification fails with "not one same-repository single-parent PR head", forcing a manual `squash` command before `all`.

## Fix

### Fix 1: Remove redundant git fetch step

`actions/checkout` with `fetch-depth: 2` fetches the head commit and one parent. For single-parent PRs (enforced by the verification step's single-parent check), the parent === base. So the base commit is already in the local clone. The `git fetch` step is redundant and its auth failure is the root cause of the verification breakage. Removing it eliminates the auth issue without compromising the `persist-credentials: false` security invariant.

### Fix 2: Reorder commandAll to squash before dispatch

Move `ensureSingleParent` before `dispatchScopeAttest` and `dispatchVerification`. This ensures the PR head is single-parent (parent === base) before any attestation or verification dispatch. After squash, `pr.headSha` is updated to the new single-parent head, so all subsequent dispatches and workflow title matching use the correct head SHA.
