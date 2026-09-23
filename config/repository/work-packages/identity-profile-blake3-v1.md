---
schema: codex-development-work-package-v1
id: identity-profile-blake3-v1
tracking: none
base: 8ed0c862e4e625a146bcbeca91a7544e4386e68c
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: bind-content-provider-and-identity-profile
    owner: digest-identity-owner
    ownedPaths:
      - config/repository/work-packages/identity-profile-blake3-v1.md
      - package.json
      - bun.lock
      - src/contracts/canonical.ts
      - src/contracts/content-digest.ts
      - src/contracts/content-digest.test.ts
      - src/contracts/identity-profile.ts
      - src/contracts/identity-profile.test.ts
      - src/contracts/structured-identity.ts
      - src/contracts/structured-identity.test.ts
      - tests/fixtures/identity/blake3-256-vectors.json
forbiddenPaths:
  - .github/
  - .documentation/
  - docs/
  - AGENTS.md
  - config/repository/active-work-package.md
  - config/repository/current-state.yaml
  - config/repository/rolling-plan.md
  - config/repository/work-packages/digest-object-boundary.md
  - config/repository/work-packages/sec086-current-main-convergence-v1.md
  - src/adapters/mutation/
  - src/adapters/providers/git-read/
  - src/adapters/release/
  - src/adapters/verification/
  - src/assurance/
acceptance:
  - exact package and integrity binding with no runtime download or algorithm fallback
  - unkeyed BLAKE3-256 computations own isolated terminal state and reject shared byte views
  - raw content and domain-bound structured identities remain distinct
  - one canonical encoder preserves existing SHA-256 preimages and encoding
  - framed identity parsing requires exact profile domain schema and BLAKE3 spelling
  - raw-content migration verifies the original SHA-256 preimage before returning a new digest
  - external digests Git object IDs active operations and historical evidence are not relabeled
  - no source proposal is represented as machine activation qualified release or complete migration
tests:
  - src/contracts/content-digest.test.ts
  - src/contracts/identity-profile.test.ts
  - src/contracts/structured-identity.test.ts
---

# Content provider and identity profile

This independent frozen source proposal is based on the published identity
branch. It does not widen digest-object-boundary or activate itself. The normal
control-plane owner must select/rebind it before managed execution or integration.
The concurrent security task retains its branch, active pointer, operation,
verification budget and final-candidate authority.

This packet implements a portable BLAKE3 binding and the first explicit identity
profile. It is not a global algorithm switch. Existing persisted schemas keep
their declared SHA-256 writer and historical reader until the owning producer /
consumer / migration closure is admitted and completed as a separate successor.

Qualification must distinguish source/API checks, Node tests, installed-package
and frozen-lock checks, Bun/portable packaging, native/WASM performance comparison,
independent security review, managed activation, Gate and actual main readback.
None is inferred from another. Only a frozen final candidate may request hosted
facts unavailable from local/static evidence.

The implemented profile remains a source proposal until its stable semantics are
adopted by the existing identity documentation owner and affected projections.
This packet does not create a parallel BLAKE3 design report or claim that the
adopted product specification has already changed. Dependency integrity is pinned
from the upstream maintainer's release lock; registry archive verification and
Bun frozen-lock installation are separate, still-required observations.
