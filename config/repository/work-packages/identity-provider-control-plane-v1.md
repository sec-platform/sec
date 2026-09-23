---
schema: codex-development-work-package-v1
id: identity-provider-control-plane-v1
tracking: none
base: 63c27481c5cbada7c9a8efccf36e9fef16a08b5e
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: invert-content-provider-dependency
    owner: digest-identity-owner
    ownedPaths:
      - config/repository/work-packages/identity-provider-control-plane-v1.md
      - src/contracts/content-hash-provider.ts
      - src/contracts/content-hash-provider.test.ts
      - src/contracts/content-digest.ts
      - src/contracts/content-digest.test.ts
      - src/contracts/structured-identity.ts
      - src/contracts/structured-identity.test.ts
      - src/adapters/providers/content-hash/awasm-wasm-simd.ts
      - src/adapters/providers/content-hash/sec.module.json
      - src/bootstrap/content-identity-runtime.ts
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
  - config/repository/work-packages/digest-object-boundary.md
  - config/repository/work-packages/identity-profile-blake3-v1.md
  - config/repository/work-packages/identity-provider-wasm-v1.md
  - config/repository/work-packages/sec086-current-main-convergence-v1.md
  - src/adapters/mutation/
  - src/adapters/providers/git-read/
  - src/adapters/release/
  - src/adapters/verification/
  - src/assurance/
acceptance:
  - contracts contain no physical @awasm import or worker-pool choice
  - one provider contract fixes blake3-256 output length streaming input lifetime backend identity and parallelism shape
  - the synchronous identity runtime mechanically rejects caller-bounded and provider-unbounded parallelism
  - the pinned awasm implementation exists only in one adapter and exposes no algorithm key output-length reset XOF or worker-count choice
  - bootstrap explicitly composes the provider content runtime and structured identity runtime without a mutable global service locator
  - official BLAKE3 vectors chunk-boundary invariance terminal lifecycle and preimage migration semantics remain unchanged
  - wasm_threads is not imported because its current upstream shared worker pool exposes no caller-bounded slot grant
  - no generic execution scheduler or resource ledger is duplicated while execution-wave-v1 remains deferred
  - no identity bytes persisted SHA-256 writer Git OID external digest active Work Package pointer main ref security ref PR Gate or hosted CI is changed
tests:
  - src/contracts/content-hash-provider.test.ts
  - src/contracts/content-digest.test.ts
  - src/contracts/identity-profile.test.ts
  - src/contracts/structured-identity.test.ts
  - repository architecture source-to-provider boundary
---

# Content hash provider control-plane binding

This frozen successor closes the implementation inversion left by
`identity-provider-wasm-v1`. The identity profile remains exactly
`blake3-256-canonical-json-v1`; this packet changes only which layer is
allowed to know the physical hashing implementation.

The contracts layer owns digest semantics and a provider shape. The awasm
package import moves to one adapter. Bootstrap performs explicit composition
and hands consumers an issued content/identity runtime. Ordinary synchronous
identity hashing admits only a single-thread provider whose update consumes
caller bytes before returning.

The repository's current Work Selection marks `execution-wave-v1` deferred.
This packet therefore does not invent a second CPU/memory scheduler to make a
hashing library look managed. The current `@awasm/noble/wasm_threads.js`
worker pool is also intentionally ineligible: its public pool does not expose
a caller-bounded worker-slot contract, so it cannot consume a parent SEC CPU
grant without potentially oversubscribing the host. Future threaded/native
providers enter only through the existing implementation-selection and
execution-resource work when they can honor that contract.

Package installation, Bun execution, portable runtime qualification and
same-machine performance remain evidence obligations. This source packet does
not request hosted CI and does not claim release qualification.
