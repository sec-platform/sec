---
schema: codex-development-work-package-v1
id: dependency-diagnostics-adoption-20261002
tracking: none
base: 27a21faa8288cb80b674ad7153e4a46274e902f9
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: preserve-dependency-staging-failure-categories
    owner: compiler-dependencies
    ownedPaths:
      - "src/adapters/toolchain/dependencies/runtime/project-runtime.ts"
      - "src/contracts/failure-inspection.ts"
      - "tests/unit/dependency-staging-diagnostic.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/agent-literal-options-adoption-20261002.md"
      - "config/repository/work-packages/dependency-diagnostics-adoption-20261002.md"
forbiddenPaths:
  - ".github/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Preserve exact independently reviewed published source postimages from checkpoint a8dc929ed47f0dcd6ea2fedc0cadd96f517f2f67"
  - "Preserve primary materialization and cleanup failure categories through bounded original failure-inspection and dependency diagnostic owners"
  - "Admit only module-private whitelisted own data string codes after proxy rejection; do not print arbitrary messages, paths, causes or details"
  - "Keep IMPORT-AUTHORITY-004, original settlement attempt and stored prepared/stage-intent recovery identities unchanged"
  - "Do not install dependencies, retry or claim repaired underlying staging/cleanup failures merely because diagnostic categories become observable"
  - "Use original trusted-main proposal compiler, truthful PRE, exact independent review and required protected checks followed by expected-head and main tree readback"
tests:
  - "tests/unit/dependency-staging-diagnostic.test.ts"
---

# Preserve bounded dependency staging failure categories

The original dependency admission diagnostic discarded the distinguishable primary and cleanup failure categories. This bounded diagnostic repair preserves safe finite codes without expanding recovery authority, retries, public schemas or stored state. It does not issue ordinary Work, MainHealth or Gate qualification.
