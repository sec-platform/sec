---
schema: codex-development-work-package-v1
id: verification-acceptance-coverage-v1
tracking: issue-215
base: 0cd22ba972163c9f8653c6cf02bc1d25bab1c4c1
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: acceptance-proof-contract
    owner: verification-contract-worker
    ownedPaths:
      - platform/shared/acceptance-proof-contract.ts
      - platform/compiler/verify/build-acceptance-coverage.ts
      - platform/shared/verification-artifact-contract.ts
      - platform/shared/test-impact-rules/verification.ts
      - tests/unit/coverage.test.ts
      - tests/unit/acceptance-coverage-closure.test.ts
      - tests/unit/verification-artifact-claim-summary.test.ts
      - tests/contract/test-impact.test.ts
  - id: verification-acceptance-control-plane
    owner: a0-integrator
    ownedPaths:
      - docs/work-packages/verification-acceptance-coverage-v1.md
      - docs/work-packages/verification-aggregate-lattice-v1.md
      - docs/archive/work-packages/verification-aggregate-lattice-v1.md
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
  - platform/orchestrator/
  - platform/compiler/verify/verify-project.ts
  - platform/compiler/verify/run-runtime-verification.ts
  - platform/compiler/verify/run-policy-gate.ts
  - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
  - platform/shared/product-verification-claim-plan.ts
  - platform/shared/product-verification-profile.ts
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
  - "platform/shared/acceptance-proof-contract.ts is the single machine contract for the physical test-file → semantic acceptance-ID relation: canonical test paths are unique, safe-relative, `tests/`-rooted, `.test/.spec.tsx?`-shaped; bindings reject duplicate paths and invalid/duplicate/unsorted acceptance IDs; executed paths are unique-sorted and mapped through the immutable registry."
  - "buildAcceptanceCoverage consumes both fast and runtime acceptance reports (restoring fast from the matching canonical verification report on readback), maps executed physical paths to proven acceptance IDs, and never promotes an empty or unproven physical result into a full-plan pass."
  - "Coverage target closure fails closed: every acceptance target reference must resolve to a declared resolved block/slot; every plan acceptance ID must be declared and cover at least one resolved block or slot; dependency IDs must be declared; cyclic or missing dependencies remain uncovered (never satisfied); unknown physical paths create no semantic proof."
  - "Artifact readback recomputes `acceptancePassed` from the fast/runtime physical reports through the same contract and requires exact equality with the serialized value; each coverage entry's coveredBy must be a subset of its declaredAcceptance and of the accepted set, uncovered must equal declared-empty or partial coverage, block/slot IDs must be unique, and uncovered arrays must match the entries."
  - "Current writer call sites (verify-project, isolated child) remain source-compatible: the optional fast argument is provided directly where available and restored from the canonical verification report otherwise; no serialized report key or Gate plan changes."
  - "platform/shared/test-impact-rules/verification.ts gains the single `verification-truth` ownership declaration for the three coverage/artifact source files; because test-impact rules are a verifier trust root, this package is integrated through trusted-base manual bootstrap rather than candidate-hosted Quick self-certification."
tests:
  - tests/unit/coverage.test.ts
  - tests/unit/acceptance-coverage-closure.test.ts
  - tests/unit/verification-artifact-claim-summary.test.ts
  - tests/unit/verification-claim-migration.test.ts
  - tests/unit/semantic-mutation-verification-adapter.test.ts
  - tests/unit/verification-result-core.test.ts
  - tests/unit/verification-result-proof-identity.test.ts
  - tests/contract/verification-result-contract.test.ts
---

# verification-acceptance-coverage-v1

Issue #215 slice 1B-2. Introduce the single physical-path → semantic
acceptance-ID machine contract, make Coverage target/dependency closure fail
closed, and recompute `acceptancePassed` on artifact readback.

## Root cause and invariant

The previous coverage builder accepted semantic IDs directly from the runtime
report and silently promoted a passed runtime lane with an empty physical
result to the entire acceptance plan; duplicate acceptance definitions merged
by first-wins; unknown executed paths created no signal; dependencies missing
from the plan or forming cycles were treated as satisfied; and the artifact
validator trusted the serialized `acceptancePassed` instead of recomputing it.

The physical test path → semantic acceptance-ID relation must live in one
immutable machine contract, and Coverage truth must be a pure function of that
contract plus the executed physical paths and the trusted lock plan.

## Ordered ownership

1. A0 freezes this manifest and atomically reconciles the pointer, rolling plan,
   and prior manifest archive (`verification-aggregate-lattice-v1`).
2. The single code Worker owns the proof contract, the coverage builder, the
   artifact readback recomputation, and the listed test files.
3. A0 alone owns candidate freeze, Review custody, hosted Gate custody,
   expected-head integration, new-main readback, and cleanup.

## Migration boundary

- No serialized field, Gate plan, workflow, package/lock, Evidence schema, or
  trust-root file changes.
- Writer profile (`1B-3`) and Semantic Mutation classification (`1B-4`) remain
  separate successor packages; verify-project call sites stay source-compatible.
- The acceptance-proof binding registry is the current machine owner for the
  existing official fixtures; product-specialization removal is owned by Phase
  3A (test-ownership derivation from plan/lock).

## Verification budget

Focused batch is the eight listed contract/unit files plus affected consumers;
typecheck, docs:doctor, repository audit, one affected run, independent
exact-head Review, hosted Quick, squash merge, and new-main readback complete
the gate sequence.
