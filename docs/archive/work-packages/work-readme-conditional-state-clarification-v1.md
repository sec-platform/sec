---
schema: codex-development-work-package-v1
id: work-readme-conditional-state-clarification-v1
tracking: none
base: 28b62b7847a475f0fb63bf4272b940d1d8d7a23d
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: clarify-conditional-state
    owner: docs-worker
    ownedPaths:
      - docs/work/README.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/work-readme-conditional-state-clarification-v1.md
      - docs/archive/work-packages/exact-default-base-identity-v1.md
forbiddenPaths:
  - bun.lock
  - package.json
  - .github/workflows/
  - scripts/codex/
  - platform/shared/
  - platform/compiler/
  - platform/orchestrator/
  - platform/dev-runner.ts
  - platform/dev-runner/
  - tests/
  - docs/work/current-state.yaml
  - docs/authority.json
  - tsconfig.json
acceptance:
  - "docs/work/README.md documents conditional manifest state and trusted exact base semantics."
  - "docs/work/active-work-package.md pointer updated to work-readme-conditional-state-clarification-v1 manifest with correct sha256 digest."
  - "docs/work/rolling-plan.md current package updated to work-readme-conditional-state-clarification-v1; exact-default-base-identity-v1 moved to completed section."
  - "docs/archive/work-packages/exact-default-base-identity-v1.md archived from docs/work-packages/."
  - "docs:doctor reports 0 errors."
tests:
  - tests/contract/docs-doctor.test.ts
---

## Context

PR #213 (exact-default-base-identity-v1) merged to main@28b62b7. The active pointer still references the merged manifest in `conditional` state (resolver returns `matchingDefaultBlob: none`). This WP archives the merged manifest, activates a new pointer, and clarifies the conditional state semantics in `docs/work/README.md`.

## Goal

- Archive `exact-default-base-identity-v1.md` to `docs/archive/work-packages/`.
- Activate `work-readme-conditional-state-clarification-v1` as the new active WP.
- Clarify conditional manifest state and trusted exact base semantics in `docs/work/README.md`.
- Verify hosted verification is restored for non-trust-root PRs.

## Non-Goals

- No trust-root file modifications.
- No test file modifications.
- No code changes beyond control-plane documentation.
