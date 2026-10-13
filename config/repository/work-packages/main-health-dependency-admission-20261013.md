---
schema: codex-development-work-package-v1
id: main-health-dependency-admission-20261013
tracking: none
base: a2ee46c9ad478def280bad0fc5358e4b9eb1eb62
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: restore-owned-main-health-dependency-bootstrap
    owner: repository-maintainer
    ownedPaths:
      - ".github/workflows/compiler-pr-validation.yml"
      - "src/adapters/verification/platform/ci/contract/core.ts"
      - "src/adapters/self-hosting/control/main-health/main-health-observation.ts"
      - "tests/contract/ci-trust-closure-contract.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/main-source-health-repair-20261013.md"
      - "config/repository/work-packages/main-health-dependency-admission-20261013.md"
forbiddenPaths:
  - "docs/"
  - "src/adapters/runtime-state/"
  - "src/adapters/self-hosting/development/dependencies/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Prepare MainHealth dependencies through the original owned generation producer before import and verified type checks; preserve unknown-directory rejection"
  - "Reconcile the real workflow, canonical command plan and receipt consumer in one change without a second installer or fake ownership"
  - "Preserve the five canonical health checks, exact request and source provenance, permissions, cache scope and original dependency settlement"
  - "Use the real parsed workflow as the independent oracle for dependency bootstrap ordering; preserve plan-digest invalidation"
  - "Retain actual old-main failure and local registration/process-settlement gaps; proposal-only compilation grants no Work or Gate"
  - "Require independent exact-head review, necessary protected checks, expected-head maintainer adoption and parent/tree readback"
  - "Request the adopted main original health producer at most once, joining existing exact operation evidence; no Docker or exploratory hosted execution"
tests:
  - "tests/contract/ci-trust-closure-contract.test.ts"
  - "tests/unit/trusted-runtime-container.test.ts"
  - "tests/unit/main-health-contract.test.ts"
---

# Restore owned MainHealth dependency preparation

Exact-main run38325164840 passed import organization, then dependency admission rejected the ordinary node_modules created by the workflow's preceding Bun install. That directory has no compiler generation binding. Preserve this refusal and route preparation through the existing deps:ensure owner instead.

The original dependency producer owns frozen inputs, isolated installation, binding, lifecycle registration, generation publication and settlement. Synchronize the public command plan and receipt consumer with that action; do not delete unknown inputs or run an ungoverned compiler fallback.

This bounded proposal records the actual old failure and independent source evidence. It grants no ordinary Work, MainHealth, Session or integration authority and does not adopt the broader documentation integration.
