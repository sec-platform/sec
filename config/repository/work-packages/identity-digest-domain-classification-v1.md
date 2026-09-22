---
schema: codex-development-work-package-v1
id: identity-digest-domain-classification-v1
tracking: none
base: 2b7decb171a9e3c3ebc3f0a2eadb08845bfb146a
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: freeze-digest-domain-migration-boundaries
    owner: digest-identity-owner
    ownedPaths:
      - config/repository/work-packages/identity-digest-domain-classification-v1.md
      - docs/作者/工程源/身份断言与采纳.md
      - .documentation/source-manifest.json
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - src/
  - config/repository/active-work-package.md
  - config/repository/current-state.yaml
  - config/repository/rolling-plan.md
  - config/repository/work-selection.md
acceptance:
  - the unique identity owner distinguishes SEC identities Git OIDs external digests evidence ledgers physical caches semantic caches and ephemeral caches
  - existing protocol SHA-256 values are not mislabeled as content-identity migration debt
  - durable migration requires an owning schema successor and retained preimage
  - rebuildable caches may retire by namespace generation rather than permanent dual readers
  - documentation source manifest is recomputed from the exact changed owner bytes
---

# Digest-domain migration classification

This packet closes the policy ambiguity exposed by the SHA-256 census. The
canonical identity owner now says which digest domains are governed by the new
BLAKE3 profile and which remain owned by Git, external protocols, historical
evidence, durable recovery schemas, physical cache transports or ephemeral
cache lifetime.

It introduces no second report and no code-level algorithm change. Future
migrations must cite the owning row and still satisfy their domain-specific
reader/writer/retirement obligations.
