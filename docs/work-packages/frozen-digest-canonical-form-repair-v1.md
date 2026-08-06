---
schema: codex-development-work-package-v1
id: frozen-digest-canonical-form-repair-v1
tracking: issue-309
base: 6cbe65d86a985678a123d466149be6fad990100d
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: frozen-digest-canonical-form-repair
    owner: semantic-mutation-maintainer
    ownedPaths:
      - tests/contract/documentation-authority.test.ts
      - tests/contract/impact-propagation-contract.test.ts
      - tests/contract/semantic-mutation-apply-contract.test.ts
      - tests/contract/semantic-mutation-contract.test.ts
      - tests/contract/semantic-mutation-source-adapter-contract.test.ts
      - tests/helpers/semantic-mutation-recovery-fixture.ts
      - tests/helpers/semantic-mutation-verification-report.ts
      - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
      - tests/integration/semantic-mutation-windows-rollback.test.ts
      - tests/unit/semantic-mutation-verification-adapter.test.ts
      - docs/work-packages/active-documentation-corpus-convergence-v2.md
      - docs/work-packages/frozen-digest-canonical-form-repair-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .agents/
  - .github/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/archive/
  - docs/evidence/
  - docs/scripts/
  - docs/superpowers/
  - platform/
  - scripts/
  - tests/e2e/
acceptance:
  - "9 canonical-form test files (8 semantic-mutation + 1 impact-propagation) replace local non-canonical sha256 with platform canonical sha256 from platform/shared/canonical-primitives.ts."
  - "All semantic-mutation and impact-propagation contract, unit, and integration tests pass on the exact head."
  - "The fix addresses the root cause introduced by 4b27555b refactor without hardcoding or adapters."
  - "PR #284 has merged; this repair unblocks #308 rebuild from the resulting new main."
  - "The active pointer has switched to this manifest; the predecessor manifest is retired from docs/work-packages/."
tests:
  - tests/contract/documentation-authority.test.ts
  - tests/contract/impact-propagation-contract.test.ts
  - tests/contract/semantic-mutation-source-adapter-contract.test.ts
  - tests/contract/semantic-mutation-contract.test.ts
  - tests/contract/semantic-mutation-apply-contract.test.ts
  - tests/unit/semantic-mutation-verification-adapter.test.ts
  - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
  - tests/integration/semantic-mutation-windows-rollback.test.ts
---
