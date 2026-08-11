---
schema: codex-development-work-package-v1
id: bootstrap-repair-348-347-v1
tracking: issue-348
base: 7297da11b11145fa958a8ec468e98e9be4dfa351
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: imports-effect-purity-cutover
    owner: dev-runner-imports-owner
    ownedPaths:
      - platform/dev-runner/import-organizer.ts
      - platform/dev-runner/import-transform-transaction.ts
      - platform/dev-runner/check-runner.ts
      - platform/dev-runner.ts
      - platform/shared/test-budget-contract.ts
      - package.json
      - .githooks/pre-commit
      - .githooks/pre-push
      - tests/unit/import-organizer-selection.test.ts
      - tests/e2e/import-organizer-staged.test.ts
      - tests/contract/dev-runner-contract.test.ts
      - tests/unit/local-gate-union.test.ts
      - tests/e2e/import-organizer-worktree-isolation.test.ts
      - tests/unit/import-transform-transaction.test.ts
      - tests/unit/ci-pr-risk-selection.test.ts
      - tests/contract/benchmark-budget.test.ts
      - tests/testkit/contracts.ts
      - docs/work-packages/bootstrap-repair-348-347-v1.md
      - docs/work-packages/skill-applicability-gate-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/documentation-authority.test.ts
  - id: verification-fast-path-integrity
    owner: verification-control-plane-owner
    ownedPaths:
      - scripts/codex/verification-session-github.ts
      - scripts/codex/verification-session-runtime.ts
      - scripts/codex/verification-session.ts
      - scripts/codex/merge-gate.ts
      - scripts/codex/integration-authorization-publication.ts
      - scripts/codex/branch-closeout-receipt.ts
      - platform/shared/review-stability-contract.ts
      - platform/shared/verification-provider-capability-contract.ts
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/ci-trust-root-registry.json
      - platform/shared/test-impact-rules/verification.ts
      - scripts/codex/verification-provider-capability-ledger.ts
      - scripts/codex/local-main-closeout.ts
      - tests/unit/verification-session-runtime.test.ts
      - tests/e2e/verification-session-closeout-cli.test.ts
      - tests/contract/test-impact.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/unit/branch-closeout-receipt.test.ts
      - tests/unit/review-stability-contract.test.ts
      - tests/unit/verification-provider-capability-contract.test.ts
      - tests/unit/local-main-closeout.test.ts
      - docs/external-provider-policy.md
      - docs/governance/external-capability-ledger.yaml
      - docs/scripts/docs-doctor-ledgers.ts
      - tests/contract/docs-doctor-ledgers.test.ts
forbiddenPaths:
  - .codex/
  - .github/workflows/
  - dist/
  - docs/product.md
  - docs/roadmap.md
  - platform/compiler/
  - platform/orchestrator/
  - platform/registry/
  - scripts/ci-verification.ts
  - scripts/codex/branch-lifecycle.ts
  - scripts/codex/branch-lifecycle-command.ts
  - scripts/codex/branch-lifecycle-audit.ts
  - scripts/codex/branch-lifecycle-contract.ts
  - scripts/codex/branch-lifecycle-config.ts
  - scripts/codex/branch-lifecycle-health.ts
  - scripts/codex/branch-lifecycle-inventory.ts
  - scripts/codex/branch-lifecycle-parsers.ts
  - scripts/codex/branch-lifecycle-types.ts
  - scripts/codex/branch-recovery.ts
  - scripts/codex/worktree-settlement.ts
  - scripts/codex/repository-audit.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/install-git-hooks.ts
