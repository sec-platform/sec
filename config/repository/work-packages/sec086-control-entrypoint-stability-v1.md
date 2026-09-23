---
schema: codex-development-work-package-v1
id: sec086-control-entrypoint-stability-v1
tracking: none
base: 18e43293c683481f4ee965365cbe4ff75a1853cf
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: preserve-document-control-stable-entrypoint
    owner: sec086-convergence-owner
    ownedPaths:
      - config/repository/work-packages/sec086-control-entrypoint-stability-v1.md
      - config/repository/current-state.yaml
      - src/adapters/self-hosting/control/documentation/document-control-plane.ts
      - src/control/documentation/document-control-plane.ts
      - src/control/documentation/sec.module.json
      - tests/unit/document-control-entrypoint-stability.test.ts
forbiddenPaths:
  - .github/
  - .documentation/
  - docs/
  - AGENTS.md
  - package.json
  - bun.lock
  - config/repository/active-work-package.md
  - config/repository/rolling-plan.md
acceptance:
  - current-state resolver bytes equal the live-main stable authority address
  - the physical self-hosting documentation module remains the sole capability and domain owner
  - the old stable CLI path is a zero-authority facade that only invokes the owner-exported CLI runner
  - no provider writer schema recovery or work-selection authority is duplicated
tests:
  - tests/unit/document-control-entrypoint-stability.test.ts
---

# Stable document-control entrypoint

SEC-086 moved the documentation control owner into the self-hosting adapter
tree. The live current-state contract, however, names the pre-move CLI path as
its stable resolver address. A physical relocation must not force that root
authority file to change in the same candidate.

This packet restores the live-main current-state bytes and retains only a thin
executable facade at the stable address. All implementation and capability
ownership remains in the self-hosting documentation module.
