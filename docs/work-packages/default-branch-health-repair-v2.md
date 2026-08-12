---
schema: codex-development-work-package-v1
id: default-branch-health-repair-v2
tracking: none
base: 879af721ef6a3cd952a8b255ceb2d459021f567e
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - verification-governance
tasks:
  - id: exact-type-closure
    owner: agent-operation-activation-owner
    ownedPaths:
      - platform/shared/agent-operation-activation-contract.ts
      - scripts/codex/agent-operation-activation.ts
      - scripts/codex/work-package-contract.ts
      - tests/unit/agent-operation-activation.test.ts
      - tests/unit/codex-work-package-contract.test.ts
  - id: main-health-repair-routing
    owner: main-health-failure-routing-owner
    ownedPaths:
      - platform/shared/ci-verification-revision.ts
      - platform/shared/ci-trust-root-registry.json
      - platform/shared/main-health-contract.ts
      - platform/shared/main-health-repair-contract.ts
      - scripts/codex/document-control-plane-contract.ts
      - scripts/codex/document-control-plane.ts
      - scripts/codex/main-health-observation.ts
      - scripts/codex/main-health-repair.ts
      - scripts/codex/verification-session-runtime.ts
      - scripts/codex/work-selection.ts
      - tests/contract/document-control-plane-lifecycle.test.ts
      - tests/contract/default-branch-revision-health.test.ts
      - tests/contract/ci-contract.test.ts
      - tests/unit/main-health-contract.test.ts
      - tests/unit/main-health-repair-contract.test.ts
      - tests/unit/verification-session-runtime.test.ts
      - tests/unit/work-selection-live.test.ts
  - id: main-health-session-consumer-rewire
    owner: verification-session-branch-closeout-authority
    ownedPaths:
      - scripts/codex/verification-session.ts
  - id: verification-evidence-fixture-closure
    owner: verification-action-test-fixture
    ownedPaths:
      - tests/helpers/verification-action-fixtures.ts
      - tests/unit/verification-action-github-provider.test.ts
  - id: causal-test-impact-closure
    owner: test-impact-routing-owner
    ownedPaths:
      - platform/shared/test-impact-rules/governance.ts
      - platform/shared/test-impact-rules/verification.ts
      - tests/contract/test-impact.test.ts
  - id: generated-trust-closure
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/unit/tcb-trust-root-contract.test.ts
  - id: delayed-work-package-handoff
    owner: agent-governance-owner
    ownedPaths:
      - docs/scripts/docs-doctor.ts
      - scripts/codex/repository-audit.ts
      - tests/contract/agent-skills.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/repository-audit.test.ts
  - id: durable-plan-and-control
    owner: development-governance-owner
    ownedPaths:
      - AGENTS.md
      - docs/development-governance.md
      - docs/roadmap.md
      - docs/verification-governance.md
      - docs/work-packages/default-branch-health-repair-v2.md
      - docs/work-packages/operation-read-plan-authority-canary-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/documentation-authority.test.ts
forbiddenPaths:
  - .agents/
  - .codex/
  - .githooks/
  - .github/workflows/
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - package.json
  - platform/compiler/
  - source/
