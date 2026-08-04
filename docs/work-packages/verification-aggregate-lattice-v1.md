---
schema: codex-development-work-package-v1
id: verification-aggregate-lattice-v1
tracking: issue-215
base: a74a45730db40128b7ddc3916e7caa31c9d12ff1
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: verification-aggregate-lattice
    owner: verification-contract-worker
    ownedPaths:
      - platform/shared/verification-result-contract.ts
      - tests/contract/verification-result-contract.test.ts
      - tests/unit/verification-result-core.test.ts
      - tests/unit/verification-result-proof-identity.test.ts
  - id: verification-aggregate-control-plane
    owner: a0-integrator
    ownedPaths:
      - docs/work-packages/verification-aggregate-lattice-v1.md
      - docs/work-packages/verification-artifact-claim-summary-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/archive/work-packages/verification-artifact-claim-summary-v1.md
forbiddenPaths:
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - AGENTS.md
  - README.md
  - platform/dev-runner/
  - platform/orchestrator/
  - platform/compiler/verify/
  - platform/shared/product-verification-claim-plan.ts
  - platform/shared/verification-artifact-contract.ts
  - platform/shared/verification-types.ts
  - scripts/codex/
  - scripts/ci-verification.ts
  - scripts/ci-pr-risk.ts
  - .github/workflows/
  - docs/authority.json
  - docs/work/current-state.yaml
  - tests/testkit/
  - tests/e2e/
  - source/
  - project/
  - control/
acceptance:
  - "platform/shared/verification-result-contract.ts exports the canonical owning-environment identity function and one aggregate writer whose status competition is order-independent with fixed lattice `failed > invalidated > unsupported > not-run > passed`; a later `invalidated` observation always outranks an earlier `not-run` observation regardless of input order, and `claimResults` are emitted in deterministic claimId order so the canonical projection cannot depend on input sequence."
  - "`owningEnvironments` participate in both filtering and determination: an observation whose environment is not an owning environment never changes an owning claim's status or proof identity; a claim with no applicable observation is `not-run` with `current-runner-not-owning-environment`, and a gate with no observations is `not-run` with `not-dispatched`."
  - "Duplicate claim IDs and duplicate gate observations (same gateId + same environment identity) fail closed at aggregate-input validation; empty claims and empty required gates fail closed (empty aggregate is `invalidated`/`selection-unresolved` and an empty requiredGateIds list is rejected); zero test truth can never manufacture `passed`."
  - "Logical proof identity binds gate revision, owner, requirement key, subject revision, input digest, sorted claim bindings and canonical invalidation rules; two owning observations with different proof identity jointly invalidate a pass (`selection-unresolved`) unless a real owning failure outranks the conflict."
  - "A reused passed gate requires a non-null environment identity and non-empty evidenceRefs, so reused evidence is always bound to an owning environment before it can authorize a claim."
  - "The serialized aggregate assertion still recomputes the canonical writer output from the trusted claim plan and gate observations and requires exact structural equality; the current product claim plans (`all` and `fast` lane orders fast/policy/runtime and fast/policy) already coincide with claimId sort order, so writer/artifact bytes remain unchanged for every current product projection."
  - "Strict data-only snapshot boundaries, unknown-key rejection, and proxy/getter/toJSON rejection remain owned by the same contract and are preserved; the aggregate never parses owningEnvironments as delimited text."
tests:
  - tests/contract/verification-result-contract.test.ts
  - tests/unit/verification-result-core.test.ts
  - tests/unit/verification-result-proof-identity.test.ts
---

# verification-aggregate-lattice-v1

Issue #215 slice 1B-1. Make the canonical Verification aggregate order-independent,
owning-environment-aware and proof-identity-bound while keeping every current
writer/artifact byte projection unchanged.

## Root cause and invariant

The aggregate writer accepted gate/claim input order as authority: its overall
reducer stopped upgrading once a non-passed claim was seen, so `[not-run,
invalidated]` input settled on `not-run` while `[invalidated, not-run]` settled
on `invalidated`. `owningEnvironments` were declared but never used, so a
non-owning observation could poison an owning claim's status and proof identity.
Duplicate gate results were rejected by gateId alone (preventing legitimate
multi-environment observations) while duplicate observations for the same
environment were not distinguished; an empty claim set produced overall
`passed`; and reused evidence without an environment identity could authorize a
claim with no owning-environment proof.

The aggregate must be a pure function of the claim plan and the observation
set: fixed status lattice, exact observation identity, owning-environment
filtering, logical proof identity, and deterministic claimId-ordered output.

## Ordered ownership

1. A0 freezes this manifest and atomically reconciles the pointer, rolling plan,
   and prior manifest archive (`verification-artifact-claim-summary-v1`).
2. The single code Worker changes only `verification-result-contract.ts` and the
   three listed test files: adds the environment-identity function, the
   order-independent lattice, owning-environment-aware observation filtering,
   logical proof identity, duplicate observation/claim rejection, empty-truth
   fail-closed semantics, and the reused-environment binding, then proves the
   current writer/artifact projections remain byte-identical.
3. A0 alone owns candidate freeze, Review custody, hosted Gate custody,
   expected-head integration, new-main readback, and cleanup.

## Migration boundary

- No serialized field, Gate plan, workflow, package/lock, Evidence schema, or
  trust-root file changes.
- The environment identity projection stays byte-compatible with the current
  product claim plan (`<os>-<arch>`); any future projection change must move all
  producers in one lockstep Work Package.
- Writer integration (`1B-3`), Acceptance Coverage (`1B-2`), and Semantic
  Mutation classification (`1B-4`) remain separate successor packages.

## Verification budget

Focused batch is the three listed contract/unit files plus affected consumers;
typecheck, docs:doctor, repository audit, one affected run, independent
exact-head Review, hosted Quick, squash merge, and new-main readback complete
the gate sequence.
