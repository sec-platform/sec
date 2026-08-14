---
schema: codex-development-work-package-v1
id: git-worktree-physical-closeout-v1
tracking: issue-186
base: 4c2dfbac5bfd5a2edf38e5ec7e8c6ed394c152dd
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - roadmap
  - semantic-mutation
  - verification-governance
tasks:
  - id: git-worktree-physical-closeout-owner
    owner: development-integration-closeout-owner
    ownedPaths:
      - docs/development-governance.md
      - docs/work-packages/controlled-pr-issue-disposition-single-writer-v1.md
      - docs/work-packages/git-worktree-physical-closeout-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - scripts/codex/worktree-physical-closeout-contract.ts
      - scripts/codex/worktree-physical-closeout.ts
      - platform/shared/test-impact-rules/verification.ts
      - platform/shared/test-impact-rules/semantic.ts
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/tcb-trust-root-contract.ts
      - platform/shared/ci-trust-root-registry.json
      - platform/shared/physical-no-follow.ts
      - platform/shared/workspace-write-lease.ts
      - tests/unit/worktree-physical-closeout-contract.test.ts
      - tests/unit/worktree-physical-closeout-temp-repo.test.ts
      - tests/unit/worktree-physical-closeout-crash-fixture.ts
      - tests/unit/worktree-physical-closeout-crash-recovery.test.ts
      - tests/unit/physical-no-follow.test.ts
      - tests/unit/workspace-write-lease.test.ts
      - tests/unit/work-selection-live.test.ts
      - tests/contract/test-impact.test.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/contract/documentation-authority.test.ts
      - tests/contract/semantic-mutation-apply-contract.test.ts
  - id: branch-closeout-worktree-receipt-consumer
    owner: branch-ref-lifecycle-owner
    ownedPaths:
      - scripts/codex/branch-closeout-contract.ts
      - scripts/codex/branch-closeout.ts
      - scripts/codex/branch-closeout-receipt.ts
      - scripts/codex/verification-session.ts
      - scripts/codex/verification-session-github.ts
      - .github/workflows/sec-merge-gate.yml
      - tests/unit/branch-lifecycle-contract.test.ts
      - tests/unit/branch-lifecycle-temp-repo.test.ts
      - tests/unit/branch-closeout-receipt.test.ts
      - tests/unit/verification-session-runtime.test.ts
      - tests/contract/sec-merge-gate.test.ts
  - id: agent-operation-activation-remote-head-bootstrap
    owner: development-agent-operation-owner
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - tests/contract/ci-contract.test.ts
  - id: canonical-process-output-boundary
    owner: semantic-mutation
    ownedPaths:
      - platform/shared/process.ts
      - tests/unit/process-output.test.ts
forbiddenPaths:
  - .agents/
  - .codex/
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
  - platform/shared/worktree-settlement-contract.ts
  - scripts/codex/branch-lifecycle.ts
  - scripts/codex/branch-lifecycle-command.ts
  - scripts/codex/branch-lifecycle-config.ts
  - scripts/codex/branch-lifecycle-inventory.ts
  - scripts/codex/branch-lifecycle-parsers.ts
  - scripts/codex/branch-lifecycle-types.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/worktree-settlement.ts
  - scripts/run-work-package-gate.ts
  - source/
