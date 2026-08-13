---
schema: codex-development-work-package-v1
id: controlled-pr-issue-disposition-single-writer-v1
tracking: issue-352
base: 93dde9e44bbcffdd7fa1d6be726df1725947f6e2
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - roadmap
  - verification-governance
tasks:
  - id: canonical-issue-disposition-completion-identity
    owner: development-integration-closeout-owner
    ownedPaths:
      - docs/work-packages/controlled-pr-issue-disposition-single-writer-v1.md
      - docs/work-packages/default-branch-health-repair-8f55bd9e900b2bbbfa4a71f83987420b4688e0be-9b49dde8a89251e9d2d153527267156efb617964d9944c928f18d1eb482ad3f5.md
      - docs/work-packages/operation-read-plan-authority-canary-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/unit/work-selection-live.test.ts
  - id: main-health-dispatch-producer-identity
    owner: main-health
    ownedPaths:
      - docs/development-governance.md
      - docs/verification-governance.md
      - platform/shared/ci-verification-revision.ts
      - platform/shared/tcb-closure-lock.ts
      - scripts/codex/main-health-observation.ts
      - scripts/codex/verification-session-github.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/unit/tcb-trust-root-contract.test.ts
      - tests/unit/verification-session-runtime.test.ts
forbiddenPaths:
  - .agents/
  - .codex/
  - .github/
  - .githooks/
  - AGENTS.md
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - docs/roadmap.md
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - platform/orchestrator/
  - scripts/codex/agent-operation-activation.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/verification-session.ts
  - scripts/run-work-package-gate.ts
  - source/
acceptance:
  - the package is bound to exact healthy main 93dde9e44bbcffdd7fa1d6be726df1725947f6e2 tree 2782d5a29ed4d4d5cefa497dd264d98d60688b25 and live Issue 352 current-spec revision sha256:363e771392f5b5e046a8e86cd9db9cf937b4cedc6cfc8b95ad9e1aaaecc07e89
  - the canonical WorkDecision receipt sha256:e47b007888375d5f59e1bdbf1c8051fd55b36bfd0f6c6a9a627a61638d5422a9 selects issue-352 and proves issue-346 already in main with no active work open pull request closeout residue or unhealthy MainHealth lane
  - this delta reconciles the roadmap package identity controlled-pr-issue-disposition-single-writer-v1 with the implementation integrated by trusted commit 41f72db071cbbd5cc9a9bfeaa9c2bcec855ca7d7 from candidate 0da31fc64837503412ccdeb7ada6871a5c6ba2f4 tree 7383e11c405ac1ce232d3cd7e8ef8cd404587237
  - the retired historical manifest issue-disposition-safety-v1 blob 21bdf73630e14e8c01ed7d9234cb88e334de04ea and digest sha256:96ae5edf43f7624e3062a57d8f5e81322019e03d9ca8c118e8b52f312f7ce2eb remain historical evidence only and are not restored aliased or treated as current authority
  - current exact main retains the zero-closing-authority IssueDisposition contract read-only GitHub reconciliation and sole VerificationSession consumer implemented by the historical package while the same canary repairs only the MainHealth provider-identity seam exposed by its first hosted PRE
  - controlled pull-request prose and provider closing references retain zero Issue close authority while the current post-main outcome remains progressed with effect none because no trusted completion assessment or conditional Issue mutation capability has been introduced
  - an unexpected provider closure retains typed manual-action-required only after exact pull-request and merge-commit causality and this package introduces no close reopen PATCH mutation effect-start terminal Issue receipt second coordinator or compatibility adapter
  - the selected manifest and rolling topology come from the same WorkDecision while the consumed Issue 346 manifest and temporary default-branch repair manifest are retired from the live registry without aliases and remain available only through immutable Git history
  - publication is progress-only and Issue 352 may remain open; the canonical manifest on exact new main is the Work Selection completion identity that makes issue-186 eligible without claiming a provider-side Issue close
  - unchanged IssueDisposition product behavior is not rerun; fresh assurance is limited to canonical manifest and document-control checks the MainHealth producer regression and its direct CI trust closure exact-head Review trusted transition and automatic new-main health
  - the MainHealth compiler admits a repository-dispatch check only when its observed workflow run title binds the exact sec-produce-main-health request identity; skipped jobs from activation verification-action or other dispatches are nonmatching provider noise and cannot lock or degrade the exact-main ledger
  - push and explicit MainHealth dispatch producers remain independently authenticated by the canonical GitHub Actions App workflow path exact workflow ref exact main SHA event and event-specific run title while same-event duplicates nonterminal canonical producers and conflicting recognized terminal outcomes still fail closed
  - the provider adapter carries the workflow run ID and display title as normalized check provenance rather than rewriting raw eventName or inferring dispatch action from conclusion and the MainHealth source digest binds the resulting canonical matching subset
  - exact candidate regression reproduces run 31683485879 where activate prepare PR 376 emitted a skipped sec main-health job on base main and proves that unrelated dispatch no longer changes a healthy ledger while an explicitly titled MainHealth dispatch with skipped nonterminal malformed or conflicting outcome remains locked
tests:
  - tests/unit/issue-disposition-contract.test.ts
  - tests/unit/issue-disposition-github.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/unit/work-selection-live.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/unit/tcb-trust-root-contract.test.ts
---

# Controlled pull-request IssueDisposition single-writer completion

Issue 352's product and integration behavior entered the trusted default branch in
`41f72db071cbbd5cc9a9bfeaa9c2bcec855ca7d7`. The historical package was later
retired normally, while the R14 roadmap introduced the more precise canonical
package identity `controlled-pr-issue-disposition-single-writer-v1`. Work Selection
correctly recognizes completion only through that exact package identity, so this
slice publishes the missing canonical manifest without recreating that implementation.
Its first real hosted PRE exposed one upstream MainHealth identity defect: an unrelated
repository dispatch contributes a skipped `sec/main-health` check on the same base SHA.
The bounded repair binds repository-dispatch producers to the canonical MainHealth run
title so another dispatch can no longer lock the ordinary lane.

The repository continues to reject lexical and provider closing authority in
controlled pull requests. `IssueDisposition` remains the unique lifecycle decision
owner, VerificationSession remains the sole integration coordinator, and GitHub
Issue PATCH is not treated as a conditional write. Until a separately trusted
completion assessment and provider capability exist, the only valid result is a
progress receipt with no Issue mutation. The next selected work is Issue 186, which
owns physical worktree closeout and its durable completion receipt.
