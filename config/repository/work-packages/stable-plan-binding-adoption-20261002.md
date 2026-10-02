---
schema: codex-development-work-package-v1
id: stable-plan-binding-adoption-20261002
tracking: none
base: 8f067190a5402b39eba48a6df3ae27021a887369
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: adopt-canonical-stable-plan-binding
    owner: document-control-plane
    ownedPaths:
      - "src/adapters/self-hosting/control/agent/agent-operation-activation.ts"
      - "src/adapters/self-hosting/control/documentation/document-control-plane-contract.ts"
      - "tests/unit/document-control-plane-projection.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/reader-preparation-adoption-20261002.md"
      - "config/repository/work-packages/stable-plan-binding-adoption-20261002.md"
forbiddenPaths:
  - ".github/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Reader-first source closure has actually landed on main8f067190 with exact native tree1d69a759; this successor remains a v1 proposal and does not create active v3 work"
  - "Preserve the three reviewed postimages of stable-plan-binding patch850230f6af5ebdebd86131bc1d13dd1e580fd6b0fea2b56754e812a7a98217cd apart from canonical equivalent import normalization"
  - "Activation consumes the existing canonical rolling base/tree and raw manifest identity instead of headings alone; reject mismatched or stale bindings"
  - "Preserve v1 behavior, unique current active package and all original WorkDecision/operation/provider admission requirements"
  - "Only the current trusted-base compiler generates successor proposal projections after verifying the explicitly staged retirement of the exact prior manifest"
  - "Actual original PRE, exact subject independent review, required security checks and immutable expected-head merge evidence remain required; no ordinary Gate/MainHealth or v3 activation is claimed"
tests:
  - "tests/unit/document-control-plane-projection.test.ts"
  - "tests/unit/agent-operation-activation.test.ts"
---

# Adopt canonical stable plan binding

Preparation only until the current-base compiler can execute in the original admitted workspace.