acceptance:
  - check/freeze leave the tracked tree and index byte-identical before and after
  - check/freeze do not write the shared Git object database or refresh the raw index bytes
  - freeze seals identity only and returns typed needs-import-transform on noncanonical state
  - transform has an explicit write-set, supported-writer preimage CAS under the canonical workspace mutation lease, and readback verification
  - working-tree transform acquires the canonical workspace writer, validates all preimages before publication, and ends accepted, rolled-back, or recovery-required
  - accepted import-transform publication requires one final ordinary-file, contained-path, mode, and byte-exact readback of the complete write set while the writer lease is still held
  - identical exact input and intent produce identical bytes across selectors
  - no ordering flip-flop across plain/candidate/changed-only selectors
  - test-budget inventories and their contract assertions consume the canonical locale-independent code-unit comparator
  - pre-commit and pre-push never mutate
  - check:fast/check:affected/check:full never change tracked source or index
  - sort-and-combine and remove-unused are tested independently
  - true NOOP proves zero publication
  - two-worktree isolation witness passes
  - worktree isolation is registered in the exact import-organizer slow Risk suite rather than the unmapped fallback
  - the exact TCB closure is regenerated from the candidate after local-main process dispatch is injected by the existing session owner
  - local affected verification never compiles provider shims or runs physical closeout CLI partitions; those exact crash/replay partitions remain in the registered e2e-verify-lock Risk suite
  - local quick Action closure contains only quick-phase gates while selected physical Risk remains visible to hosted verification
  - current GitHub review observation succeeds or returns typed provider-schema-unsupported
  - the public adapter/session union carries provider-schema-unsupported with bounded reasonCode and response digest
  - provider quota noise raw bytes never enter prompt/control/evidence truth
  - only an explicit unavailable projection in its current availability epoch suppresses a repeated provider attempt; expired and not-yet-effective projections do not
  - unknown, expired, or unverifiable availability never supports a positive availability claim or effect authority, but does not negate one operation already authorized by its own exact authorization, idempotency, recovery, and readback contract; its provider response/readback becomes the availability evidence
  - current provider availability, freshness, deny-only routing, and diagnostic-retention state come from the canonical external capability ledger and Evidence, never a code constant
  - the implementation session cannot create an independent Review receipt
  - a genuine Review receipt binds exact candidate, review actor/provider, read-only capability, and independence witness
  - only the private provider observation owner can construct an authority-bearing review observation consumed by the session receipt
  - the PR #345 false-independent-review path is a negative regression
  - candidate/TCB never switch the protected developer root
  - remote merge ends in LOCAL_MAIN_READY or explicit LOCAL_MAIN_SYNC_BLOCKED(reason)
  - integration trailers derive only from validated receipts, never model free text
  - merge readback requires the exact typed trailer multiset exactly once and rejects caller-smuggled authority prefixes
  - local-main diagnostic projection is never accepted as mutation authority; the effect owner resolves one live App-provenanced hosted authorization publication from the exact merge markers
  - local-main observation is pure and the effectful closeout V3 is bound to exact merged main/tree, candidate head/tree, protected-root identity, local preimage commit/tree, full authorization/publication/Review/workflow identity, canonical writer lease, pre-effect fences, and terminal readback
  - focused tests, genuine independent Review, merge and new-main/local-main readback
tests:
  - tests/unit/import-organizer-selection.test.ts
  - tests/e2e/import-organizer-staged.test.ts
  - tests/e2e/import-organizer-worktree-isolation.test.ts
  - tests/unit/import-transform-transaction.test.ts
  - tests/unit/ci-pr-risk-selection.test.ts
  - tests/contract/benchmark-budget.test.ts
  - tests/contract/dev-runner-contract.test.ts
  - tests/unit/local-gate-union.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/e2e/verification-session-closeout-cli.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/unit/branch-closeout-receipt.test.ts
  - tests/unit/review-stability-contract.test.ts
  - tests/unit/verification-provider-capability-contract.test.ts
  - tests/unit/local-main-closeout.test.ts
  - tests/contract/docs-doctor-ledgers.test.ts
  - tests/contract/tcb-closure-lock.test.ts
---

# Work Package: Bootstrap Repair Wave #348 + #347

