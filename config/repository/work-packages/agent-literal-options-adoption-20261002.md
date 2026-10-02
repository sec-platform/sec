---
schema: codex-development-work-package-v1
id: agent-literal-options-adoption-20261002
tracking: none
base: 8ae14bee8a7f8958bc02d30bc2678b1fe855428e
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: preserve-agent-literal-option-selection
    owner: agent-control
    ownedPaths:
      - "src/adapters/self-hosting/control/agent/operation-read-plan.ts"
      - "src/adapters/self-hosting/control/agent/task-capsule-host.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/source-run-alias-adoption-20261002.md"
      - "config/repository/work-packages/agent-literal-options-adoption-20261002.md"
forbiddenPaths:
  - ".github/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Preserve both independently reviewed published source postimages from checkpoint 36766add90e5fb2987a7235c09f8b75507fb8bc1"
  - "Retain the complete option allowlist rejection before selecting the literal input, plan or capsule key; candidate-root keeps its existing mapping"
  - "Preserve exact missing-value, duplicate-option, receiver, output and exit behavior without adding registration, test deletion or permission changes"
  - "Adopt only source-preserving literal key selection; no claim of fixing a security vulnerability or closing a historical CodeQL alert"
  - "Use original trusted-main proposal compiler and truthful PRE classification, bounded independent source review and protected expected-head adoption/readback"
tests:
  - "tests/unit/agent-operation-read-plan.test.ts"
  - "tests/unit/agent-task-capsule.test.ts"
---

# Preserve explicit agent CLI option keys

The current parsers already reject every argument outside their complete allowlists. Explicit literal key selection preserves that admitted mapping while removing unnecessary dynamic string slicing and type assertions. This source-only proposal does not issue Work, MainHealth or Gate authority.
