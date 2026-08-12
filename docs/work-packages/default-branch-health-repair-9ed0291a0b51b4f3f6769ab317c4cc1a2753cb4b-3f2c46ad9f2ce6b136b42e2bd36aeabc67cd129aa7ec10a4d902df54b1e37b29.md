---
schema: codex-development-work-package-v1
id: default-branch-health-repair-9ed0291a0b51b4f3f6769ab317c4cc1a2753cb4b-3f2c46ad9f2ce6b136b42e2bd36aeabc67cd129aa7ec10a4d902df54b1e37b29
tracking: none
base: 9ed0291a0b51b4f3f6769ab317c4cc1a2753cb4b
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - verification-governance
tasks:
  - id: legacy-evidence-composition-retirement
    owner: verification-evidence-composition-owner
    ownedPaths:
      - platform/shared/ci-evidence-composition-policy-registry.ts
      - scripts/ci-verification.ts
      - scripts/codex/task-capsule.ts
      - scripts/codex/work-package-contract.ts
      - tests/contract/documentation-corpus-census.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/codex-work-package-contract.test.ts
  - id: historical-evidence-consumer-zero
    owner: work-package-evidence-retirement-owner
    ownedPaths:
      - docs/evidence/v0-4-semantic-mutation-single-job-owner-production-pass-2026-07-18.json
  - id: exact-deletion-impact-transition
    owner: verification-test-impact-owner
    ownedPaths:
      - platform/dev-runner/test-runner.ts
      - platform/shared/affected-test-inventory.ts
      - platform/shared/ci-git-changed-files.ts
      - platform/shared/ci-pr-risk-selection.ts
      - platform/shared/ci-verification-plan.ts
      - platform/shared/test-impact-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - platform/shared/test-impact-rules/verification.ts
      - platform/shared/test-ownership-contract.ts
      - platform/shared/verification-scope-inventory.ts
      - scripts/ci-pr-risk.ts
      - scripts/codex/ci-orchestration-core.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-pr-risk-selection.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/ci-git-changed-files.test.ts
  - id: verification-session-transition-binding
    owner: verification-session-branch-closeout-authority
    ownedPaths:
      - platform/shared/verification-session-contract.ts
      - scripts/codex/verification-session-runtime.ts
      - scripts/codex/verification-session.ts
      - tests/unit/verification-action-ci-contract.test.ts
      - tests/unit/verification-session-contract.test.ts
      - tests/unit/verification-session-runtime.test.ts
  - id: repair-topology-publication-state
    owner: main-health-failure-routing-owner
    ownedPaths:
      - scripts/codex/document-control-plane-contract.ts
      - scripts/codex/document-control-plane.ts
      - tests/contract/document-control-plane-lifecycle.test.ts
  - id: automatic-trust-epoch-rollover
    owner: agent-governance-owner
    ownedPaths:
      - .agents/skills/
      - AGENTS.md
      - docs/development-governance.md
      - docs/verification-governance.md
      - tests/contract/agent-skills.test.ts
  - id: generated-trust-closure
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
  - id: durable-plan-and-control
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/default-branch-health-repair-9ed0291a0b51b4f3f6769ab317c4cc1a2753cb4b-3f2c46ad9f2ce6b136b42e2bd36aeabc67cd129aa7ec10a4d902df54b1e37b29.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/documentation-authority.test.ts
forbiddenPaths:
  - .codex/
  - .githooks/
  - .github/workflows/
  - bun.lock
  - docs/authority.json
  - package.json
  - platform/compiler/
  - source/
