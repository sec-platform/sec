---
schema: codex-development-work-package-v1
id: release-parent-atomic-adoption-20261002
tracking: none
base: 0394d330eb765f0b0e2fdf8a41f63bc78adda7cd
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: adopt-release-parent-exact-checkout-boundary
    owner: verification-ci
    ownedPaths:
      - ".github/workflows/compiler-release-validation.yml"
      - "src/adapters/verification/platform/ci/contract/core.ts"
      - "tests/contract/ci-contract.test.ts"
      - "tests/integration/release-parent-checkout.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/linux-provider-native-owner-adoption-20261002.md"
      - "config/repository/work-packages/release-parent-atomic-adoption-20261002.md"
forbiddenPaths:
  - "crates/"
  - "package.json"
  - "bun.lock"
  - "docs/"
acceptance:
  - "Adopt all four exact independently reviewed postimages from published c16224c8 without splitting the release workflow, CI step contract and direct regressions"
  - "Require an exact single-parent release subject, exact requested commit and current trusted-default verifier boundary; verify the checked-out parent commit and tree locally before any build or release verification"
  - "Align the release step contract with the existing build and artifact steps, retaining all workflow credential, permission, runner and publication boundaries"
  - "Preserve all unrelated current main changes; source reviews and five focused cases with fifty-six assertions remain source evidence, not a full Gate or release authorization"
  - "Use the approved task-local transport only to call the original proposal freeze, documentation producer and canonical commit owners; the tool issues no Work, Gate or effect authority"
  - "Retain current documentation source and projection bytes; do not launch release dispatch, deployment or package publication as part of source adoption"
  - "Consume truthful original PRE and independent exact final binding review, then required protected checks, expected-head merge and authoritative main tree/soleparent readback"
tests:
  - "tests/contract/ci-contract.test.ts"
  - "tests/integration/release-parent-checkout.test.ts"
---

# Adopt the atomic release parent verification closure

The preserved four-file release validation fix is adopted together under the existing maintainer trust-root migration contract. Native checkout identity and parent/tree checks replace a redundant transport fetch without weakening the single-parent integration contract. Source adoption is separate from production release, TestResponsibility/Q4, MainHealth and ordinary Gate qualification.
