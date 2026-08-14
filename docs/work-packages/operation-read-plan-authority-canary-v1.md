---
schema: codex-development-work-package-v1
id: operation-read-plan-authority-canary-v1
tracking: issue-346
base: 93491f07a3b6c8fc94880be3bb6d18f41cda443b
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - verification-governance
tasks:
  - id: exact-read-observation-reuse
    owner: agent-operation-compiler-owner
    ownedPaths:
      - scripts/codex/agent-operation-activation.ts
      - scripts/codex/operation-read-plan.ts
      - scripts/codex/task-capsule.ts
      - tests/contract/operation-read-plan.test.ts
      - tests/unit/agent-operation-activation.test.ts
  - id: canary-authority-and-control
    owner: development-governance-owner
    ownedPaths:
      - docs/development-governance.md
      - docs/work-packages/default-branch-health-repair-5c5200fddddd9e6601bb514d61141579867f1a3b-67789605f8d93b4ef6027add252b1c84819ba4ef38869e3222dedc34b73c11db.md
      - docs/work-packages/operation-read-plan-authority-canary-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/documentation-authority.test.ts
  - id: generated-trust-closure
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/unit/tcb-trust-root-contract.test.ts
forbiddenPaths:
  - .agents/
  - .codex/
  - .githooks/
  - AGENTS.md
  - bun.lock
  - docs/authority.json
  - docs/external-provider-policy.md
  - docs/governance/external-capability-ledger.yaml
  - docs/roadmap.md
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - scripts/codex/worktree-physical-closeout.ts
  - source/
acceptance:
  - the canary is bound to exact main 93491f07a3b6c8fc94880be3bb6d18f41cda443b tree 9658bc583ea826c730def70ed407269c90e0de83 and Issue 346 current spec sha256 b1b350a7bc0a9cc741fee5d8688580a419ad737c028a383e33153844fee5e729
  - one manifest-only draft PR obtains its immutable hosted PRE from the exact default-branch producer before implementation and the exact implementation head later obtains FINAL on the same linear PR
  - the superseded default-branch MainHealth repair manifest is deleted in the same proposal and no second active Work Package remains
  - the activation resolver returns the exact manifest Git blob revision and raw content digest from its already validated candidate control observation and Task Capsule preserves those values without reopening the path
  - Operation Read Plan consumes that retained observation directly and no longer performs a second rev-parse cat-file type or cat-file blob sequence for the same manifest revision
  - the read receipt still binds exact path owner Git blob revision reason and raw content digest and any activation manifest revision or digest drift fails closed
  - no cache second resolver compatibility adapter caller-supplied identity or new authority is introduced and Task Capsule Read Plan remain unbound planning content with zero effect authority
  - a focused executable contract proves the production handoff carries one exact manifest observation and rejects missing malformed or drifted values while the trusted activation provider and TCB closure remain current
  - this is the first genuine Issue 346 canary and records the before and after process-read delta without claiming one diagnostic sample is a distribution or closing Issue 346 before all three real operations and the maintainer-mutation canary exist
  - only the exact affected closure is executed during authoring and identical fresh results are reused while Docker image browser cache dependency cache unrelated tests and full verification remain untouched
  - independent exact-head Review is required after the tree is frozen and any finding changes the tree and invalidates the Review before integration
  - after merge exact new-main readback retires the candidate branch worktree local and remote refs through the canonical physical closeout path and automatically resumes the next WorkDecision epoch
tests:
  - tests/unit/agent-operation-activation.test.ts
  - tests/unit/agent-task-capsule.test.ts
  - tests/unit/agent-operation-read-plan.test.ts
  - tests/unit/skill-applicability-decision.test.ts
  - tests/contract/operation-read-plan.test.ts
  - tests/contract/skill-applicability.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/unit/tcb-trust-root-contract.test.ts
---

# Operation Read Plan exact observation reuse canary

This first real Issue 346 canary removes a repeated physical Git read from the
normal trusted Task Capsule to Operation Read Plan path. The hosted activation
resolver already validates and reads the candidate manifest; its exact blob
identity and raw byte digest are therefore retained and consumed downstream
instead of reopening the same repository object.

The slice does not add a cache or weaken readback. It narrows one operation to
one immutable observation, preserves owner and digest verification, and uses
the repository's existing local three-role GitHub Actions provider for PRE and
FINAL without rebuilding the frozen Linux image.
