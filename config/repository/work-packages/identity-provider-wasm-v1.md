---
schema: codex-development-work-package-v1
id: identity-provider-wasm-v1
tracking: none
base: fde06a5a66d3a4f5e72fcb68fcae85b88cd76cc6
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: qualify-wasm-content-provider
    owner: digest-identity-owner
    ownedPaths:
      - config/repository/work-packages/identity-provider-wasm-v1.md
      - package.json
      - bun.lock
      - src/contracts/byte-snapshot.ts
      - src/contracts/content-digest.ts
      - src/contracts/content-digest.test.ts
      - docs/作者/工程源/身份断言与采纳.md
      - .documentation/source-manifest.json
forbiddenPaths:
  - .github/
  - AGENTS.md
  - config/repository/active-work-package.md
  - config/repository/current-state.yaml
  - config/repository/rolling-plan.md
  - config/repository/work-packages/digest-object-boundary.md
  - config/repository/work-packages/identity-profile-blake3-v1.md
  - config/repository/work-packages/sec086-current-main-convergence-v1.md
  - src/adapters/mutation/
  - src/adapters/providers/git-read/
  - src/adapters/release/
  - src/adapters/verification/
  - src/assurance/
acceptance:
  - the blake3-256-canonical-json-v1 profile and every digest preimage remain byte-identical
  - the default content provider is synchronous non-threaded WASM/SIMD streaming with an exact package and lock binding
  - admitted non-shared byte views avoid an additional full SEC-side copy while synchronous provider update does not retain caller bytes
  - official BLAKE3 vectors chunk-boundary invariance terminal lifecycle and migration preimage checks remain the behavioral obligations
  - legacy SHA-256 writers Git object IDs and external provider digests remain unchanged
  - the unique identity documentation owner records the adopted profile migration boundary provider substitutability and naming rule
  - source-manifest projection is refreshed from the changed canonical documentation source
  - no active Work Package pointer concurrent security ref main ref PR Gate hosted CI or persistent-schema writer is changed by this source proposal
tests:
  - src/contracts/content-digest.test.ts
  - src/contracts/identity-profile.test.ts
  - src/contracts/structured-identity.test.ts
  - tests/unit/byte-tail-snapshot.test.ts
  - docs:doctor
---

# WASM content provider qualification

This frozen successor is based on the exact published identity proposal at
`fde06a5a66d3a4f5e72fcb68fcae85b88cd76cc6`. It does not edit or reactivate that predecessor manifest. It
converges the physical BLAKE3 provider behind the already-defined profile and
adopts the stable identity semantics in the existing documentation owner.

The chosen default is the synchronous, non-threaded WASM/SIMD backend. Threaded
WASM remains a separate resource/lifecycle optimization; native N-API remains a
future qualified acceleration option. Neither may change algorithm, mode,
output length, framing or canonical payload bytes.

Package/lock bytes are source admission, not runtime proof. Bun frozen install,
exact published archive verification, official-vector execution on the installed
package, Windows/Linux portable packaging and same-machine performance evidence
remain required before release qualification. Hosted CI is not requested by
this packet and must not be used for provider exploration.

Persistent identity migration remains cohort-owned. This packet changes no
existing SHA-256 persisted writer, no historical evidence, and no external
digest spelling.
