---
schema: codex-development-work-package-v1
id: agent-operation-read-plan-v1
tracking: issue-346
base: 6b7f1a3f54b0b4bdd8eef4c065e1e83607f6bbcb
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: agent-operation-read-plan-cutover
    owner: development-governance-owner
    ownedPaths:
      - AGENTS.md
      - docs/authority.json
      - docs/development-governance.md
      - docs/proposals/development-run-kernel.md
      - docs/roadmap.md
      - docs/system-architecture.md
      - docs/verification-governance.md
      - docs/work-packages/agent-operation-read-plan-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/shared/agent-operation-read-plan-contract.ts
      - platform/shared/agent-skill-contract.ts
      - scripts/codex/operation-read-plan.ts
      - scripts/codex/skill-applicability.ts
      - tests/unit/agent-operation-read-plan.test.ts
      - tests/unit/skill-applicability-decision.test.ts
      - tests/contract/operation-read-plan.test.ts
      - tests/contract/skill-applicability.test.ts
      - tests/contract/documentation-authority.test.ts
forbiddenPaths:
  - .agents/skills/
  - .codex/
  - .github/workflows/
  - .githooks/
  - bun.lock
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - platform/registry/
  - scripts/ci-verification.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/verification-session.ts
  - scripts/codex/verification-session-runtime.ts
  - platform/shared/tcb-closure-lock.ts
acceptance:
  - production Read Plan compile accepts only a schema-only authority-free closure request and derives the complete read closure plus the first bounded worker implement Task Capsule projection from trusted live facts without taking the full #205 Root-Cause Preflight owner
  - one deterministic Read Plan contains requiredRefs conditionalRefs forbiddenSources maxSkillBodies unresolvedFrontier readReceipts and invalidationInputs
  - a focused known operation compiles without default assistant memory historical PR comments full issue census or the full Skill corpus
  - each ref occurs once per operation context conditional expansion is legal only for an explicit unresolved frontier and every read receipt binds exact ref owner revision reason and content digest
  - maxSkillBodies is zero or one and the existing Skill applicability evaluator consumes only a live-bound Read Plan before any Skill body is read
  - goal exact trusted main exact target candidate Work Package digest scope capabilities verification obligations Skill candidates refs owners revisions frontier deny policy receipts and invalidation are trusted-resolver projections rather than caller claims
  - Task Capsule ref digest or revision drift invalidates the prior Skill applicability decision
  - the raw Skill applicability envelope CLI is retired and only a clean exact live-main TCB may bind an explicit candidate root to canonical live base sole-parent candidate exact manifest ownership changed paths and quarantine revisions
  - maintainer or user mutation makes an old observation stale current physical state wins by default and the pure resolver never issues effect authority from a restore claim
  - the protected interactive root is outside candidate write authority and conflict returns typed external-maintainer-mutation instead of dangling-object resurrection
  - AGENTS routes a new AI through the compiled capsule and Read Plan and never treats chat history assistant memory or proposal prose as authority
  - the general Run Kernel remains rejected and no second development run state machine is introduced
  - the seven-item convergence decision records retain adapt or retire each existing capability with an explicit consumer cutover and exit condition
  - no local full-project verification is executed and check full remains a release or selector-calibration backstop
  - only the focused Task Capsule Read Plan Skill applicability and documentation authority contracts are selected locally before exact-head Review
tests:
  - tests/unit/agent-operation-read-plan.test.ts
  - tests/unit/skill-applicability-decision.test.ts
  - tests/contract/operation-read-plan.test.ts
  - tests/contract/skill-applicability.test.ts
  - tests/contract/documentation-authority.test.ts
---

# Work Package: Agent Operation Read Plan V1

This package implements the executable #346 Read Plan slice directly. It is
not a preliminary architecture-only package and it does not claim the entire
#205 Task Capsule / Root-Cause Preflight Program. The authority edits freeze
the consumer boundaries needed by the same cutover, and the new pure compiler
plus CLI are the production seam.

The operation accepts the existing single `VerificationSession` coordinator
and rejects a general Run Kernel. The upstream #205 `TaskCapsuleCompiler` owns
the future general Task Capsule content. Until that provenance-verified producer
is connected, production compile accepts only a schema-only authority-free request and a
candidate location; a clean exact live-main resolver directly derives the complete read closure and sole
supported `worker/implement` projection from candidate pointer, rolling plan,
manifest and exact Git objects. It grants only the observed Git capability,
zero external resources/gates, repository refs inside exact read scope, a mandatory deny baseline and
`sec-worker-development`; every other profile fails closed. The Skill adapter independently re-derives
and byte-compares the complete Capsule and Read Plan authority closure. The evaluator still reads no Skill prose before selection, and its
former raw-envelope CLI is retired.

## Issue completion boundary

Merge of this package is implementation entry, not automatic closure of #346.
The Issue remains open until three different real operations consume the new
path and their receipts demonstrate lower read/tool-call volume without a
missing owner fact. At least one canary must observe a maintainer mutation and
prove `accept-current | external-maintainer-mutation`; the separate explicit
restore path must remain available. These canaries are Evidence consumers of
this contract, not a reason to add another runtime or to run a broad local
suite before merge.

## Seven-item convergence disposition

1. General Run Kernel: retire the proposal after its useful pieces have real
   consumers; never implement another coordinator.
2. Current-state, active pointer and rolling plan: retain the existing parser
   owners, make candidate projection distinct from live-main state, and keep
   rolling plan as a derived human/A0 projection.
3. VerificationSession: retain as the only coordinator; split its pure,
   provider, Git, crash and hosted partitions behind existing public contracts
   instead of replacing it.
4. Affected verification: evolve from test-file selection to requirement and
   Action closure with conservative unresolved fallback.
5. `check:full`: retain only as release/nightly and selector-calibration
   backstop; it is not an edit, finding-fix or ordinary local loop.
6. Skills: first remove already-invalid guidance, then retire an ID/file only
   after a deterministic owner has a real consumer and new-main canary.
7. Candidate fleets: one logical run has one mutable worktree and one active
   ref; finding successors rematerialize in place. Superseded bootstrap
   worktrees/refs are inventory-cleanup targets, not development state.

Items 2-7 are not all prerequisites for #346. This package establishes the
Read Plan dependency first; Issue #275 then performs the Skill consumer
migration, followed by the Verification/affected partition cutover. This order
removes current reading waste immediately without creating another umbrella
control plane or blocking product work behind infrastructure.

## Validation budget

Development feedback is limited to byte/static checks and the five listed
focused contracts. There is no local `check:full`, broad affected gate or
repeated verification after every edit. One final exact-head independent
Review and the currently authorized hosted profile are the promotion boundary.
