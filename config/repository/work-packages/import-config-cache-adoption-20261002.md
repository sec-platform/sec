---
schema: codex-development-work-package-v1
id: import-config-cache-adoption-20261002
tracking: none
base: 8271988e92e130a30f3bde530013217d0ac96b28
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: bind-import-config-content
    owner: import-normalization
    ownedPaths:
      - "src/adapters/self-hosting/development/runner/import-organizer.ts"
      - "tests/unit/import-organizer-selection.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/dependency-diagnostics-adoption-20261002.md"
      - "config/repository/work-packages/import-config-cache-adoption-20261002.md"
forbiddenPaths:
  - ".github/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Preserve the independently reviewed two source postimages published at checkpoint 743a400f4a97d4672f3a01322c98b2ef75e97936"
  - "Bound the existing raw configuration parse cache to one slot and require fresh content read plus digest before reuse"
  - "Clone successful cached raw configuration before TypeScript inheritance resolution and bind actual inherited/config-resolution observations into plan identity"
  - "Preserve parse errors, correction recovery, workspace separation, original normalization kernel and original index/publication owners"
  - "Do not claim atomic filesystem observation, hard byte/RSS bounds, general Issue423 closure or performance improvements from this narrow content-binding repair"
  - "Use original trusted-main proposal compiler, truthful PRE, exact independent review and protected expected-head adoption/readback"
tests:
  - "tests/unit/import-organizer-selection.test.ts"
---

# Bind import normalization to observed configuration contents

This bounded repair removes the original unbounded raw-parse map and preserves fresh root/inherited configuration observations in the existing normalization plan. Source review and focused configuration evidence do not sign ordinary Work, MainHealth or full Gate authority.
