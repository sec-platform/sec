---
schema: codex-development-work-package-v1
id: default-branch-health-repair-f66924ffc1713a19748a9df61d67ecf512763b60-b6a7b2e84cd715ebacd8f4b2041ea796cc2f17d844aa45b22f4fcaf5c2a1b4bf
tracking: none
base: f66924ffc1713a19748a9df61d67ecf512763b60
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - documentation-registry
  - verification-governance
tasks:
  - id: fast-workspace-run-ownership
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/dev-runner.ts
      - platform/dev-runner/env-manager.ts
      - platform/dev-runner/test-runner.ts
      - platform/shared/test-impact-rules/governance.ts
      - platform/shared/test-impact-rules/verification.ts
      - tests/contract/dev-runner-contract.test.ts
      - tests/contract/test-impact.test.ts
      - tests/setup/runtime-deps.setup.ts
      - tests/unit/env-manager.test.ts
      - tests/unit/test-runner.test.ts
  - id: gate-run-child-recovery
    owner: development-governance-owner
    ownedPaths:
      - scripts/run-work-package-gate.ts
      - tests/unit/work-package-gate-execution.test.ts
  - id: physical-metadata-inventory
    owner: development-governance-owner
    ownedPaths:
      - platform/shared/physical-no-follow.ts
      - tests/unit/physical-no-follow.test.ts
  - id: workspace-lease-failure-localization
    owner: development-governance-owner
    ownedPaths:
      - platform/shared/workspace-write-lease.ts
      - tests/unit/workspace-write-lease.test.ts
  - id: verification-governance-projection
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - docs/verification-governance.md
      - platform/shared/tcb-closure-lock.ts
      - tests/contract/tcb-closure-lock.test.ts
  - id: github-comment-observation-provenance
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - scripts/codex/branch-closeout-receipt.ts
      - scripts/codex/verification-session-github.ts
      - tests/unit/branch-closeout-receipt.test.ts
      - tests/unit/verification-session-runtime.test.ts
  - id: durable-repair-control
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/default-branch-health-repair-f66924ffc1713a19748a9df61d67ecf512763b60-b6a7b2e84cd715ebacd8f4b2041ea796cc2f17d844aa45b22f4fcaf5c2a1b4bf.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/documentation-authority.test.ts
forbiddenPaths:
  - .agents/
  - .codex/
  - .githooks/
  - AGENTS.md
  - bun.lock
  - docs/authority.json
  - docs/development-governance.md
  - docs/roadmap.md
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - source/
acceptance:
  - the repair binds exact degraded main f66924ffc1713a19748a9df61d67ecf512763b60 tree 60e9744f65da4ec094a36ae4b9feb98c0c4a44db MainHealth run 31870126523 health revision sha256:59aa40578d62b474bb6a409f6e5b115d4ebd27dbfad19eec865dbd9288a100a8 ledger sha256:ed751ac5c13da80ee5746548dac4ce93815ac8c896abed794d5c71b743562906 and failure fingerprint sha256:c5f501a0ad98d1f31e3232f7c1950f2542078e0c8f356186acb8223cb1bf87af
  - the only failed MainHealth test file is tests/integration/semantic-projections.test.ts and the exact four-file failing invocation plus repeated standalone and concurrent reproductions pass after the failed run; the unchanged nine-minute MainHealth input is not rerun during authoring
  - a caller-provided SEC_TEST_WORKSPACE_NAMESPACE is a physical containment and attribution scope; every runFastTests invocation places one bounded unique run-owned child beneath that exact parent and final cleanup deletes only that child, never the caller scope or a sibling or overlapping invocation
  - Gate recovery can census and settle a hard-crashed fast child by scanning only its caller-owned parent; overlapping invocations prove distinct physical children beneath that parent, preserve a caller sentinel throughout child cleanup, and leave no child residue after success failure or thrown bootstrap
  - an inherited run-child without its exact one-use random assignment fails closed before launching a managed test process; the assignment binds its nonce-derived child name exact OS parent process namespace and child physical device/inode original repository execution snapshot and the canonical external supervisor projection path device/inode for the live kernel-exclusive Gate generation, and the direct runner must spend the generation's exact Windows named-pipe or Linux abstract-socket challenge before any workspace effect; Gate must consume a process-local exact-assignment challenge receipt before accepting child success or publishing terminal Evidence, while the assignment is claimed once and scrubbed from every managed child, so exit zero or a nested process that creates an arbitrary projection root canonical self-digest lease sibling and child cannot substitute its own issuer
  - before any run-child mkdir Gate durably persists the complete nonce name issuer namespace identity and supervisor-lease preparation generation; Gate creates the child exclusively relative to that retained namespace and the runner is inspect-only for the exact precreated namespace and child, so parent ABA target absence or replacement fails with zero replacement effect; Linux binds each mkdirat effect to one process-local retained-chain transaction that watches every root-to-parent edge before opening its next component, compares the complete authorized device/inode chain, and retains every watch through mkdirat parent fsync and final child same-inode readback; the authorized-edge event projection is empty before effect, then accepts only one exact directory-create event, ignores unrelated sibling events without granting authority, and rejects direct-parent or non-leaf-ancestor move delete recreate child replacement watch invalidation or overflow, while Windows retains the handle returned by its root-relative create; effect-success before result persistence adopts only that exact child, while a new supervisor retires the dead generation and durably publishes its replacement before another create effect; deterministic Linux direct-parent non-leaf-ancestor and child replacement fixtures plus a parent-driven hard kill at both boundaries on Windows or Linux prove replacement preservation real kernel capability release stale projection retirement exact-child convergence foreign sibling preservation one actual managed challenge consumer and terminal projection absence
  - Gate recovery accepts workspaces only as direct children of the bound fast child and rejects hostile top-level siblings wrong child grammar extra owner depth symlink reparse alias or replacement; terminal cleanup consumes one frozen bounded metadata-only no-follow physical inventory and retained device/inode deletion without reading ordinary file content, so scan-to-effect replacement insertion oversized leaves or deadline exhaustion are preserved and fail closed rather than being recursively deleted
  - mtime directory-count and orphan-staging heuristics have zero deletion authority; the fast runner and runtime preload contain no global sibling scanner or competing cleanup implementation and automated generated-state settlement remains the following Issue 271 ledger slice
  - the runtime preload is an exact dev-runner test-impact source with one owner and a nonempty focused closure; PR-risk classification cannot substitute for affected-test ownership
  - run-owned workspace identity is safe as one path segment, bounded independently of caller length, and deterministically binds the caller scope without serializing unrelated tests or weakening existing process and resource-class concurrency
  - unexpected native workspace lease acquisition failures retain bounded operation phase and normalized system-code evidence while paths arbitrary messages and raw native objects do not enter the public error contract
  - complete GitHub issue-comment inventory accepts ordinary actor logins and provider Bot `<app-slug>[bot]` syntax as observation data, while only the frozen exact Actions bot and App tuple can authorize hosted publication; an unrelated Codex App review summary is parsed and ignored rather than blocking VerificationSession resume or gaining authority
  - hosted Review request V2 producer explicitly projects the exact repository-bound closed schema rather than spreading caller objects, and the production observation consumer round-trips the exact published bytes, reuses only the complete matching publication identity, and rejects foreign repository source-run workflow PR head or any extra field; strict observation-only legacy V1 parsing accepts both the intended no-repository bytes and the retired spread-repository producer bytes without letting either poison or authorize a V2 operation
  - the original semantic-projections invocation tests/unit/env-manager tests/unit/test-runner and workspace-write-lease focused tests pass; typecheck imports diff check documentation authority and TCB closure remain current
  - the repair changes no product semantic output test applicability issue ordering hosted-provider route or generated-state retention policy; generated-state owner and proof retirement remain the immediately following Issue 271 slice
  - ordinary Darwin fast tests retain scoped run-owned cleanup without claiming retained Gate authority; caller-assigned trusted cleanup remains typed unavailable before its first filesystem effect until a Darwin retained backend and owning-host Evidence exist
  - independent exact-head Codex Review is requested only after the final tree is frozen; any finding invalidates the prior Review
  - after exact new-main readback the existing local three-role provider reruns exactly the stale failed MainHealth action rather than rebuilding the image downloading dependencies or replaying fresh passing steps without invalidation