acceptance:
  - the repair binds exact live main 879af721ef6a3cd952a8b255ceb2d459021f567e tree b39cebc0c043d6709659d649b8178eb712163976 and reuses MainHealth run 31568797707 job 94026162914 as the unchanged-input failure evidence without rerunning it before a causal delta
  - the three TypeScript diagnostics are repaired at their producing type boundaries by literal-preserving normalization and a readonly pure changed-record input rather than casts caller copies or suppressed diagnostics
  - degraded MainHealth no longer points every generation at one published proposal-only v2 manifest path; it deterministically derives one repository default main tree owner and sorted-failure content-addressed repair manifest identity while healthy and locked ledgers expose no repair identity
  - a pure MainHealthRepairDecision consumes only a fresh exact MainHealth ledger and returns repair-ready only for the repair lane with exact repository main tree trust owner fingerprint and manifest identity; it never grants implementation merge or provider effect authority
  - one fresh MainHealth observation projects exactly ordinary-only repair-only or locked; document-control invokes the full WorkDecision and Issue catalog only for ordinary-only, admits a repair only for repair-only plus no active package and exact manifest path package id base/tree/trust binding, and performs no selector work when locked
  - MainHealth converges at most one check per allowed event only when every producer reports the same policy-recognized terminal status and conclusion; equivalent success is healthy, equivalent terminal failure is degraded with one transport-independent semantic failure fingerprint, while duplicate events nonterminal checks unknown status or conclusion and conflicting conclusions remain locked
  - the provider adapter closes bounded pagination and shape before MainHealth compilation; MainHealth source provenance binds only the policy and canonical sorted matching subset so nonmatching check noise cannot change either health semantics or the ledger, while any future raw-response audit remains a separate provider-observation receipt responsibility
  - IssueDisposition post-new-main evidence consumes the canonical MainHealth compiler and ordinary lane resolver with exact new-main commit tree trust and fresh time; equivalent push plus repository-dispatch success is accepted while weakened app identity workflow ref event duplicate unknown and conflicting observations fail closed, and no private cardinality or status filter remains
  - repair rolling projection is deterministic and bounded; the repair becomes the sole active package while the prior ordered active plus candidates are retained without reordering or invention, and the next healthy WorkDecision replaces that temporary projection from the canonical roadmap
  - repair projection never resolves a capacity conflict by truncating an identity; a legal five-candidate prior topology that cannot retain prior active plus all candidates within the canonical five-candidate bound fails closed before projection
  - provider checks to MainHealth input compilation has one dedicated MainHealth-owned module consumed by repair Work Selection and VerificationSession so future impact selection reaches the complete MainHealth repair and trust closure without dual-owning the VerificationSession runtime
  - development and verification governance expose one identical ordinary-only repair-only locked production route and agree that repair routing never grants scope Review provider integration or merge authority
  - the current candidate is the one explicit manual-bootstrap bridge because trusted main lacks the repair consumer; after this exact repair reaches new main no caller JSON manual pointer staging or second repair package path can enter the production route
  - the document-control transaction keeps index transport PRE distinct from the actual worktree publication PRE, so an already-projected requested rolling plan produces no invented recovery nodes; every Git interpretation of the index runs only on an external scratch copy, both successful and failed observations byte-and-identity read back the retained real index before propagating, fixture tests call the production API instead of impersonating the trusted-main CLI, and test observations cannot refresh the raw index under test
  - the published Issue 346 manifest remains byte-exact for one delayed handoff while this untracked recovery package is selected; docs doctor and repository audit consume one pure census contract derived from immutable candidate-tree canonical-roadmap and exact-default bytes, docs doctor reuses its one reviewed exact Git object observer for both blob bytes and directory membership without a fourth process dispatcher or candidate-issued TCB expansion, and the next ordinary Issue 352 slice retires the predecessor manifest and consumed catalog item together
  - an exact repository package census after this repair projects Issue 346 as already in main and selects Issue 352 rather than reopening or reselecting Issue 346
  - docs roadmap alone records the future causal order as Issue 352 controlled PR and Issue disposition single-writer closure then Issue 186 Git worktree physical closeout then Issue 275 canary; this repair rolling projection retains the exact prior active plus candidate topology, and only the next healthy ordinary WorkDecision may replace it from the canonical roadmap
  - Issue 352 must eliminate the raw manual PR and merge writer for controlled operations; GitHub closingIssuesReferences remains provider evidence, provider lacks conditional Issue mutation, and the repository must not claim an automatic CAS reopen it cannot perform
  - Issue 186 must replace exit-code cleanup with authorization-before-unregister registry plus physical readback and resumable residue receipts; remote ref deletion remains Issue 313 and consumes completed worktree closeout rather than racing it
  - one logical run uses exactly one mutable worktree branch and candidate ref; the existing merged remote branch is recorded as terminal closeout residue and is not mistaken for a second active candidate
  - successful provider fixtures are generated through the canonical terminal artifact authorization observation reducer and finalizer chain, forged publisher fixtures keep artifact metadata internally consistent until the intended authority boundary, and source locks permit exactly one github-writer circuit breaker only before the physical merge while preserving a writer-free post-effect readback projection
  - the dedicated VerificationAction fixture owner combines its automatic direct-consumer edge with only the selector contract, and the generated TCB closure lock is rebuilt once from the final source graph so every module blob and raw content digest binds the exact candidate
  - only one post-delta TypeScript check and the focused repair contract tests may execute locally; no full affected release nightly or unchanged failed run repetition is permitted
  - exact-head independent static Review and remote new-main MainHealth readback remain required before this repair is called integrated
tests:
  - tests/unit/agent-operation-activation.test.ts
  - tests/unit/codex-work-package-contract.test.ts
  - tests/unit/main-health-contract.test.ts
  - tests/unit/main-health-repair-contract.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/unit/work-selection-live.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/default-branch-revision-health.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/unit/tcb-trust-root-contract.test.ts
  - tests/unit/verification-action-github-provider.test.ts
---

# Exact-main health repair and repair-lane cutover

This package is the single bridge out of the exact MainHealth failure on `879af721`. It repairs the three
compiler diagnostics and installs the missing deterministic route from a fresh degraded MainHealth observation
to one exact repair freeze. MainHealth remains routing evidence only; the user-authorized A0 operation, frozen
scope, Review, integration and readback owners retain their existing authority.

This bootstrap package deliberately tracks no Issue: Issue 177 owns failure classification but explicitly does
not own MainHealth or repair effects, while Issues 352 and 186 retain their own identities. The package also
freezes—not implements—the next causal slices: Issue 352 removes the remaining raw controlled
PR/merge writer, Issue 186 owns worktree unregister plus physical settlement and residue recovery, and Issue 275
then becomes the first normal activation canary. Those identities stay open until their own production consumers
and readbacks exist.
