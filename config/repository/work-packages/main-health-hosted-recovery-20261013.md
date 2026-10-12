---
schema: codex-development-work-package-v1
id: main-health-hosted-recovery-20261013
tracking: none
base: 0536dca0da634fe26fe175bc4694883f966ae356
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: restore-exact-main-health-producer
    owner: verification-ci
    ownedPaths:
      - ".github/workflows/compiler-pr-validation.yml"
      - "tests/contract/ci-contract.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/release-parent-atomic-adoption-20261002.md"
      - "config/repository/work-packages/main-health-hosted-recovery-20261013.md"
forbiddenPaths:
  - "src/"
  - "docs/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Move only the exact-main MainHealth leaf to GitHub-hosted Ubuntu; preserve every existing check, permission, request binding, checkout and result identity"
  - "Check coordinator and joined producer runner selectors from actual workflow bytes, removing the duplicated test-only role map"
  - "Consume the original trusted-main WorkDecision failure and retain main-health-locked as an unresolved old-main result, never a green check or integration grant"
  - "Use the original proposal-only compiler and canonical commit owner; the proposal carries no Work, MainHealth, Session or integration authority"
  - "Bind independent final review and protected checks to the exact recovery candidate, then merge by expected head with frozen base as sole parent and exact candidate tree"
  - "After adoption, request the original MainHealth producer once for the new main and consume its actual result; preserve genuine failures and rebind the retained integration candidate"
tests:
  - "tests/contract/ci-contract.test.ts"
---

# Restore the exact-main MainHealth producer

The current default has no MainHealth check and no registered self-hosted runner. Its MainHealth job performs exact-main source checks and does not acquire the isolated candidate runtime. An independently scheduled hosted leaf restores that producer while retaining its original checks and authenticated GitHub result contract. This bounded trust-root migration does not adopt the separate repository integration candidate or claim that the new main is healthy before the producer runs.
