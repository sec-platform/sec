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
  - documentation-registry
  - external-provider
  - verification-governance
tasks:
  - id: operation-read-plan-read-once
    owner: development-governance-owner
    ownedPaths:
      - docs/development-governance.md
      - scripts/codex/agent-operation-activation.ts
      - scripts/codex/operation-read-plan.ts
      - scripts/codex/task-capsule.ts
      - tests/contract/operation-read-plan.test.ts
      - tests/unit/agent-operation-activation.test.ts
  - id: local-linux-provider-github-cli-capability
    owner: external-capability-governance-owner
    ownedPaths:
      - docs/external-provider-policy.md
      - docs/governance/external-capability-ledger.yaml
      - docs/scripts/docs-doctor-ledgers.ts
      - platform/shared/ci-verification-revision.ts
      - scripts/codex/local-github-actions-runner.ts
      - tests/contract/docs-doctor-ledgers.test.ts
      - tests/unit/local-github-actions-runner.test.ts
  - id: operation-read-plan-control-transition
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/default-branch-health-repair-5c5200fddddd9e6601bb514d61141579867f1a3b-67789605f8d93b4ef6027add252b1c84819ba4ef38869e3222dedc34b73c11db.md
      - docs/work-packages/operation-read-plan-authority-canary-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/documentation-authority.test.ts
  - id: trusted-bootstrap-nested-sut-materialization
    owner: verification-governance-owner
    ownedPaths:
      - .github/workflows/sec-trusted-bootstrap.yml
      - scripts/ci-verification.ts
      - tests/contract/ci-contract.test.ts
      - tests/unit/ci-verification-execution.test.ts
  - id: operation-read-plan-tcb-closure
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
  - docs/roadmap.md
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - scripts/run-work-package-gate.ts
  - source/
acceptance:
  - exact main 93491f07a3b6c8fc94880be3bb6d18f41cda443b tree 9658bc583ea826c730def70ed407269c90e0de83 and failed activation run 31834449977 job 94877566196 are bound; blocker sha256:cc77ee9616e6fb66359d80ee3c48fe4c6ac90eea2e9b9292da664af1a670fd42 is independently reproduced as current-spec-provider-unavailable from the trusted Linux checkout because frozen v7 has no gh executable
  - the repair adds only the missing API client using official GitHub CLI 2.97.0 linux amd64 archive sha256 a2c9b8497e1f85b1ad0dfcb78b5a622e098801b8e461e459e88e1ee12f018112; GitHub Actions runner 2.336.0 Bun 1.3.14 and Node LTS 24.19.0 remain at their current exact releases and are not churned
  - the Docker recipe retains existing Ubuntu Node and runner layers byte-for-byte then appends the GitHub CLI layer; the observed warm rebuild reuses every earlier layer and completes in 22 seconds while verifying archive digest and actual gh version before image publication
  - the final active image tag is sec-actions-runner:2.336.0-trust-domains-node24-python312-gh297-archive-v8 and exact image ID is sha256:418e9f00110157ff610061685f9175a1af6966baa77e6d153eb43bd49893f63f; production validation requires exact ID plus GitHub CLI version and digest labels before any registration token effect
  - the hosted provider revision that invalidates Action and Evidence identity binds GitHub CLI 2.97.0 its exact archive SHA-256 and the exact v8 image ID; a ledger or image change without the same revision and CI contract update fails closed
  - image rebuild is triggered only by the canonical image capability tuple covering base runner Node GitHub CLI Python system libraries sandbox entrypoint and labels; ordinary source package lock TypeScript Prettier Playwright test and workflow deltas invalidate only their own nodes and never rebuild this image
  - activation retains the exact manifest Git blob OID and raw-byte digest from its first physical read and carries both through the trusted Task Capsule observation; OperationReadPlan consumes that observation without a second rev-parse cat-file type or cat-file blob subprocess
  - the downstream read receipt binds the same manifest path revision and digest already authenticated by activation; any head tree manifest pointer digest or maintainer mutation drift remains typed fail-closed and cannot be hidden by cache reuse
  - failed trusted bootstrap run 31840903892 is bound as the regression input; its candidate SUT checkout was exact and clean but appeared as the sole untracked candidate-sut directory inside the trusted base checkout, so production excludes only that separately authenticated exact Git root while retaining full untracked and ignored physical cleanliness for every other base path and for the candidate itself
  - failed trusted bootstrap run 31842961300 is bound as the persistent-runner transport regression input; PRE SUT and FINAL evidence roots live only under runner.temp and bind both run_id and run_attempt, so a failed attempt cannot collide with or authorize a later attempt and runner lifecycle cleanup owns all transport residue
  - v7 is recorded as superseded by v8 but retained until independent image-retirement authority proves zero references; ordinary stop and this operation do not prune Docker globally or delete unrelated images containers volumes or caches
  - historical v6 v4 and v3 retirement records bind the immutable v7 replacement image ID rather than the mutable current-image constant, while only the v7 to v8 record binds the active v8 ID; future provider upgrades cannot rewrite an earlier retirement decision
  - no Playwright browser package or binary is installed or executed because this delta has no browser/runtime impact; no unchanged failed hosted attempt is repeated
  - focused activation read-plan provider ledger docs typecheck imports diff test-impact TCB and exact repository audit closures pass; TCB closure is regenerated exactly once after source stabilization and current on the committed head
  - because the ordinary PRE issuer is the failed provider capability being repaired, the existing maintainer bootstrap bridge may integrate only the single-parent independently reviewed exact head and tree; this does not mint a fake PRE or claim the failed activation passed
  - after exact new-main readback the v8 provider reaches exact three-role active census and the trusted container resolves WorkDecision; the next three real selected operations consume issuer-bound PRE and FINAL ReadPlan receipts and one real maintainer-mutation observation before issue 346 closes
  - after new-main readback this worktree branch remote ref and remote-tracking ref close through exact physical and ref readback, then WorkDecision advances automatically to issue 352 without requiring user reauthorization
tests:
  - tests/unit/agent-operation-activation.test.ts
  - tests/contract/operation-read-plan.test.ts
  - tests/unit/local-github-actions-runner.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/docs-doctor-ledgers.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/unit/tcb-trust-root-contract.test.ts
  - tests/unit/ci-verification-execution.test.ts
---

# Operation Read Plan Authority Canary

This package removes one proven duplicate manifest read and repairs the exact local Linux capability required to issue its trusted receipts. The post-merge real-operation canaries remain the completion authority for Issue 346.