One isolated repair candidate, one frozen Work Package, two independent owner
tasks. Task A owns the imports effect-purity cutover (Issue #348); Task B owns
the verification fast-path integrity repair (Issue #347). Compatibility is
proved on the exact then-current main base
`7297da11b11145fa958a8ec468e98e9be4dfa351` using the #207 resolver on the V3
pair manifests.

Neither parent (#321, #311) is closed by this wave; #346/#275/#349 are not
continued. This manifest freezes a successor candidate after proof reset; only
a fresh genuine independent exact-head PASS can authorize publication and the
trusted-main bootstrap transition.

## #207/#311 compatibility witness

Resolver: `scripts/codex/parallel-work-package-contract.ts`
`resolveParallelConflict` on the exact base `7297da11b11145fa958a8ec468e98e9be4dfa351`.

```json
{
  "left": "bootstrap-repair-348-347-task-a",
  "right": "bootstrap-repair-348-347-task-b",
  "classification": "parallel-safe",
  "reason": "no-conflict-detected",
  "step": 7
}
```

Owned path sets are machine-parsed and disjoint, authority write sets are
disjoint, no exclusive resource overlap, and verification policy IDs differ.
Both tasks execute in the same isolated candidate while keeping owner
independence; no ordered-candidate split is required.

## Independent Review proof reset

Exact-head Review of `40a9c72f84144a3afa5921cb6f6b2714ab253d14`
returned `CHANGES_REQUESTED` (`P0=0`, `P1=8`, `P2=1`). That Review, the old
manifest digest, candidate-side test results, and all merge-readiness claims are
stale for the successor. The root-cause clusters and their unique owners are:

A later independent static Review of exact head
`2e218d39f59d88cd35c1af3086e43b7eeabf016d` returned
`CHANGES_REQUESTED` (`P0=0`, `P1=4`, `P2=0`). It proved that the injected
Review evaluator could still mint the private authority brand, import
publication lacked a final complete-write-set readback, local-main consumed an
unauthenticated diagnostic projection before its protected-root preflight, and
the local-main source was absent from the physical Risk selector. This
successor repairs those four exact findings; that Review cannot authorize the
new head.

The later exact head `d5fd0f14e60e7e9888da5514ca90bd90af08a428` received eight
successor findings. They are repaired in this same successor under three root
cause clusters: import selector/transaction correctness, provider-capability
evidence and freshness binding, and Review/local-main durable receipt
boundaries. That Review is evidence only for its exact head; it does not
authorize the resulting successor head, which still requires a fresh
independent exact-head Review.

Exact head `3c506ae0db39cc188e4c94ee47771224bd65437e` then received an
independent static `CHANGES_REQUESTED` result (`P0=0`, `P1=2`, `P2=3`) and a
provider Review with three additional `P2` findings. This successor closes the
actual contract gaps in the same candidate: runtime numeric narrowing, one
journal grammar with durable rollback progress, private raw-response provenance,
fetch-before-ready local-main readback, and removal of the post-effect receipt
path write. The Review also exposed that the earlier prose overstated filesystem
CAS against writers outside the canonical lease; this manifest now freezes the
honest supported-writer boundary and reserves hostile same-directory mutation
for OS-enforced isolation. Neither Review authorizes the resulting exact head.

1. `ImportTransformPublicationV1` — the import kernel computes bytes only;
   check/freeze never publish Git objects or index/source bytes. Explicit
   working-tree transform consumes the canonical workspace writer, freezes the
   complete write set, validates every source preimage before any publication,
   stages durable recovery material, and ends only accepted, rolled-back, or
   recovery-required.

   The workspace mutation lease is the concurrency authority for every
   supported SEC writer. The preimage CAS is defined inside that exclusive
   writer boundary; a process with direct directory-write authority that
   deliberately bypasses the lease is outside this developer-tool contract.
   Existing symlink/reparse aliases and drift observed at any transaction fence
   still fail closed. If hostile same-directory mutation must ever be defended,
   that requires an OS-enforced broker/ACL or isolated mount boundary rather
   than another path check or an advisory lock disguised as linearizable CAS.
2. `GitHubReviewAuthorityV1` — the private GitHub observation adapter owns
   provider schema normalization and authority-bearing review observation.
   `provider-schema-unsupported` is a public typed result. VerificationSession
   consumes but cannot construct/relabel provider provenance. Exact candidate,
   provider/actor/session identity, read-only candidate capability, writer
   independence, findings/threads, epoch, and source digest are semantic inputs.
3. `VerificationProviderAvailabilityEpochV1` — code owns only the pure schema
   and validator. Current capability routing, availability, freshness, Evidence
   and raw-diagnostic retention/disposal policy live only in
   `docs/governance/external-capability-ledger.yaml`; only explicit unavailable
   in the current epoch suppresses a repeated attempt. Expired/unknown state
   supplies neither a positive claim nor effect authority, while an independently
   authorized operation remains governed by its own idempotency, recovery, and
   exact-readback contract.
4. `CanonicalMergeMessageV1` — callers provide typed authorization/publication
   identities and a validated review receipt, never authority-looking strings.
   The merge gate constructs the required lines internally and readback accepts
   the exact multiset once each, with no missing, duplicate, extra, free-text,
   `Independent-*`, or `Manual-Transition-*` line.
5. `ProtectedLocalMainCloseoutV3` — inspection is read-only and returns
   `already-current | ff-only-eligible | blocked`. The single effectful
   post-merge owner resolves the live trusted-App publication selected by the
   exact merged-commit markers, binds the exact merged commit/tree, candidate
   head/tree, protected-root identity, full integration/Review/workflow
   authorization, local preimage commit/tree and final readback, and holds the
   canonical writer lease across pre-effect fences. A caller-local diagnostic
   projection cannot authorize the effect; the owner never follows an unrelated
   newer remote or switches/stashes/resets the developer root.

The owned-path counts and the #207 compatibility witness are regenerated from
the exact successor manifests during final freeze; prose counts are not an
independent fact source.
