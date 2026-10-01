---
schema: codex-development-work-package-v1
id: release-test-governance-repair-20261001
tracking: none
base: 95725b00abc26fbee4457254e811634fa6f8e4cb
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: preserve-release-parent-and-test-observation-contracts
    owner: repository-release-test-governance
    ownedPaths:
      - .github/workflows/compiler-release-validation.yml
      - src/adapters/self-hosting/development/runner/fast-test-policy.ts
      - src/adapters/verification/platform/ci/contract/core.ts
      - tests/contract/ci-contract.test.ts
      - tests/helpers/exact-ref-retirement-fixture.ts
      - tests/integration/release-parent-checkout.test.ts
      - tests/unit/exact-ref-retirement.test.ts
      - tests/unit/github-api-verification.test.ts
      - tests/unit/repository-maintenance.test.ts
      - tests/unit/verification-session-runtime.test.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/write-lease-owner-boundaries-20261001.md
      - config/repository/work-packages/release-test-governance-repair-20261001.md
forbiddenPaths:
  - AGENTS.md
  - LICENSE
  - LICENSES/
  - README.md
  - bun.lock
  - package.json
  - docs/
  - .documentation/
acceptance:
  - This bounded source proposal issues no active Work, Gate, health or integration authority
  - Release metadata binds the requested and current trusted default head to exactly one SHA-shaped parent before emitting verification identities
  - The exact depth-two checkout proves its complete immediate-parent relation and local parent commit and tree before verification without a redundant authenticated fetch
  - Preserve checkout credential policy, workflow permissions, full verification, release payload ownership and the actual canonical step-order projection
  - Replace the Session stdin-echo proxy with an independent literal HTTP contract observation through the real provider operation owner
  - Replace the private exact-ref source-count proxy with real preparation and retirement owner behavior while retaining independent provider, review and recovery obligations
  - Exact-ref cases preserve class-specific predicates, published recovery prerequisites, one exact CAS, same-capability observations and fail-closed unsettled readback
  - Keep process-global exact-ref mocks in one independent process and retain bounded Linux process and fixture cleanup responsibilities
  - Reuse exact unchanged focused evidence and preserve every failed attempt and method limit; no old full assessment is retried unchanged
  - The adopted interpreter assesses the clean exact baseline and candidate once with actual discovery and receipt identities
  - Q4 authoring preserves unknown responsibility and execution-validity distinctions and never fabricates occurrence IDs, requirement bindings, equivalence or retirement
  - Final independent composition review and exact branch and PR readback precede publication completion; root alone owns default-branch merge
tests:
  - tests/contract/ci-contract.test.ts
  - tests/integration/release-parent-checkout.test.ts
  - tests/unit/exact-ref-retirement.test.ts
  - tests/unit/github-api-verification.test.ts
  - tests/unit/repository-maintenance.test.ts
  - tests/unit/verification-session-runtime.test.ts
---

# Release parent and independent test observations

Preserve the already reviewed release and test contracts on the adopted
test-transition interpreter. This source proposal does not claim live GitHub
release execution, remote ref deletion, author adoption or a qualified Gate.