acceptance:
  - the repair binds exact live main 9ed0291a0b51b4f3f6769ab317c4cc1a2753cb4b tree e7316576e3834cf188503a288a97e521fe3765db and reuses MainHealth run 31586609530 job 94081792137 failure fingerprint sha256:af8ab47c80bec684c3861730348891d87e391586d76fffc701f81066f4fd9d7a without rerunning unchanged input before a causal delta
  - the MainHealth failure is classified as a non-hermetic test and production-policy defect because the legacy SM3 composition registry and its unit test require unreachable ambient Git objects rather than creating or receiving an exact self-contained object closure
  - the one-off SM3 registered policy its production dispatch branch Work Package V2 authority surface dedicated unit test and exact historical evidence JSON reach consumer zero and are deleted while the generic evidence DAG and reusable-evidence pure contracts remain available to a future canonical owner
  - the only supported Work Package schema after cutover is V1 with explicit profile CI revision tests and owned paths; unsupported V2 bytes fail closed in the one parser and no Task Capsule or CI consumer preserves a second manifest authority route
  - no MainHealth or focused verification path depends on an unreachable commit dangling object local reflog or retained developer object database; every remaining Git object observation is supplied by an exact reachable revision or a self-contained fixture
  - the retired evidence bytes runtime consumers and authority identity reach zero while its base-to-candidate deletion remains selectable only through an exact transition binding over trusted base/head Git removed status base ordinary-blob mode and OID and head absence; path-only re-add modify wrong-base wrong-blob wrong-mode and unknown evidence remain unresolved without a compatibility alias
  - one canonical Git observer compiles the complete transition from the already frozen exact base/head and every CI risk affected Scope and VerificationSession consumer whole-value validates the same canonical records derived paths and removed-blob facts; caller path-only or mismatched injected observations fail closed
  - the transition digest is explicit in the Scope and Session proposals and is transitively bound into ScopeAuthorization Action plan Session revision and the existing hosted request expected digests; trusted prepare hosted reconstruction and local quick rederive the same identity while order-only transport variation is canonical and no parallel request schema or workflow key is introduced
  - repair activation derives publication state from the exact current pointer manifest bytes and fresh default manifest bytes; a current active package proven byte-identical on exact default is retired before candidate preservation while an unpublished mismatched stale or unresolved active identity is never dropped
  - the five existing unresolved candidates are preserved byte-for-byte and in order when the published active package retires; no candidate is truncated invented promoted or reordered and a topology that still exceeds the bound fails closed
  - a trust-changing merge seals the old operation epoch and invalidates its effect grant Review Evidence and cached control facts but does not terminate a still-authorized long-running A0 task
  - after exact remote and new-main readback the coordinator automatically discards stale epoch state reruns the canonical document-control status on new main reloads AGENTS the selected manifest and authority closure and continues only under the newly derived operation epoch
  - the historical TASK_RESTART_REQUIRED label has no current authority and cannot be emitted as a routine terminal state; only unresolved or invalid control state missing external authority unavailable independent Review a required user choice or another typed external blocker returns control to the user
  - all eight repository Skills use only canonical validator-supported frontmatter keys and the contract no longer requires the rejected compatibility key so every future Skill edit can pass the same installed quick validator
  - same-input failures remain reusable and are not rerun; automatic continuation means reorientation and RequiredClosure intersect MissingOrStale rather than carrying old evidence or executing the full suite again
  - this exact package is the single user-authorized manual bootstrap required because trusted main contains the repair-capacity defect; after this candidate enters main all later repair activation and epoch rollover use the canonical production route and no second manual pointer staging entrance survives
  - one logical run retains one mutable candidate worktree branch and ref; the already-merged prior repair worktree remains protected terminal residue for Issue 186 rather than becoming a second mutable candidate or being ad hoc deleted
  - verification is limited to parser and ownership statics the repair projection contract the Skill validator and its focused positive negative boundary assertions imports check exact TCB regeneration and independent exact-object Review; no affected full release nightly or repeated unchanged MainHealth run is allowed
  - integration requires exact-head independent Review authorized single-candidate merge remote commit tree manifest pointer and MainHealth readback followed by automatic next-epoch reorientation rather than a user-visible restart stop
tests:
  - tests/unit/codex-work-package-contract.test.ts
  - tests/contract/documentation-corpus-census.test.ts
  - tests/contract/test-impact.test.ts
  - tests/unit/ci-pr-risk-selection.test.ts
  - tests/unit/ci-git-changed-files.test.ts
  - tests/unit/ci-pr-risk-execution.test.ts
  - tests/unit/ci-verification-execution.test.ts
  - tests/unit/verification-action-ci-contract.test.ts
  - tests/unit/verification-session-contract.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/agent-skills.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/tcb-closure-lock.test.ts
---

# Exact-main health repair, legacy evidence retirement, and automatic epoch rollover

This package repairs the exact post-merge MainHealth failure without fetching or preserving unreachable historical
Git objects. It removes the one-off SM3 evidence-composition authority path, repairs the published-active capacity
rule in the MainHealth repair projection, and makes trust-epoch rollover an automatic continuation boundary rather
than a routine reason to stop a still-authorized task.

The package tracks no Issue because it is a content-addressed repair of exact `main`. Existing Issues retain their
own completion conditions. In particular, Issue 186 owns physical worktree settlement, Issue 327 owns the broader
repository/evidence consumer-zero program, and Issue 275 remains the first ordinary activation canary after main is
healthy. This repair closes only the exact causal defect and the repeated autonomous-stop behavior exposed by it.
