---
schema: codex-development-work-package-v1
id: verification-writer-profile-v1
tracking: issue-215
base: 335ffdbe1279e4284babf6f3133846970e7ac8ee
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: verification-writer-profile
    owner: verification-contract-worker
    ownedPaths:
      - platform/shared/product-verification-profile.ts
      - platform/compiler/verify/verify-project.ts
      - platform/compiler/verify/run-policy-gate.ts
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/staged-verification-proof.ts
      - platform/orchestrator/verify-orchestrator.ts
      - platform/shared/verification-artifact-contract.ts
      - platform/shared/test-impact-rules/verification.ts
      - tests/unit/product-verification-profile.test.ts
      - tests/unit/verification-artifact-claim-summary.test.ts
      - tests/unit/verification-claim-migration.test.ts
      - tests/unit/semantic-mutation-verification-adapter.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/unit/staged-verification-proof.test.ts
      - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
      - tests/integration/semantic-mutation-apply.test.ts
  - id: verification-writer-control-plane
    owner: a0-integrator
    ownedPaths:
      - docs/work-packages/verification-writer-profile-v1.md
      - docs/work-packages/verification-acceptance-coverage-v1.md
      - docs/archive/work-packages/verification-acceptance-coverage-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - AGENTS.md
  - README.md
  - platform/dev-runner/
  - platform/shared/acceptance-proof-contract.ts
  - platform/compiler/verify/build-acceptance-coverage.ts
  - platform/shared/verification-result-contract.ts
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
  - "platform/shared/product-verification-profile.ts is the single current-writer profile: gate/claim IDs, revisions, environment identity, lane selection, normal/blocked writers, runtime-mode inference and policy applicability are owned there; verify-project, run-policy-gate, run-runtime-verification, verify-orchestrator and the artifact validator consume only its projections; the legacy product-verification-claim-plan module is removed."
  - "No-policy fast verification remains physically valid while the not-applicable Policy claim is omitted from aggregate requirements; policy status/violation inventory contradictions stay fail-closed."
  - "Full-runtime PASS requires nonblank executed build/unit/acceptance inventories and command identity plus complete semantic Acceptance Coverage; zero-test pseudo-pass becomes a canonical failed summary (never passed), and blocked snapshots remain distinct from ordinary physical failure."
  - "The artifact validator recomputes the expected claimSummary from the profile for the exact lane/fast/runtime/policy/coverage/blocked inputs and requires structural equality; legacy no-claimSummary reports stay diagnostic-only."
  - "Semantic Mutation classification keeps its semantics unchanged while its input boundary is corrected: untrusted disk artifacts pass the strict data snapshot and the trusted in-process semantic bundle is validated structurally, so frozen production bundles cannot poison the canonical check; staged-proof registration asserts canonicality before deep-freezing."
  - "Current writer call sites and serialized report keys stay byte-compatible for all canonical product projections; no Gate plan, workflow, package/lock, Evidence schema, docs/authority.json or trust-root change beyond the explicitly declared `platform/shared/test-impact-rules/verification.ts` manual bootstrap."
  - "platform/shared/test-impact-rules/verification.ts extends `verification-truth` ownership to the removed product-verification-claim-plan.ts and the profile/artifact sources; because test-impact rules are a verifier trust root, this package is integrated through trusted-base manual bootstrap rather than candidate-hosted Quick self-certification."
  - "Scope extension (tracked): affected selection proved that the new no-policy/full-runtime truth invalidates the real Semantic Mutation consumer `tests/integration/semantic-mutation-apply.test.ts`; its acceptance fixture now executes a real Playwright-run acceptance spec (browserless, asserting the staged mutation result) plus a fixture-local /login route for harness readiness, and the semantic-contract index binds the default resolved `entity/customer-basic` block so full-runtime acceptance coverage closes with real executed evidence. This is necessary consumer closure, not scope creep."
tests:
  - tests/unit/product-verification-profile.test.ts
  - tests/unit/verification-artifact-claim-summary.test.ts
  - tests/unit/verification-claim-migration.test.ts
  - tests/unit/semantic-mutation-verification-adapter.test.ts
  - tests/unit/semantic-mutation-isolated-child-fence.test.ts
  - tests/unit/staged-verification-proof.test.ts
  - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
  - tests/integration/semantic-mutation-apply.test.ts
  - tests/unit/coverage.test.ts
  - tests/unit/acceptance-coverage-closure.test.ts
  - tests/unit/verification-result-core.test.ts
  - tests/unit/verification-result-proof-identity.test.ts
  - tests/contract/verification-result-contract.test.ts
---

# verification-writer-profile-v1

Issue #215 slice 1B-3. Consolidate the current product writer behind one
profile, omit not-applicable Policy claims under no-policy, require real
full-runtime execution truth, and keep blocked snapshots distinct.

## Root cause and invariant

Gate/claim identity and lane selection were spread across verify-project,
run-policy-gate and run-runtime-verification; no-policy fast verification still
carried a not-applicable Policy claim into aggregate requirements; a full-runtime
`passed` lane with empty inventories could produce a green aggregate; and the
classifier/staged-proof layers snapshotted trusted in-process frozen bundles as
if they were untrusted disk artifacts.

One current-writer profile must own every projection, and verification truth
must be a pure function of executed physical facts plus the trusted plan.

## Ordered ownership

1. A0 freezes this manifest and atomically reconciles the pointer, rolling plan,
   and prior manifest archive (`verification-acceptance-coverage-v1`).
2. The single code Worker owns the profile, all writers, the artifact validator,
   the classifier input boundary, staged-proof freeze order, and the listed
   tests.
3. A0 alone owns candidate freeze, Review custody, hosted Gate custody,
   expected-head integration, new-main readback, and cleanup.

## Migration boundary

- No serialized field, Gate plan, workflow, package/lock, Evidence schema, or
  trust-root file changes.
- Semantic Mutation classification semantics (`1B-4`) remain a successor
  package; this slice only corrects the classifier input boundary.

## Verification budget

Focused batch is the twelve listed files plus affected consumers; typecheck,
docs:doctor, repository audit, one affected run, independent exact-head Review,
hosted Quick, squash merge, and new-main readback complete the gate sequence.
