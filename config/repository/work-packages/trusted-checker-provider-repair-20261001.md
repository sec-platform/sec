---
schema: codex-development-work-package-v1
id: trusted-checker-provider-repair-20261001
tracking: none
base: 313684988605d299cade1ff9d4e71b61bb6682bd
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: repair-trusted-checker-and-runner-activation
    owner: trusted-verification-repair-owner
    ownedPaths:
      - src/adapters/repository/source-program-model/workspace-typescript-config.ts
      - src/adapters/repository/source-program-model/workspace-typescript-config.test.ts
      - src/adapters/repository/source-program-model/workspace-typescript-project.ts
      - src/adapters/toolchain/typescript/snapshot-directory.ts
      - src/adapters/toolchain/typescript/snapshot-directory.test.ts
      - src/adapters/providers/github-api/internal/operation-session-runtime.ts
      - src/adapters/verification/platform/ci/runtime/local-github-actions-runner.ts
      - src/adapters/self-hosting/development/runner/fast-test-policy.ts
      - tests/unit/github-api-operation-session.test.ts
      - tests/unit/local-github-actions-runner.test.ts
      - tests/unit/local-github-actions-runner-lifecycle.test.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/trusted-checker-provider-repair-20261001.md
      - config/repository/work-packages/repository-closeout-20260927-v1.md
forbiddenPaths:
  - AGENTS.md
  - LICENSE
  - LICENSES/
  - README.md
  - bun.lock
  - package.json
  - .github/
acceptance:
  - Only the exact current-main trusted-checker and runner-activation repair closure is proposed; this package grants no activation, health, Gate, or integration authority
  - Normal and empty-project TypeScript configuration parsing resolves compiler paths from the normalized absolute config filename containing directory, preserving containment and existing independent expectations
  - The existing directory semantics identity changes so prior config-root checker results cannot remain fresh under the corrected parser
  - Fact and Program directory lookups consume the existing sealed snapshot index without a second inventory, ambient source lookup, or mutable AST reuse
  - Runner registration remains offline and non-claimable until the complete generation and exact runner identities are durably committed
  - Committed routing releases the retained listener markers and publishes only missing role labels through the existing exact-ID GitHub operation, with exact identity and label readback
  - Uncertain publication and commit acknowledgements preserve the committed generation for reconciliation and resumable activation rather than blind recreation or teardown
  - V5 state retains CPU and memory intent; legacy V4 remains readable and explicitly stoppable without inferred resource intent or automatic replacement of busy capacity
  - Pre-commit failures and explicit stop retain existing resource cleanup ownership; external labels, replaced runner IDs, and resource drift remain visible failures
  - The runner lifecycle suite has one canonical independent-process owner for its process-global module mocks
  - Focused candidate results, independent exact-version review, and all unperformed physical or formal qualification are recorded separately
  - External-maintainer adoption uses protected expected-head integration with parent equal to frozen base, candidate tree equality, authenticated identity and default-ref readback
  - Rust, ordinary echo-test retirement, credentials, protection settings, and live runner deployment are outside this proposal
tests:
  - src/adapters/toolchain/typescript/snapshot-directory.test.ts
  - src/adapters/repository/source-program-model/workspace-typescript-config.test.ts
  - src/adapters/repository/source-program-model/workspace-typescript-project-roots.test.ts
  - tests/unit/github-api-operation-session.test.ts
  - tests/unit/local-github-actions-runner.test.ts
  - tests/unit/local-github-actions-runner-lifecycle.test.ts
  - tests/unit/test-runner.test.ts
---

# Trusted checker and runner activation repair

This bounded external-maintainer proposal repairs configuration interpretation,
reuses the sealed directory owner, and restores durable-before-routable runner
activation. It is candidate source, not an active Work, a formal Gate result,
a qualified host, or authorization to operate live runners.
