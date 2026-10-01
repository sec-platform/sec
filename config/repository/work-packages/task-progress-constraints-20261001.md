---
schema: codex-development-work-package-v1
id: task-progress-constraints-20261001
tracking: none
base: 4b469dbaa7965db76fc3f3dc4978c43457e335d4
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: constrain-waits-to-dependent-actions
    owner: engineering-guidance
    ownedPaths:
      - .agents/skills/task-delegation/SKILL.md
      - .agents/skills/worker-development/SKILL.md
      - .agents/skills/failure-recovery/SKILL.md
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/q4-candidate-analysis-scope-20261001.md
      - config/repository/work-packages/task-progress-constraints-20261001.md
forbiddenPaths:
  - AGENTS.md
  - LICENSE
  - LICENSES/
  - README.md
  - bun.lock
  - package.json
  - .github/
  - .documentation/
  - docs/
  - src/
  - tests/
  - crates/
acceptance:
  - This external-maintainer proposal issues no active Work, Gate, health or automatic integration authority
  - Bind each wait to a dependent action, prerequisite owner, observable resume condition and remaining legal work in the original task handoff
  - Keep independent authorized checkpoints moving without forced batching or weakening admission, shared writer ownership, settlement and hosted evidence budgets
  - Require actual scheduler start or resume and evidence rather than a sent message, running label or read skill claim
  - Reuse previously qualified successful paths only within unchanged environment, target and authorization; retain explicit safety and permission refusals
  - Preserve distinct coordinator, worker and failure-owner responsibilities without a new registry or claim of mechanical enforcement
  - Reuse independent prose review and unchanged control evidence; run no new runtime tests or full SourceProgram analysis
  - Complete canonical freeze, commit, independent branch publication and exact remote readback; root owns expected-head merge
# Existing control-boundary reference; no unchanged runtime test is selected.
tests:
  - tests/contract/document-control-plane-lifecycle.test.ts
---

# Action-scoped waiting and autonomous continuation

Clarify the existing engineering roles after a real scheduling failure. Waiting
blocks only dependent actions, preserves other authorized work, and names the
observable condition and owner that resume it. This prose does not manufacture
host admission, authority, process termination or successful execution.
