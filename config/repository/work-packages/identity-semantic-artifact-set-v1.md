---
schema: codex-development-work-package-v1
id: identity-semantic-artifact-set-v1
tracking: none
base: ab44f0b44e3459ee19a0b6256f671ec04af7c512
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: issue-semantic-artifact-set-identity
    owner: digest-identity-owner
    ownedPaths:
      - config/repository/work-packages/identity-semantic-artifact-set-v1.md
      - src/contracts/structured-identity.ts
      - src/contracts/structured-identity.test.ts
      - src/compiler/semantic-artifacts.ts
      - src/application/semantic-query.ts
      - src/bootstrap/create-runtime.ts
      - examples/semantic-query/consume.ts
      - tests/unit/content-hash-provider-boundary.test.ts
      - tests/unit/semantic-artifact-identity.test.ts
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
  - src/adapters/mutation/
  - src/adapters/verification/
  - src/assurance/
acceptance:
  - generated semantic artifact sets carry one semantic-artifact-set v1 structured identity
  - the identity preimage binds scope legacy IR revisions and exact ordered members including generated source
  - legacy Engineering IR v2 inputRevision and semanticRevision remain unchanged SHA-256 protocol values
  - compiler and application depend only on an owner-issued structured identity runtime and never on the physical hash package
  - analyze queries do not load the target generator or content-hash provider
  - generation lazily assembles and reuses the physical identity runtime at bootstrap
  - repeated identical artifact sets reproduce one identity while changed source changes identity
tests:
  - src/contracts/structured-identity.test.ts
  - tests/unit/content-hash-provider-boundary.test.ts
  - tests/unit/semantic-artifact-identity.test.ts
  - examples/semantic-query/consume.ts
---

# Semantic artifact set identity

This packet gives the new BLAKE3 profile its first production semantic result
consumer without changing any historical SHA-256 protocol. Engineering IR v2
revisions remain legacy values and enter the new artifact-set identity only as
preimage fields.

The compiler owns the semantic artifact-set identity material. Bootstrap owns
physical provider composition. Application asks for an owner-issued structured
identity runtime only on generation, so analysis keeps the previous lazy
dependency boundary.
