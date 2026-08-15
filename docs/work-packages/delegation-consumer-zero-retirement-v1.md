---
schema: codex-development-work-package-v1
id: delegation-consumer-zero-retirement-v1
tracking: issue-275
base: 0137447c4b3821decfa5a6c332d8e7c5f6587ad6
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - roadmap
  - verification-governance
tasks:
  - id: bounded-skill-terminal-boundary
    owner: development-governance-owner
    ownedPaths:
      - AGENTS.md
      - docs/development-governance.md
      - tests/contract/agent-skills.test.ts
  - id: selected-work-completion-projection
    owner: roadmap-owner
    ownedPaths:
      - docs/roadmap.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/default-branch-health-repair-f58d7395768283f4e032a8f33543d13f69f81ea5-603fa7978e3894ce8f020d52a288d46f6220e7fb232cd39e1123e9044fb23add.md
      - docs/work-packages/delegation-consumer-zero-retirement-v1.md
      - docs/work-packages/git-worktree-physical-closeout-v1.md
  - id: hosted-work-selection-credential-boundary
    owner: development-work-selection-owner
    ownedPaths:
      - scripts/codex/work-selection.ts
      - tests/unit/work-selection-live.test.ts
  - id: canonical-git-child-environment-boundary
    owner: verification-session-branch-closeout-authority
    ownedPaths:
      - scripts/codex/branch-lifecycle-command.ts
      - tests/unit/branch-lifecycle-contract.test.ts
  - id: independent-review-stability-provider-boundary
    owner: verification-governance-owner
    ownedPaths:
      - docs/verification-governance.md
      - platform/shared/review-stability-contract.ts
      - tests/unit/review-stability-contract.test.ts
  - id: maintainer-review-wakeup-and-hosted-locator
    owner: verification-session-branch-closeout-authority
    ownedPaths:
      - scripts/codex/verification-session-github.ts
      - scripts/codex/verification-session.ts
      - tests/unit/verification-session-runtime.test.ts
  - id: trusted-closure-regeneration
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
      - tests/contract/tcb-closure-lock.test.ts
forbiddenPaths:
  - .github/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - platform/shared/agent-skill-contract.ts
  - platform/shared/agent-task-capsule-contract.ts
  - platform/shared/physical-no-follow.ts
  - platform/shared/workspace-write-lease.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/worktree-physical-closeout.ts
  - scripts/run-work-package-gate.ts
  - source/
acceptance:
  - the package is the WorkDecision continue-active issue-275 canary bound to exact healthy main 0137447c4b3821decfa5a6c332d8e7c5f6587ad6 tree 449585fe5c3f9717e70f3623664e4475314fa059 and current-spec revision sha256:a0b69da8aa889ba56cf4743aed2719b739d1332ef6426272e763b04059984ca6
  - the expanded manifest-only repair proposal receives a new genuine trusted default-branch PRE before Review-provider repair implementation and the exact final implementation head receives its matching FINAL; superseded PRE FINAL and cancelled Session evidence remain historical only
  - the repository retains exactly eight bounded Skills at this completion boundary and task-delegation continues to route to sec-task-delegation because trusted Task Capsule facts can reject overlap but cannot decide whether parallel benefit exceeds coordination cost
  - no deterministic owner is fabricated for an irreducible judgement and future delegation retirement requires a real production decision consumer that derives both delegate and no-delegation outcomes without caller or model inference
  - Phase A applicability and the issuer-bound zero-or-one Read Plan remain adopted; ordinary deterministic behavior remains zero-Skill and no behavior-to-Skill bijection or catch-all guidance owner returns
  - the completed default-tree MainHealth repair package and the consumed git-worktree-physical-closeout-v1 package are retired as one-use activation artifacts; issue-186 itself and its roadmap/current-spec identity remain open for a future WorkDecision-selected slice after issue-271, and this package claims no new issue-186 completion
  - trusted hosted Work Selection removes ambient Git configuration and every askpass or SSH credential override before using the sole canonical gh auth git-credential argv prefix for exact default-ref and branch-inventory observations
  - branch lifecycle selection admits only branch-bound non-default worktrees; detached trusted checkouts and detached scratch subjects remain outside ref closeout authority
  - the roadmap records issue-275 completion without erasing the retained delegation boundary and removes issue-275 only from successor prerequisites that completion satisfies
  - AGENTS and development-governance describe the completed canary and the current-eight terminal-seven boundary without temporal contradictions or an unearned deterministic cutover claim
  - focused contracts prove the retained delegation route and hostile ambient credential environment; no test weakens the Task Capsule authority or independently self-signs PRE FINAL Review or Gate evidence
  - Review stability classifies a trusted Codex App clean result from one exact reviewed-commit locator provider-resolved to the candidate head and tree plus the stable clean-verdict semantic prefix; bounded congratulation text may vary while findings malformed or duplicate locators wrong App identity and head or tree drift remain fail-closed
  - authenticated maintainer-side prepare publishes or reuses one session and head-bound at-least-once @codex review wake-up only after local quick verification passes; the hosted Actions producer publishes an exact non-triggering locator and never asks an unconnectable github-actions principal to activate Codex
  - wake-up and locator comments are signal and projection only; neither can issue Review Scope Gate merge or effect authority, and one real provider clean variant other than Bravo completes the exact-head Review canary
  - test impact selects the declared development-work-selection and governance closures and the generated TCB lock changes only through its canonical writer
  - after merge exact new-main MainHealth and local remote ref worktree Provider and control-plane readback close the candidate without a second candidate worktree ref fleet or unnecessary Linux rerun
tests:
  - tests/contract/agent-skills.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/test-impact.test.ts
  - tests/unit/agent-operation-activation.test.ts
  - tests/unit/branch-closeout-receipt.test.ts
  - tests/unit/branch-closeout-rest-comments.test.ts
  - tests/unit/branch-lifecycle-contract.test.ts
  - tests/unit/branch-lifecycle-temp-repo.test.ts
  - tests/unit/integration-authorization-publication.test.ts
  - tests/unit/local-main-closeout.test.ts
  - tests/unit/review-stability-contract.test.ts
  - tests/unit/sec-merge-bootstrap.test.ts
  - tests/unit/tcb-trust-root-contract.test.ts
  - tests/unit/verification-action-ci-contract.test.ts
  - tests/unit/verification-candidate-tree.test.ts
  - tests/unit/verification-session-contract.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/unit/work-selection-live.test.ts
---

# Skill System V2 terminal-boundary canary

This package completes the current Skill corpus convergence without pretending
that typed scope facts decide a runtime benefit-versus-coordination tradeoff.
The Task Capsule remains the deterministic authority for scope, ownership,
capability and dependency facts; `sec-task-delegation` remains the bounded
heuristic owner for the one judgement those facts do not make.

The manifest is timeless frozen proposal content. Implementation may begin only
after an external trusted PRE for this exact proposal, and only a matching FINAL
for the exact implementation head may authorize downstream verification.
