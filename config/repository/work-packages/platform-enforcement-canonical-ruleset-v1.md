---
schema: codex-development-work-package-v1
id: platform-enforcement-canonical-ruleset-v1
tracking: issue-311
base: f29db36c3f13135072d14c06e21348b44915d0ef
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: require-canonical-main-authority-rulesets
    owner: verification.integration-platform
    ownedPaths:
      - config/repository/work-packages/platform-enforcement-canonical-ruleset-v1.md
      - src/adapters/verification/platform/ci/runtime/verification-session-github.ts
      - src/adapters/self-hosting/control/integration/platform-policy.ts
      - tests/unit/verification-session-runtime.test.ts
      - tests/unit/integration-platform-policy.test.ts
forbiddenPaths:
  - .github/workflows/
  - config/repository/active-work-package.md
  - config/repository/rolling-plan.md
  - config/repository/work-selection.md
acceptance:
  - platform enforcement is available only after canonical MainAuthorityRuleset semantic validation over GitHub effective branch rules and detailed rulesets
  - a readable but incomplete unrelated or noncanonical ruleset inventory is blocked and never projected as available
  - GitHub 403 or any semantic ruleset mismatch is fail-closed for merge authorization
  - unavailable platform enforcement is no longer admitted by integration policy
  - no-bypass is claimed only from the canonical authority receipt, never from a generic ruleset list digest
  - exact-head CAS merge remains necessary but not sufficient
tests:
  - tests/unit/verification-session-runtime.test.ts
  - tests/unit/integration-platform-policy.test.ts
  - tests/unit/main-authority-ruleset-contract.test.ts
---

# Canonical platform enforcement

把 GitHub“能读到 rulesets”与“主干真的受 SEC canonical authority ruleset 强制”分开。VerificationSession 复用现有 MainAuthorityRuleset 合同，只有 exact default branch effective rules 与详细 ruleset 同时证明两层 canonical authority/principal 结构时才允许 merge。
