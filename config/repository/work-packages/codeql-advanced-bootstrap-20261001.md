---
schema: codex-development-work-package-v1
id: codeql-advanced-bootstrap-20261001
tracking: none
base: af772fa26b304f1d484011de88e6536160d1dbc4
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: stage-advanced-codeql-baseline
    owner: github-code-scanning
    ownedPaths:
      - .github/codeql/codeql-config.yml
      - .github/workflows/codeql-analysis.yml
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/task-progress-constraints-20261001.md
      - config/repository/work-packages/codeql-advanced-bootstrap-20261001.md
forbiddenPaths:
  - AGENTS.md
  - docs/
  - .documentation/
  - .agents/
  - .codex/
  - src/
  - tests/
  - package.json
  - bun.lock
  - LICENSE
  - LICENSES/
  - crates/
acceptance:
  - This external-maintainer proposal issues no active Work, Gate, health or automatic integration authority
  - Stage one official CodeQL workflow with workflow_dispatch only so Default setup remains the actual PR protection until the separately approved switch
  - Preserve Actions and JavaScript TypeScript coverage, none build mode, security-extended queries, local threat model and all existing scan path exclusions
  - Grant only contents read and security-events write to the analysis job and pin the official checkout and CodeQL actions
  - Do not execute candidate build scripts, copy PR SARIF onto main, manufacture checks, change branch protection, delete old analyses or weaken security thresholds
  - Consume bounded YAML and workflow-policy assertions, exact source review and the unchanged trusted-base PRE on the final candidate without claiming full runtime validation
  - Bind the main Advanced baseline to the actual merged revision before the separate final PR enables PR plus weekly and manual triggers
  - Preserve all unrelated SourceProgram, CLI, workspace initialization, skills and cache work
  - Root retains exact-parent main adoption and remote security-setting coordination
  - Reuse the existing native code-scanning authority contract without adding a second result projection owner or normative documentation
  - Obtain actual remote ref, tree, protection, default-setup and analysis readback before reporting migration completion
tests:
  - tests/contract/ci-contract.test.ts
---

# Stage the official Advanced CodeQL baseline workflow

This bootstrap is the first bounded stage of the user-approved CodeQL cadence
migration. The final trigger change follows a real main baseline. The unchanged
CodeQL ruleset remains responsible for security merge protection throughout.
