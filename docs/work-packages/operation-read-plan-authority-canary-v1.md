---
schema: codex-development-work-package-v1
id: operation-read-plan-authority-canary-v1
tracking: issue-346
base: 67a1d5d5a3b63deec1f051d07dc9e298ad177d11
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - verification-governance
tasks:
  - id: hosted-activation-authority-cutover
    owner: document-control-a0-activation-owner
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - platform/shared/agent-operation-activation-contract.ts
      - platform/shared/ci-trust-root-registry.json
      - platform/shared/tcb-trust-root-contract.ts
      - platform/shared/work-selection-live-contract.ts
      - scripts/codex/agent-operation-activation.ts
      - scripts/codex/work-selection.ts
      - tests/contract/ci-contract.test.ts
      - tests/unit/agent-operation-activation.test.ts
      - tests/unit/work-selection-live.test.ts
  - id: canonical-owner-read-closure
    owner: agent-operation-compiler-owner
    ownedPaths:
      - platform/shared/documentation-authority-contract.ts
      - scripts/codex/operation-read-plan.ts
      - scripts/codex/task-capsule.ts
      - scripts/codex/work-package-contract.ts
      - tests/contract/operation-read-plan.test.ts
      - tests/unit/codex-work-package-contract.test.ts
  - id: skill-consumer-and-impact-cutover
    owner: skill-applicability-owner
    ownedPaths:
      - platform/shared/agent-skill-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - platform/shared/test-impact-rules/verification.ts
      - scripts/codex/skill-applicability.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/skill-applicability-decision.test.ts
  - id: authority-and-control-projection
    owner: development-governance-owner
    ownedPaths:
      - AGENTS.md
      - docs/development-governance.md
      - docs/verification-governance.md
      - docs/work-packages/main-health-repair-unbound-vocabulary-v1.md
      - docs/work-packages/operation-read-plan-authority-canary-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/documentation-authority.test.ts
  - id: generated-trust-closure
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
forbiddenPaths:
  - .agents/
  - .codex/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - docs/roadmap.md
  - package.json
  - platform/compiler/
  - source/