acceptance:
  - the package is bound to exact healthy main 4c2dfbac5bfd5a2edf38e5ec7e8c6ed394c152dd tree cc0caceb976a8eb97fa98a73b99e5befa8e725b8 and live Issue 186 current-spec revision sha256:6901ae5183daa5f90511abc9e3aafd9799ce4be5cd36d94efcb3bd5ac2b8283a
  - the canonical WorkDecision receipt sha256:d828313cfe4e383d3695ec91f0ac0cc1b48851482c180899ef2b74971a134b90 selects issue-186 after controlled-pr-issue-disposition-single-writer-v1 entered main with healthy MainHealth and no active pull request or closeout residue
  - one canonical physical-closeout state machine owns exact registered Git worktrees and only residues carrying its durable pre-unregister authorization; unknown historical orphans are never adopted
  - the superseded controlled-pr-issue-disposition-single-writer-v1 manifest is retired from the live registry and remains available only through immutable Git history
  - the API accepts an explicit repository root and exact target identity only; current/default/bare/locked/dirty tracked/index/ordinary-untracked/unknown-ignored worktrees and branch head tree recovery mismatches fail closed
  - git worktree list porcelain bytes are parsed NUL-safely and unknown duplicate or unsupported fields fail closed rather than being normalized heuristically
  - repository common-dir target and ancestor physical identities are content-bound; target roots that are symlink junction mount point or other reparse identity fail closed and descendant reparse entries are never traversed
  - one shared physical-no-follow owner provides handle-anchored identity exact ENOENT and durable parent publication semantics; worktree closeout does not define a weaker competing filesystem authority
  - durable recovery authorization is stored outside the target under the owning Git common-dir before unregister and binds repository target branch head tree inventory and recovery identity
  - prepare also creates and identity-binds one empty target-parent same-volume retained proof root; it is the canonical audit-retention owner for the atomically relocated V3 lease owner/terminal ledger and transition, while the Git common-dir operation root remains only the authorization and receipt locator
  - completed and trusted consumption re-read the exact retained proof root, transition, relocated namespace inode, protocol, owner and terminal pair after fence deletion; deleted, replaced, foreign or self-issued proof artifacts fail closed
  - unregister command exit status is observation only; immediate registry and physical readback determines completed blocked or residue and registry-absent physical-present can resume only from the exact durable authorization
  - physical cleanup is bounded and retryable with exact failing relative identity residue digest and no widening to newly appeared or unknown content; repeated completed invocation is idempotent
  - destructive cleanup uses retained no-follow parent and leaf handles with handle-relative delete identity and durability readback on Windows and Linux rather than path-only unlink rmdir or chmod effects
  - closeout holds the canonical repository/common-dir writer lease before the target writer lease; the target lease may relocate only after an exact retained-identity same-parent tombstone rename and continues to fence heartbeat assert and terminal retirement at the tombstone without a release-to-rename gap
  - any pre-existing V2 workspace writer lease is an external typed migration boundary; V3 never infers V2 quiescence, deletes its evidence, or assumes cross-revision mutual exclusion
  - every terminal observation is an immutable content-addressed receipt generation and a durable latest pointer may advance residue or blocked to completed without overwriting prior attempts
  - a completed sec-worktree-cleanup-receipt-v1 binds registry-before and registry-after physical inventory cleanup attempts recovery authority and simultaneous registry absence plus physical ENOENT
  - Issue 186 never deletes local or remote branch refs; branch closeout remains protected-pending or blocked while a worktree is registered or residue exists and may continue its own CAS only after consuming the exact completed worktree receipt and rereading inventory
  - the original host exposes one same-process closeout route that preserves the immutable prepared target set and composes trusted physical prepare execute completed-receipt assertion and opaque-token branch authorization; hosted or later processes remain fail closed and cannot replace that obligation with an empty re-preparation
  - the trusted activation checkout binds its provider-observed default branch to one exact refs/remotes/origin/HEAD symbolic projection after verifying that branch resolves to the request base, so a fresh Actions checkout cannot deterministically fail WorkDecision with an empty remote-head projection
  - the exact integrate-hosted invocation owns the ordered merge readback canonical post-merge MainHealth join original-host artifact equality readback physical closeout and branch CAS; the Workflow does not start a later closeout mutation process that could lose opaque physical authority
  - fresh-host rehydrate never carries a foreign absolute worktree path and never treats local absence or provider job success as foreign completion; normal convergence requires a new preparation after original-host physical closeout while merged legacy recovery requires explicit external maintainer disposition
  - focused fake-adapter and isolated temporary-repository tests cover authorization-before-unregister residue resume stale identity unknown orphan default current dirty untracked ignored locked reparse bounded failure and idempotence on Windows and POSIX-capable providers
  - worktree closeout introduces no process dispatcher and delegates to the canonical shared async process owner with fixed Git executable, no shell, bounded domain output, canonical repository cwd and scrubbed Git child environment; the closure contract rejects helper, command, cwd or environment drift
  - the final frozen candidate runs one deduplicated required Action closure exact-head independent Review one hosted Gate merge new-main MainHealth readback and one closeout; authoring sentinels are not formal Evidence
tests:
  - tests/unit/physical-no-follow.test.ts
  - tests/unit/process-output.test.ts
  - tests/unit/worktree-physical-closeout-contract.test.ts
  - tests/unit/worktree-physical-closeout-temp-repo.test.ts
  - tests/unit/worktree-physical-closeout-crash-recovery.test.ts
  - tests/unit/branch-lifecycle-contract.test.ts
  - tests/unit/branch-lifecycle-temp-repo.test.ts
  - tests/unit/branch-closeout-receipt.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/documentation-authority.test.ts
---

# Git worktree physical closeout

This package introduces the sole physical closeout owner for exact registered Git
worktrees and for residues carrying that owner's durable pre-unregister recovery
authorization. It does not absorb branch/ref lifecycle, generic generated-state
cleanup, test-runtime workspaces, Verification Result, or product mutation.

The implementation keeps physical deletion authority separate from branch/ref CAS.
It persists exact authorization outside the target, executes unregister and bounded
no-follow settlement, then decides the terminal result from registry plus physical
readback. A completed receipt is only a prerequisite consumed by the existing branch
owner; it never performs that owner's ref transition.