tests:
  - tests/contract/agent-skills.test.ts
  - tests/contract/benchmark-budget.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/ci-lanes.test.ts
  - tests/contract/dev-runner-contract.test.ts
  - tests/contract/docs-doctor-byte-exact.test.ts
  - tests/contract/docs-doctor-ledgers.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/documentation-corpus-census.test.ts
  - tests/contract/documentation-ownership-closure.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/contract/repository-runtime.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/semantic-mutation-apply-contract.test.ts
  - tests/contract/slow-suite-resource-budget.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/test-impact.test.ts
  - tests/e2e/verification-session-closeout-cli.test.ts
  - tests/integration/pipeline-workspace-write-lease.test.ts
  - tests/integration/semantic-projections.test.ts
  - tests/integration/semantic-mutation-windows-rollback.test.ts
  - tests/unit/active-documentation-contract.test.ts
  - tests/unit/agent-operation-activation.test.ts
  - tests/unit/agent-skill-markdown-classification.test.ts
  - tests/unit/branch-closeout-receipt.test.ts
  - tests/unit/branch-closeout-rest-comments.test.ts
  - tests/unit/branch-lifecycle-contract.test.ts
  - tests/unit/branch-lifecycle-temp-repo.test.ts
  - tests/unit/ci-pr-risk-selection.test.ts
  - tests/unit/codex-work-package-contract.test.ts
  - tests/unit/documentation-authority-registry-v2.test.ts
  - tests/unit/env-manager.test.ts
  - tests/unit/integration-authorization-publication.test.ts
  - tests/unit/local-github-actions-runner.test.ts
  - tests/unit/local-main-closeout.test.ts
  - tests/unit/physical-no-follow.test.ts
  - tests/unit/semantic-mutation-isolated-child-fence.test.ts
  - tests/unit/tcb-trust-root-contract.test.ts
  - tests/unit/test-runner.test.ts
  - tests/unit/verification-action-ci-contract.test.ts
  - tests/unit/verification-candidate-tree.test.ts
  - tests/unit/verification-session-contract.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/unit/work-selection-live.test.ts
  - tests/unit/workspace-write-lease.test.ts
  - tests/unit/work-package-gate-contract.test.ts
  - tests/unit/work-package-gate-execution.test.ts
  - tests/unit/worktree-physical-closeout-contract.test.ts
  - tests/unit/worktree-physical-closeout-crash-recovery.test.ts
  - tests/unit/worktree-physical-closeout-temp-repo.test.ts
