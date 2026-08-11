---
schema: codex-development-work-package-v1
id: work-selection-live-projection-v1
tracking: issue-221
base: 20d50bd9ecc5ab156b5728f724bf658eded15b44
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: work-selection-live-adapter
    owner: development-work-selection-owner
    ownedPaths:
      - docs/development-governance.md
      - docs/roadmap.md
      - docs/work-packages/document-control-replan-recovery-v1.md
      - docs/work-packages/work-selection-live-projection-v1.md
      - docs/work/README.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/test-impact-rules/governance.ts
      - platform/shared/work-selection-contract.ts
      - platform/shared/work-selection-live-contract.ts
      - scripts/codex/work-selection.ts
      - tests/contract/documentation-authority.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/work-selection-contract.test.ts
      - tests/unit/work-selection-live.test.ts
  - id: branch-lifecycle-selection-projection
    owner: development-branch-lifecycle-owner
    ownedPaths:
      - platform/shared/test-impact-rules/verification.ts
      - scripts/codex/branch-lifecycle-audit.ts
      - scripts/codex/verification-session.ts
      - tests/unit/branch-lifecycle-contract.test.ts
      - tests/unit/verification-candidate-tree.test.ts
  - id: document-control-selection-consumer
    owner: development-document-control-owner
    ownedPaths:
      - scripts/codex/document-control-plane-contract.ts
      - scripts/codex/document-control-plane.ts
      - tests/contract/document-control-plane-lifecycle.test.ts
forbiddenPaths:
  - .agents/
  - .codex/
  - .github/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - scripts/codex/branch-closeout-contract.ts
  - scripts/codex/branch-closeout.ts
  - scripts/codex/verification-session-runtime.ts
acceptance:
  - one strict normalized work catalog is embedded inside the canonical roadmap owner and no second roadmap registry backlog or Issue prose parser is created
  - the catalog contains only maintainer adopted selection fields and current spec references while raw Issue title body comment and provider diagnostics never become selector instructions
  - the live adapter binds exact live default exact roadmap bytes bounded registry and lifecycle projections and exact current spec body digests before compiling the existing pure WorkDecision
  - missing malformed stale incomplete or contradictory repository provider registry lifecycle or current spec facts return one typed unresolved result and never silently fall back to rolling prose caller JSON or local tracking refs
  - a decision receipt is replay evidence only and every effectful consumer rederives it inside the trusted adapter against the exact main instead of trusting caller supplied receipt bytes
  - the rolling projection is rendered only from a validated select next decision and the same bound catalog and contains exactly one current package plus two to five ordered conditional candidates
  - document control keeps its existing pure promotion fast path and invokes live selection only when candidate replenishment or topology replacement is required
  - the same-package fast path binds the exact current package id and tracking tuple and rejects any tracking replacement before repository object index journal or control effects
  - document control passes its already observed exact local default into selection and retains one live remote default admission before any repository object index journal pointer or rolling publication
  - effectful freeze executes the clean protected main control surface and targets one physically distinct codex candidate through an explicit workspace argument while the live adapter resolves authority from the unique remote HEAD projection rather than candidate HEAD bytes
  - required selection presence is enforced again by the pure freeze contract and derived successor count plus roadmap directness are compiled rather than persisted in the roadmap catalog
  - blocked ready successor count reuses the Phase A candidate evaluator after satisfying only the candidate direct edge and excludes deferred completed superseded multi-blocked and otherwise ineligible successors
  - the selected manifest tracking identity and package id must equal the rederived WorkDecision target and any other topology request is rejected before publication
  - the current two candidate dead end is migrated once in this reviewed bootstrap and all later candidate replenishment is machine derived with no manual topology editing fallback
  - trusted current state activates the live selection requirement from default branch bytes so candidate removal of the roadmap block or feature marker cannot restore the legacy promotion path
  - each selected slice leaves its completion manifest on main until the next decision consumes it then the next slice deletes that superseded manifest and advances the bounded catalog without tombstone files
  - one logical run retains one mutable worktree branch and candidate ref and this package creates no v2 v3 successor or parallel writer
  - provider calls are bounded to current catalog resources and open lifecycle facts and do not scan Issue prose history comments or the unbounded backlog
  - MainHealth is produced only by the canonical exact-main check ledger and freshness resolver while active candidate and closeout facts are produced only by the bounded branch lifecycle owner which inventories every non-default ref and worktree namespace and treats missing locked stale contradictory or unexplained projections as unresolved or closeout required
  - an active pull request is legal only when its exact base branch and base revision bind the canonical live default and its head branch revision remote ref and optional worktree agree
  - roadmap catalog JSON rejects duplicate decoded keys at every object depth before schema normalization so last-key-wins parsing cannot rewrite selection facts
  - test impact assigns the shared branch lifecycle owner to its direct branch closeout and work selection consumers so the minimal selected closure cannot omit the new projection contract
  - the canonical MainHealth test impact owner explicitly selects the Work Selection cross owner consumer so a ledger or lane contract change cannot bypass the integration closure
  - WorkDecision and rolling rendering remain read only and cannot create branches pull requests merge close Issues or authorize Verification
  - the previous published document control manifest is deleted in the same transition and no tracked evidence archive or temporary receipt is added
  - validation is limited to static ownership schema digest TCB closure generation and independent exact head review with no code test typecheck affected full or hosted Gate execution
tests:
  - tests/unit/branch-lifecycle-contract.test.ts
  - tests/unit/verification-candidate-tree.test.ts
  - tests/unit/work-selection-contract.test.ts
  - tests/unit/work-selection-live.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/test-impact.test.ts
---

# Work Package: Work Selection Live Projection V1

This package completes Issue #221 Phase B/C without introducing another plan
or backlog. `docs/roadmap.md` remains the only durable stage owner and carries a
strict machine-readable projection of the bounded current stage. The live
adapter combines that projection with exact repository, registry, closeout,
conflict and current-spec observations, then invokes the existing Phase A pure
selector.

The current control bytes contain only two candidates, while the existing
freeze contract requires two candidates to remain after promotion. That makes
normal activation impossible. This package is therefore the one reviewed
bootstrap transition: it activates itself and replenishes the bounded queue in
one exact candidate. The delivered control path subsequently rederives the
WorkDecision before any topology replacement, so this manual bootstrap is not
a reusable compatibility path.

The live receipt is not a signature and never becomes standalone authority.
The document-control consumer invokes the trusted adapter against its already
bound exact base and compares the selected Work Package identity before any
publication. Provider failure produces `unresolved`; rolling prose and caller
JSON are never fallback facts.

Phase B composes existing owners rather than replacing them: exact check runs
enter the canonical MainHealth ledger and fresh lane resolver; the bounded #313
branch-lifecycle projection owns active transport legality and closeout residue;
document-control owns pointer/rolling/manifest consistency. The selector only
consumes those typed decisions. Its successor metric replays the Phase A
eligibility evaluator after satisfying one direct edge, and the roadmap JSON
boundary rejects duplicate decoded keys before normalization.
