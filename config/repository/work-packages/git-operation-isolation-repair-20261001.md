---
schema: codex-development-work-package-v1
id: git-operation-isolation-repair-20261001
tracking: none
base: 7c8a841b9d1fb12395922bde47b32fc1ec6500c2
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: retain-operation-git-provider-and-isolate-existing-hazards
    owner: git-operation-isolation-repair-owner
    ownedPaths:
      - src/adapters/providers/git-read/authority.ts
      - src/adapters/providers/git-read/runtime/session.ts
      - src/adapters/providers/git/physical-provider.ts
      - src/adapters/self-hosting/development/runner/fast-test-policy.ts
      - tests/unit/git-authority-native-failure.test.ts
      - tests/unit/git-read-borrowed-lifecycle.test.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/trusted-checker-provider-repair-20261001.md
      - config/repository/work-packages/git-operation-isolation-repair-20261001.md
forbiddenPaths:
  - AGENTS.md
  - LICENSE
  - LICENSES/
  - README.md
  - bun.lock
  - package.json
  - .github/
acceptance:
  - This is bounded external-maintainer candidate source; proposal compilation does not issue active Work, health, Gate or integration authority
  - One Git read operation retains its existing physical provider once and admits its executable bytes once; subsequent phases borrow only the exact live operation, attempt, process ledger, root and environment binding
  - Borrowing preserves executable and directory identity fences, parent deadlines, cancellation and all existing aggregate resource ceilings without provider substitution or budget refill
  - Phase settlement cannot close the operation-owned provider; the operation joins all phases, releases the provider once and then settles the process ledger with composite failure preservation
  - Reserve and charge the existing root-close settlement attempt before admission, retain zero-phase no-open behavior, and attempt physical cleanup even when accounting or identity checks fail
  - Standalone sessions retain their original owned-resource lifetime and foreign or transplanted physical capabilities remain rejected
  - Executable-size admission failures report the existing typed executable-budget reason instead of misreporting identity loss
  - Register the three exact pre-existing process-global hazard suites under their existing independent-process resource class without changing test meaning or claiming test necessity
  - Exact complete hazard inventory has unique ownership and single-file queues; static projection, executed sentinel and all remaining qualification are reported distinctly
  - Preserve the previous cancelled normalization action and its actual failure; a later changed candidate produces its own truthful admission and settlement
  - Reuse valid exact-input evidence, obtain independent exact-version review and perform protected expected-head adoption with authenticated parent, tree and default-ref readback
  - Rust, live runner deployment, credentials, protection settings and the separate finite-demand freeze redesign are outside this proposal
tests:
  - tests/unit/git-authority-native-failure.test.ts
  - tests/unit/git-read-borrowed-lifecycle.test.ts
  - tests/unit/test-runner.test.ts
---

# Retained Git operation and test isolation repair

This proposal corrects repeated executable admission within one Git operation
and the three pre-existing process-global test isolation omissions. Resource
ownership and final settlement remain with their existing owners. It does not
claim native Windows qualification, a formal Gate or completion of the separate
freeze resource-demand redesign.