acceptance:
  - the slice is bound to exact main 67a1d5d5a3b63deec1f051d07dc9e298ad177d11 and Issue 346 current spec and remains one branch worktree candidate and PR without v2 v3 repair packages
  - canonical MainHealth run 31549135962 job 93967780894 is reused as the exact unchanged-input reproduction where imports TypeScript and documentation authority command passed and complete-fast reported 118 pass with only documentation-authority line 188 failing on a legacy rolling Issue marker assertion
  - the rolling-plan contract compares parsed active and ordered candidate package topology to the canonical roadmap catalog and no longer requires historical Issue markers or restores hand-maintained 221 352 prose
  - Work Selection binds MainHealth healthRevision rather than volatile ledgerDigest so identical health facts produce stable replayable decision identity while semantic health drift still invalidates the decision
  - repository dispatch is only an at-least-once wake-up and the trusted default-branch workflow independently binds maintainer permission exact live main one draft PR linear candidate ancestry manifest bytes WorkDecision including check-runs and authenticated remote refs and whole Work Package scope before publishing any PRE or FINAL payload while only the trusted checkout retains its read credential
  - request digest concurrency serializes the hosted producer and an identical repeated wake-up validates then joins the sole existing App locator and artifact instead of publishing a duplicate receipt while non-App marker noise is ignored and duplicate or malformed App publications fail closed
  - PRE and FINAL payloads are canonical immutable GitHub Actions artifacts and their GitHub Actions App comments are locators only while the workflow boundary normalizes upload artifact bare SHA256 hex to canonical sha256 prefixed form and consumers revalidate the App artifact digest repository and head repository IDs workflow SHA run attempt job successful upload and publication step presence triggering principal permission PR WorkDecision manifest and whole candidate delta; an App comment published before a later runner crash remains terminal and does not depend on a second step-success credential
  - a candidate workflow local Git ref local file journal caller JSON self-digest same-user ACL or locally recomputable blob cannot be an issuer credential and no compatibility path remains for the rejected refs sec activation transport
  - PRE freezes worker implement git-only authority from a manifest-only draft PR and rederives its ordered rolling topology through the single Work Selection compiler for either the same select-next or post-PR continue-active work; FINAL requires the same PR branch base manifest PRE comment authorized scope and byte-identical current-state pointer and rolling digests plus a live continue-active WorkDecision for the exact final head
  - Work Package authorityRefs are validated against trusted-base docs authority and changed registered documents add their canonical owner or projection target so Task Capsule and Read Plan consume exact AGENTS registry manifest and minimum domain owner closure without a fixed four-ref list or full-repository read
  - Task Capsule Read Plan and Skill consumers rederive the hosted receipts and canonical owner closure while Task Capsule remains unbound planning content with effectAuthority none and scopeGrantId null
  - the manifest-only proposal head consumes PRE to compile the worker planning Capsule Read Plan and Skill decision before implementation while the exact implementation head consumes FINAL for reconciliation so the PRE FINAL canary has no circular post-implementation-only planner
  - activation failures retain a bounded typed reasonCode and raw-detail digest across the Task Capsule boundary rather than collapse provider absence stale scope and provenance conflict into one unverifiable string
  - the public finalize request derives the unique maximal validated ancestral PRE locator from App inventory exact PR base manifest and linear ancestry so a newer same-branch finding repair supersedes an older PRE while divergent maximal PRE generations conflict and no caller-selected comment ID is accepted
  - activation producer and final Skill consumer are canonical TCB runtime entrypoints and the activation source owner composes the unique trusted verifier TCB fast-test closure by reference while the generated closure remains derived only from the registry and exact imports with no parallel hand-maintained module or test list
  - the predecessor manifest is deleted and pointer and rolling topology select only operation-read-plan-authority-canary-v1 plus the four roadmap successors with no tombstone alias tracked Evidence second plan or second mutable candidate
  - this implementation PR is progress only because a producer absent from trusted main cannot issue its own receipt and Issue 275 is the first genuine PRE FINAL canary immediately after merge while Issue 346 stays open for three operations including one real maintainer mutation observation
  - no local code test typecheck affected full docs doctor candidate product CLI hosted Gate or repeated unchanged verification is run and assurance is limited to mechanical import and TCB generation static ownership and schema analysis independent exact-head Review and automatic new-main readback
tests:
  - tests/unit/agent-operation-activation.test.ts
  - tests/unit/main-health-contract.test.ts
  - tests/unit/work-selection-live.test.ts
  - tests/unit/agent-task-capsule.test.ts
  - tests/unit/agent-operation-read-plan.test.ts
  - tests/unit/skill-applicability-decision.test.ts
  - tests/unit/codex-work-package-contract.test.ts
  - tests/contract/operation-read-plan.test.ts
  - tests/contract/skill-applicability.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/ci-lanes.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/unit/tcb-trust-root-contract.test.ts
---

# Operation Read Plan hosted activation authority cutover

This is the bounded production cutover for Issue 346. It replaces the rejected locally forgeable Git-ref
credential with a default-branch GitHub Actions/App producer, immutable artifact payloads, App comment locators,
and full provider/live-state readback. It also makes the Work Package declare its domain authority IDs and lets
the trusted documentation registry compile the minimal owner closure instead of hard-coding four files.

The stale MainHealth relationship assertion remains in this same selected vertical slice because it is a causal
precondition of the live WorkDecision used by the issuer. This PR does not count as a canary and cannot close
Issue 346. After the producer reaches new main, Issue 275 is the first ordinary PRE to FINAL canary; the Issue 346
acceptance stays open until three genuine operations include one real maintainer mutation observation.
