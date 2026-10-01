---
schema: codex-development-work-package-v1
id: source-analysis-index-repair-20261001
tracking: none
base: 7c034ba11f76ad17e67ef118da27b443762dc31f
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: reuse-immutable-source-analysis-inputs
    owner: source-program-model
    ownedPaths:
      - src/adapters/repository/source-program-model/repository.ts
      - src/adapters/repository/source-program-model/test-observations.ts
      - src/adapters/repository/source-program-model/test-observations.test.ts
      - src/adapters/repository/source-program-model/workspace-source-authority.ts
      - src/adapters/repository/source-program-model/workspace-source-snapshot.test.ts
      - src/adapters/repository/source-program-model/workspace-source-snapshot-identity.test.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/git-operation-isolation-repair-20261001.md
      - config/repository/work-packages/source-analysis-index-repair-20261001.md
forbiddenPaths:
  - AGENTS.md
  - LICENSE
  - LICENSES/
  - README.md
  - bun.lock
  - package.json
  - .github/
acceptance:
  - This bounded external-maintainer proposal has no active Work, Gate, health or integration authority
  - Reuse only immutable compilation-local path owner, dependency vector and digest inputs while preserving graph traversal, cancellation and negative dependency observations
  - Unknown observation merge preserves exact existing five-field equality, ordering and test-only duplicates
  - Snapshot identity fast path accepts only original captured files, source revision and privately owned canonical immutable membership
  - Structural clones and arbitrary frozen callback objects retain full validation; lazy semantic projection remains required
  - No persistent cache, deadline increase, current qualification substitution or native typecheck protocol change is included
  - Exact existing focused evidence and bounded editor diagnostics are reused; trusted-root migration consumes actual old-checker outcomes and independent exact-version review
  - Runtime speedup and successful full transition assessment remain unproved until actual changed-implementation execution
  - Rust, credentials, protection settings and broader native reuse or recovery changes are outside this proposal
tests:
  - src/adapters/repository/source-program-model/test-observations.test.ts
  - src/adapters/repository/source-program-model/workspace-source-snapshot.test.ts
  - src/adapters/repository/source-program-model/workspace-source-snapshot-identity.test.ts
---

# Immutable source-analysis input reuse

This candidate removes repeated derivation within one immutable compilation and
snapshot validation. It preserves semantic input identity and existing fallback
checks. It does not claim a formal Gate or end-to-end performance result.
