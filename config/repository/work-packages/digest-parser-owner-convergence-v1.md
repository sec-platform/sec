---
schema: codex-development-work-package-v1
id: digest-parser-owner-convergence-v1
tracking: none
base: 77eee3b89ffe01d28519208c939289e06de3ae77
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: converge-legacy-sha256-parsers
    owner: digest-identity-owner
    ownedPaths:
      - config/repository/work-packages/digest-parser-owner-convergence-v1.md
      - src/adapters/runtime-state/workspace-state/content-addressed-workspace-cache.ts
      - src/adapters/toolchain/dependencies/runtime/dependency-transition/contract.ts
      - src/adapters/repository/source-program-model/repository-compilation-cache.ts
      - src/adapters/repository/source-program-model/repository-compilation-cache-provider.ts
      - src/adapters/self-hosting/control/continuation/runtime-store.ts
      - src/adapters/self-hosting/control/continuation/invalidation.ts
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
  - src/adapters/mutation/
  - src/adapters/providers/git-read/
  - src/adapters/release/
  - src/adapters/verification/
  - src/assurance/
acceptance:
  - legacy SHA-256 protocol values retain their exact algorithm spelling schema preimages paths and serialization
  - canonical SHA-256 representation checks delegate to contracts/digest.ts
  - content-addressed cache repository-compilation cache dependency-transition and continuation do not own duplicate SHA-256 regexes
  - Git object IDs and external provider digests remain outside this change
  - no persistent writer generation or migration policy changes
tests:
  - existing domain tests remain semantically applicable because only representation validation is deduplicated
---

# Digest parser owner convergence

This source-only successor removes duplicate SHA-256 spelling checks from six
legacy protocol owners without changing those protocols to BLAKE3.

The shared digest contract owns canonical algorithm-prefixed 256-bit text.
Each domain still owns what its digest means, how it is computed, where it is
stored, whether it is authoritative, and when its schema may migrate.

This is deliberately not an algorithm migration. In particular, filesystem
cache paths, continuation CAS objects, dependency transition evidence and
repository compilation cache records preserve their existing SHA-256 bytes.
