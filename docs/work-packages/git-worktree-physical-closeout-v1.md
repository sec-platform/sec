---
schema: codex-development-work-package-v1
id: git-worktree-physical-closeout-v1
tracking: issue-186
base: 7692630133526cbe67659bb4da8673f225ccf5f2
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - roadmap
  - semantic-mutation
  - verification-governance
tasks:
  - id: worktree-large-inventory-physical-capability
    owner: development-integration-closeout-owner
    ownedPaths:
      - docs/development-governance.md
      - docs/work-packages/controlled-pr-issue-disposition-single-writer-v1.md
      - docs/work-packages/default-branch-health-repair-2d2b92bbeb06effbdf1da850709e4d162898991e-ebcd146113d7f77482d452058181bbded2f25f3c592a64cc64d0fb9c7cc776c9.md
      - docs/work-packages/git-worktree-physical-closeout-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/shared/physical-no-follow.ts
      - scripts/codex/worktree-physical-closeout.ts
      - tests/unit/physical-no-follow.test.ts
      - tests/unit/worktree-physical-closeout-temp-repo.test.ts
      - tests/contract/documentation-authority.test.ts
  - id: generated-state-closeout-dependency-order
    owner: roadmap-owner
    ownedPaths:
      - docs/roadmap.md
      - tests/unit/work-selection-live.test.ts
  - id: physical-capability-tcb-regeneration
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
      - tests/contract/tcb-closure-lock.test.ts
  - id: trusted-bootstrap-dependency-materialization-recovery
    owner: verification-evidence-producers
    ownedPaths:
      - platform/shared/ci-verification-revision.ts
      - platform/shared/test-impact-rules/verification.ts
      - scripts/ci-verification.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/ci-verification-execution.test.ts
  - id: trusted-bootstrap-dependency-recovery-governance
    owner: verification-governance-owner
    ownedPaths:
      - docs/verification-governance.md
  - id: verification-session-hosted-bootstrap-repair
    owner: verification-session-branch-closeout-authority
    ownedPaths:
      - scripts/codex/branch-lifecycle-inventory.ts
      - scripts/codex/branch-lifecycle-command.ts
      - scripts/codex/verification-session-github.ts
      - scripts/codex/verification-session.ts
      - tests/unit/branch-lifecycle-contract.test.ts
      - tests/unit/branch-lifecycle-temp-repo.test.ts
      - tests/unit/sec-merge-bootstrap.test.ts
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
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - platform/orchestrator/
  - platform/shared/workspace-write-lease.ts
  - scripts/codex/branch-closeout-contract.ts
  - scripts/codex/branch-closeout.ts
  - scripts/run-work-package-gate.ts
  - source/
