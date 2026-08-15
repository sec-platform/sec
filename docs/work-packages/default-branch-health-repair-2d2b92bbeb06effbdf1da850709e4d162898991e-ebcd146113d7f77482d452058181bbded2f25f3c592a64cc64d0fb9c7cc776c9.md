---
schema: codex-development-work-package-v1
id: default-branch-health-repair-2d2b92bbeb06effbdf1da850709e4d162898991e-ebcd146113d7f77482d452058181bbded2f25f3c592a64cc64d0fb9c7cc776c9
tracking: none
base: 2d2b92bbeb06effbdf1da850709e4d162898991e
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - documentation-registry
  - verification-governance
tasks:
  - id: hosted-pre-work-package-census
    owner: development-governance-owner
    ownedPaths:
      - docs/development-governance.md
      - scripts/codex/agent-operation-activation-census.ts
      - scripts/codex/agent-operation-activation.ts
      - tests/unit/agent-operation-activation.test.ts
  - id: main-health-package-census-repair
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/default-branch-health-repair-2d2b92bbeb06effbdf1da850709e4d162898991e-ebcd146113d7f77482d452058181bbded2f25f3c592a64cc64d0fb9c7cc776c9.md
      - docs/work-packages/operation-read-plan-authority-canary-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
  - id: hosted-pre-tcb-regeneration
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
  - id: hosted-pre-test-impact-closure
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/test-impact-rules/governance.ts
      - tests/contract/test-impact.test.ts
forbiddenPaths:
  - .agents/
  - .codex/
  - .github/
  - .githooks/
  - AGENTS.md
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - docs/roadmap.md
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - scripts/run-work-package-gate.ts
  - source/
acceptance:
  - exact degraded main 2d2b92bbeb06effbdf1da850709e4d162898991e tree 18c3dffb4a992e0c78348bd8cc2d46099058e539 MainHealth run 31851466230 job 94927906666 health revision sha256:53128af8e039fb7b1add22cde6883185b467d590c877c00702c62ca3452cc6c0 ledger sha256:747f400e463caf8b9bb0048f5705c13b85418a7fb93dea79bc1b53284200e56e and failure fingerprint sha256:3f059d3831af76dc74ca8c7813d9f47b457b753623a7090488dda2b42e54f946 are bound
  - the failure is the exact stale operation-read-plan-authority-canary-v1 manifest retained beside the ordinary controlled-pr-issue-disposition-single-writer-v1 package; unchanged MainHealth is not retried before the candidate changes
  - the repair deletes only that stale second package while retaining the byte-exact issue-352 manifest as the one canonical delayed predecessor of this tracking-none repair
  - hosted PRE enumerates the exact base and proposal Git-tree Work Package paths once and consumes the same pure census contract as docs doctor and repository audit
  - an ordinary proposal retaining any nonselected package is activation-scope-conflict before artifact or App locator publication; all base packages the census requires removed are part of the exact changed-record and manifest ownership closure
  - a recovery proposal may retain only the existing byte-exact canonical roadmap predecessor selected by the census; ambiguous modified foreign or extra package files fail closed
  - the selected manifest bytes already authenticated by readCandidateControl are reused for the census and are not read a second time
  - the focused activation test executes the exact production census validator with a selected-only positive and retained-stale negative; source assertions alone are not accepted as the regression proof
  - the new pure census module is one declared source of the existing agent-operation-activation test-impact owner and a module-only delta selects its full fast closure without auto-reference fallback
  - development governance records the PRE census boundary and no parallel package-retirement algorithm compatibility alias caller digest or local credential writer is introduced
  - the final TCB closure is regenerated after source and test-impact ownership stabilization and its exact lock check remains current
  - focused activation documentation authority docs doctor TCB typecheck imports and diff closures pass before independent exact-head Review
  - after exact new-main readback one content-addressed MainHealth run is healthy, issue 352 receives exact completion disposition, WorkDecision advances to issue 186, and this repair worktree branch remote and tracking refs close through receipt-backed physical readback
tests:
  - tests/unit/agent-operation-activation.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/test-impact.test.ts
  - tests/unit/tcb-trust-root-contract.test.ts
---

# MainHealth Work Package census repair

The previous ordinary transition removed the temporary repair manifest but
left its delayed catalog predecessor beside the newly selected package. This
repair closes that exact census and moves the same invariant into the hosted
PRE issuer so an invalid package handoff cannot obtain scope authority again.
