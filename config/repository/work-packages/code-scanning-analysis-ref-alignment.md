---
schema: codex-development-work-package-v1
id: code-scanning-analysis-ref-alignment
tracking: none
base: df67ffc7ddf0bf7fae369c8b51fa5a0c5efb40bb
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: align-code-scanning-projection-with-analyzed-ref
    owner: verification-platform-owner
    ownedPaths:
      - config/repository/work-packages/code-scanning-analysis-ref-alignment.md
      - src/adapters/providers/github-api/internal/operation-session-runtime.ts
      - src/adapters/verification/platform/ci/runtime/code-scanning-projection.ts
      - tests/unit/code-scanning-projection.test.ts
      - tests/unit/github-api-operation-session.test.ts
forbiddenPaths:
  - .github/
  - .documentation/
  - AGENTS.md
  - docs/
  - package.json
  - bun.lock
  - config/repository/active-work-package.md
  - config/repository/current-state.yaml
  - config/repository/rolling-plan.md
  - config/repository/work-selection.md
acceptance:
  - the candidate is based directly on the captured current main and changes only this manifest plus the four owned implementation and test files
  - the Code Scanning alert query uses the pull-request head ref actually analyzed by this repository's GitHub Default CodeQL setup
  - every projected finding is bound to the exact pull-request head ref and exact pull-request head commit
  - mutable Pull API merge-preview identity is not used as Code Scanning analysis identity
  - the final GitHub Advanced Security CodeQL check remains bound to the exact pull-request head
  - a nonzero final CodeQL annotation count with an empty ref-scoped finding projection still fails closed
  - GitHub Code Scanning remains authoritative and no suppression severity threshold branch rule or write permission is weakened
tests:
  - tests/unit/code-scanning-projection.test.ts
  - tests/unit/github-api-operation-session.test.ts
  - tests/contract/code-scanning-projection-workflow.test.ts
---

# Code Scanning analysis-ref alignment

GitHub Default CodeQL for this repository analyzes pull-request source under
`refs/pull/<number>/head`. The projection must query and validate the same
analysis identity instead of joining that head-scoped check to a synthetic
merge-preview ref.

The change keeps the existing fail-closed annotation consistency check and
does not make the projection comment authoritative security evidence.