---

# Exact-main fast workspace ownership repair

The failed MainHealth run showed a workspace lease acquisition failure only in
the aggregate fast-test execution.  The same exact test and its original
four-file invocation pass independently, so this repair does not change product
semantics or serialize the suite.  It closes the lifecycle seam in which the CI
gate namespace was reused as a deletable run namespace: a nested, overlapping,
or recovering invocation could delete the directory containing another live
workspace and the lease layer then erased the native phase and error code.

The caller namespace remains the stable containment identity.  Each logical
fast run derives a bounded unique child that is physically placed below that
parent and that it alone may clean.  Therefore exact caller-root recovery sees
hard-crash residue without a global sibling scan.  Overlapping runs use
disjoint children, while a nested runner already inside a run child fails
before launching another process.  The Gate holds one live exclusive
supervisor generation (a Windows Global mutex plus named-pipe challenge or a Linux
abstract Unix socket challenge) and durably records the complete nonce, child name,
issuer, original repository, execution snapshot, external projection path/device/inode,
and lease binding before the first mkdir.  A crash after mkdir but
before result publication may adopt only that exact prepared child; a later
supervisor must first retire the old generation and durably publish its own
replacement intent.  Only a runner executing from the bound snapshot can derive the
original projection and spend the live supervisor's one-use kernel challenge.  It
scrubs the assignment before launching managed test processes, so a nested process
cannot create an arbitrary projection root, sibling, and self-signed authority.
Post-child census, recovery, removal, and final readback accept workspaces only
directly beneath that bound child and reject foreign top-level entries, deeper
owner aliases, reparse points, and identity replacement.  Removal consumes one
frozen, bounded, metadata-only no-follow device/inode inventory through
retained-handle deletion; ordinary file content is never read, and entry or
deadline exhaustion fails closed.  It never turns a checked path into recursive
deletion authority, and therefore preserves a replacement or new foreign
sibling introduced between census and effect.  Windows and Linux use the
retained backend.  Ordinary Darwin authoring uses an identity-checked scoped
rename-and-remove fallback; caller-assigned trusted Gate cleanup remains typed
unavailable before its first filesystem effect until a Darwin retained backend has
owning-host Evidence.  Focused tests prove parent preservation, child disjointness,
parent-driven Windows/Linux hard death at both preparation crash windows,
cross-process assignment rejection, one-use challenge consumption, bounded large-file inventory,
hostile-shape/race rejection, and terminal absence.  Lease errors preserve only
bounded structured diagnostics needed to identify a future owner or filesystem
failure without exposing paths or granting retry authority.
