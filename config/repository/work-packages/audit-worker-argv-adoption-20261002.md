---
schema: codex-development-work-package-v1
id: audit-worker-argv-adoption-20261002
tracking: none
base: 113772b66115c35c8899a8ce1e09a7986fdeade5
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: align-worker-argument-readback
    owner: repository-audit
    ownedPaths:
      - "src/adapters/repository/repository-audit/loaded-implementation.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/stable-plan-binding-adoption-20261002.md"
      - "config/repository/work-packages/audit-worker-argv-adoption-20261002.md"
forbiddenPaths:
  - ".github/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "The loaded implementation join must require the exact existing producer tuple: no-env-file, no-install, and the sealed producer entrypoint, in that order"
  - "Preserve every length, argument order, entrypoint, operation, generation, dependency, process receipt, stdin and output binding check; do not remove the actual no-install safety flag"
  - "Replay the actual producer tuple and missing, repeated, reordered flags and changed entrypoint against the exact predicate; preserve the original failure evidence"
  - "Use the current trusted-main compiler for proposal-only projection after explicit prior manifest retirement, with no active Work or Gate authority"
  - "Obtain exact original PRE and bounded independent review, pass required security checks and expected-head merge, and verify the main tree and sole parent"
  - "Only a subsequent real source inspection may establish recovery; prior rejected output is not an issued observation"
tests:
  - "src/adapters/repository/repository-audit/source-program-audit-operation.test.ts"
---

# Align exact audit worker argument readback

The producer already starts its sealed worker with no automatic dependency installation. Its result join must compare that same strict tuple.
