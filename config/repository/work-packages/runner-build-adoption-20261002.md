---
schema: codex-development-work-package-v1
id: runner-build-adoption-20261002
tracking: none
base: 51a5cfb15a1a5d7aaf8cfe1464b64c617f53a50f
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: adopt-runner-build-value-owner
    owner: local-github-actions-runner
    ownedPaths:
      - src/adapters/verification/platform/ci/runtime/local-github-actions-runner.ts
      - src/adapters/verification/platform/ci/runtime/local-github-actions-runner-build.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/action-journal-adoption-20261002.md
      - config/repository/work-packages/runner-build-adoption-20261002.md
forbiddenPaths:
  - "AGENTS.md"
  - "docs/"
  - ".documentation/"
  - ".agents/"
  - ".github/"
  - "tests/"
  - "package.json"
  - "bun.lock"
  - "crates/"
acceptance:
  - "Proposal-only source adoption grants no active Work, MainHealth, Session, Gate or automatic integration authority"
  - "Preserve reconstructed two-file source proposal 632d93bb63552c867f78ac4f1d696124fe68c8950245f23f03799642f11347b3 with only canonical sort-and-combine of its named imports; not a claimed recovery of missing historical commit"
  - "Preserve moved declaration bodies and all 34 original public export names; original entry reexports identical function and value identities"
  - "Build values consume the existing canonical environment and Linux materialization contracts; no filesystem, credential, container or execution authority moves into the new module"
  - "Keep runner runtime, API effects, private capabilities, lease, recovery and settlement under the original owner"
  - "Only canonical current-base compiler creates successor controls and retires exact matching-default predecessor manifest"
  - "Independent source and final integrated review bind exact head/tree and owners; focused/edit evidence is not Gate or production platform qualification"
  - "Preserve actual unchanged trusted-base checker verdict and all missing runtime, Docker, host and native evidence"
  - "Protected expected-head merge requires actual security eligibility, unchanged base and exact tree/sole-parent readback"
  - "No workflow, registry, policy, security setting, dependency, Rust or native implementation change"
tests:
  - "tests/unit/local-github-actions-runner.test.ts"
---

# Adopt runner build value owner

The reconstructed source-preserving proposal separates pure build inputs from live runner lifecycle. It neither restores an offline provider nor grants production qualification.
