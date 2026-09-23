---
schema: codex-development-work-package-v1
id: identity-provider-explicit-wasm-entry-v1
tracking: none
base: 3d3c9e022e7eb8b602f05f5b379ef507795d784a
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: bind-explicit-wasm-package-entry
    owner: digest-identity-owner
    ownedPaths:
      - config/repository/work-packages/identity-provider-explicit-wasm-entry-v1.md
      - src/adapters/providers/content-hash/awasm-wasm-simd.ts
forbiddenPaths:
  - .github/
  - .documentation/
  - docs/
  - AGENTS.md
  - package.json
  - bun.lock
  - src/contracts/
  - src/execution/
  - src/bootstrap/
acceptance:
  - the physical provider imports the package's explicit wasm export rather than its current default alias
  - the provider still asserts platform wasm output length 32 and BLAKE3 XOF capability
  - identity bytes dependency version lock and runtime policy remain unchanged
tests:
  - tests/unit/content-hash-provider-boundary.test.ts
  - src/contracts/content-digest.test.ts
---

# Explicit WASM package entry

The pinned package currently makes its root entry a re-export of the WASM
target, but SEC should not let a future package-default decision silently
change its selected physical backend.

The adapter therefore binds the exported `./wasm.js` entry directly. Package
version, lock integrity, BLAKE3 profile and all callers remain unchanged.
