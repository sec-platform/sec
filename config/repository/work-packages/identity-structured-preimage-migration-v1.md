---
schema: codex-development-work-package-v1
id: identity-structured-preimage-migration-v1
tracking: none
base: 040f1abc160598f9dc730e5a8917e2cfa3f8653f
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: bind-structured-preimage-migration
    owner: digest-identity-owner
    ownedPaths:
      - config/repository/work-packages/identity-structured-preimage-migration-v1.md
      - src/contracts/structured-identity.ts
      - src/contracts/structured-identity.test.ts
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
  - src/adapters/
  - src/assurance/
acceptance:
  - legacy verification and replacement identity consume one canonical-json-v1 traversal
  - the old value must parse as sha256 and exactly match the observed canonical payload before the new identity escapes
  - the replacement uses the existing framed blake3-256 profile with explicit domain and schema
  - digest-to-digest relabeling and mixed-generation legacy input are rejected
  - provider selection framing canonical encoding and persisted domain writers remain unchanged
tests:
  - src/contracts/structured-identity.test.ts
---

# Structured preimage migration primitive

This frozen source successor supplies the missing pure conversion primitive for
persisted domains whose old identity was exactly canonical-json-v1 SHA-256 of
the same semantic payload.

The conversion does not hash an old digest string. It parses the retained
SHA-256, canonicalizes the supplied value once, feeds exactly those chunks to
both the legacy SHA-256 verifier and the already-bound framed BLAKE3 runtime,
and exposes the new identity only after the legacy digest matches.

A domain whose historical SHA-256 used a different preimage must pass that
historical payload shape or implement its own exact legacy verifier. This
primitive is not a migration receipt, storage publication, authorization,
cache retirement or writer cutover.