acceptance:
  - the package is bound to exact healthy main 7692630133526cbe67659bb4da8673f225ccf5f2 tree 6d36adc800dc76c8e0b48e9cd399e80f305e251d and live Issue 186 current-spec revision sha256:6901ae5183daa5f90511abc9e3aafd9799ce4be5cd36d94efcb3bd5ac2b8283a
  - canonical WorkDecision receipt sha256:a7a0ea9b0b50b1013332700e3a65a18d7f14a0603b79ee19f0660da861bf97b4 selects issue-186 only after Issue 352 provider completion and zero unexpected branch worktree or ref closeout residue
  - the completed Issue 352 and default-branch repair manifests are removed as consumed predecessors while their immutable Git history remains available
  - worktree physical inventory hashes ordinary file content through retained no-follow handles in bounded chunks and never materializes an arbitrarily large leaf in memory
  - the streaming content digest is byte-identical to the existing canonical content-digest domain for small files, so durable authorization and residue recovery do not split across algorithms
  - the bounded control-file reader remains capped and distinct from streaming inventory; large control or recovery records still fail closed
  - Windows readonly deletion uses retained-handle FileDispositionInfoEx DELETE plus IGNORE_READONLY_ATTRIBUTE, never mutates the shared inode attributes, proves an external hardlink remains readonly, and fails closed when that capability is unavailable
  - one real Windows registered-worktree regression contains a greater-than-64-MiB ordinary tracked leaf, a readonly nested tracked leaf, and a descendant junction whose external target survives; completion still requires registry absence and physical ENOENT
  - Linux uses the same retained openat file identity and bounded streaming digest implementation; unchanged Linux capability evidence is reused until the final selected capability delta requires one owning-environment run, and no macOS execution claim is fabricated without an Apple provider
  - generated or ignored names never create worktree deletion authority; automatic dependency browser and temporary-state settlement requires an exact owner receipt from the generated-state lifecycle before physical closeout preparation
  - the roadmap machine catalog includes generated ignored-state lifecycle as the blocking predecessor for final automatic Issue 186 settlement instead of leaving that dependency only in Issue prose
  - one canonical worktree physical owner and one canonical generated-state owner remain separate; no universal cleanup manager second closeout state machine or name-based allowlist is introduced
  - test impact continues to select the existing git-worktree-physical-closeout owner closure without adding a second mapping or running unrelated full verification during authoring
  - trusted remote observation never depends on actions/checkout persisted credentials; one canonical pure command prefix clears generic and github.com HTTP extraHeader state plus ambient helpers before selecting gh auth git-credential, supports every canonical Git branch name, and is consumed by bounded inventory, runtime inspection, ref synchronization, and effect-time closeout
  - the local Verification Session wakeup dispatcher type-locks canonical JSON stdin as Buffer bytes before bounded spawnSync capture, and an executable pinned-Bun probe proves that exact byte path cannot regress to the string-plus-buffer-encoding exception
  - the hosted bootstrap defects are repaired in this compatible union package because they block the only required #186 Action closure; the superseded PRE/FINAL publications remain immutable evidence but cannot authorize the expanded manifest
  - trusted-bootstrap exact-base dependency materialization retries only one classified Bun tarball-extraction failure against the same exact inputs and private cache; every other failure has zero retry, a repeated extraction failure is terminal, and the attempt count and recovery class bind the physical bootstrap operation digest
  - trusted-bootstrap never mutates exact-base dependency source; retained no-follow pre/post snapshots bind root, ancestors, links, ordinary-file identity and streamed canonical content, link bytes are read from the retained link fd rather than parent/name, a retained-fd archive writer normalizes only lexically in-root absolute links in tar headers, and every dependency archive path, kind, target and logical content digest must match the frozen source generation; temp collision, root/ancestor/link/target swap, ABA, escape, broken, non-POSIX, special, foreign/missing entry, or entry/byte-bound failures are terminal and both source snapshot and archive projection bind the SUT operation
  - after raw archive validation, the Linux launcher reopens the exact ordinary archive with O_NOFOLLOW, verifies and retains that fd, passes only fixed child fd 3 to the namespace, copies from that fd into private tmpfs, and verifies the operation-bound archive digest both after the copy and immediately before extraction; host pathname rename/substitution/restore ABA cannot select the executed dependency bytes, while a substituted fd or in-place byte drift is terminal before candidate code runs
  - the retained archive transport is frozen as sandbox-v5 in the canonical provider policy and test-impact registry; it invalidates stale sandbox evidence without changing the exact v8 container image bytes, so the already-proven local image is reused rather than rebuilt or downloaded
  - the final frozen candidate uses one mutable worktree and one candidate ref, performs focused Windows evidence, exact-head independent Review, one deduplicated required Action closure, merge, exact-new-main MainHealth, and owner-specific closeout readback
tests:
  - tests/unit/physical-no-follow.test.ts
  - tests/unit/worktree-physical-closeout-temp-repo.test.ts
  - tests/unit/work-selection-live.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/test-impact.test.ts
  - tests/unit/ci-verification-execution.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/unit/branch-lifecycle-contract.test.ts
  - tests/unit/branch-lifecycle-temp-repo.test.ts
  - tests/unit/sec-merge-bootstrap.test.ts
---

# Git worktree large-inventory physical capability

This focused continuation preserves the already-merged worktree closeout state
machine and closes the real-machine large-leaf and readonly deletion gap. It
adds no generated-state deletion authority. Generated dependency, browser, and
temporary roots must first be classified and retired by their owning lifecycle;
the worktree owner then consumes the resulting clean physical subject.

The machine roadmap records that ordering so normal closeout becomes a cheap
owner-driven terminal action rather than repeated manual cache archaeology.
