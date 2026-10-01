---
schema: codex-development-work-package-v1
id: codeql-advanced-cadence-20261001
tracking: none
base: 529a2f1f1ea802d71135de7aba5b8f77d2923924
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: enable-approved-codeql-cadence
    owner: github-code-scanning
    ownedPaths:
      - .github/workflows/codeql-analysis.yml
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/codeql-advanced-bootstrap-20261001.md
      - config/repository/work-packages/codeql-advanced-cadence-20261001.md
forbiddenPaths:
  - AGENTS.md
  - docs/
  - .documentation/
  - .agents/
  - .codex/
  - .github/codeql/
  - src/
  - tests/
  - package.json
  - bun.lock
  - LICENSE
  - LICENSES/
  - crates/
acceptance:
  - This external-maintainer proposal issues no active Work, Gate, health or automatic integration authority
  - Enable native pull_request checks for main plus a weekly Monday 0317 UTC full main scan and workflow_dispatch without a push trigger
  - Preserve the adopted official CodeQL jobs, pinned actions, language matrix, build mode, analysis configuration and least privilege permissions byte for byte below the trigger section
  - Require a real successful Advanced main baseline on the adopted bootstrap revision before publishing this final pull request
  - Preserve existing CodeQL ruleset thresholds and every branch protection without fake PASS, skipped-security substitution or cross-ref SARIF reuse
  - Consume the unchanged trusted-base PRE and independent exact-head review while retaining any manual-bootstrap-required verdict instead of declaring Gate PASS
  - The approved cadence intentionally delays main inventory refresh until the next successful weekly or manual scan while every PR continues to receive actual security analysis
  - Verify the exact merged main, disabled Default setup, successful Advanced PR and main analyses, unchanged protections and absence of a new main push scan
  - Preserve all legacy analysis records unless the user separately confirms their deletion
  - Keep SourceProgram, CLI, workspace initialization, skills, cache work and normative documentation outside this write scope
tests:
  - tests/contract/ci-contract.test.ts
---

# Enable the approved native CodeQL cadence

GitHub CodeQL owns analysis and alerts. The native code-scanning ruleset keeps
its existing merge thresholds. Only native workflow triggers change after the
new Advanced main baseline is established; no result projection is introduced.
