---
schema: codex-development-work-package-v1
id: identity-provider-boundary-regression-v1
tracking: none
base: a3e620b19e8b80e014fe3cf7e11e236020ac92f2
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: enforce-content-provider-import-boundary
    owner: digest-identity-owner
    ownedPaths:
      - config/repository/work-packages/identity-provider-boundary-regression-v1.md
      - tests/unit/content-hash-provider-boundary.test.ts
forbiddenPaths:
  - .github/
  - .documentation/
  - docs/
  - AGENTS.md
  - package.json
  - bun.lock
  - config/repository/active-work-package.md
  - config/repository/current-state.yaml
  - config/repository/rolling-plan.md
  - config/repository/work-selection.md
  - src/
acceptance:
  - the only production @awasm/noble import is the physical content-hash adapter
  - production source contains no @awasm/noble/wasm_threads import
  - contracts execution and bootstrap cannot bind the package directly
  - the check is derived from the current repository tree and does not duplicate provider semantics
tests:
  - tests/unit/content-hash-provider-boundary.test.ts
---

# Physical content-hash import boundary regression

This frozen successor turns the provider-layering decision into executable
repository evidence. It does not add another provider registry or scheduler.

The test walks bounded production source files and admits exactly one direct
`@awasm/noble` import: the content-hash physical adapter. The threaded target
has zero production imports until an implementation can honor an execution-owned
parallelism grant. Contracts, execution and bootstrap remain package-independent.

This packet changes no product runtime bytes, identity profile, dependency lock,
persistent writer, control-plane pointer, hosted CI or concurrent security path.
