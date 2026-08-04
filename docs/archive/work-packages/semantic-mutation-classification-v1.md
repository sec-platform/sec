---
schema: codex-development-work-package-v1
id: semantic-mutation-classification-v1
tracking: issue-215
base: 0fad72008c60e5bcb1805b59d109c8ef41f5b610
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: semantic-mutation-classification
    owner: semantic-mutation-classification-worker
    ownedPaths:
      - platform/compiler/semantic-mutation/isolated-verification-classifier.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/registry/official/ticket.basic/block.manifest.yaml
      - platform/registry/official/collaboration.enterprise-hub/block.manifest.yaml
      - tests/unit/semantic-mutation-verification-adapter.test.ts
      - tests/unit/verification-artifact-claim-summary.test.ts
      - tests/unit/acceptance-coverage-closure.test.ts
      - tests/integration/semantic-mutation-apply.test.ts
  - id: semantic-mutation-classification-control-plane
    owner: a0-integrator
    ownedPaths:
      - docs/work-packages/semantic-mutation-classification-v1.md
      - docs/work-packages/verification-writer-profile-v1.md
      - docs/archive/work-packages/verification-writer-profile-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - AGENTS.md
  - README.md
  - platform/shared/verification-result-contract.ts
  - platform/shared/verification-artifact-contract.ts
  - platform/shared/product-verification-profile.ts
  - platform/shared/acceptance-proof-contract.ts
  - platform/compiler/verify/build-acceptance-coverage.ts
  - platform/compiler/verify/verify-project.ts
  - platform/compiler/verify/run-policy-gate.ts
  - platform/compiler/verify/run-runtime-verification.ts
  - platform/orchestrator/verify-orchestrator.ts
  - platform/shared/test-impact-rules/
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
  - "The isolated runner is split into an execution core and a thin verification/Coverage wrapper: the child and host execution/readback core delegates every status decision to `platform/compiler/semantic-mutation/isolated-verification-classifier.ts`, which is the single passed/failed/blocked authority."
  - "Decision rule: canonical `passed` requires zero child exit and physical fast+runtime pass; canonical `failed` with nonzero child exit is a real physical failure (`failed`); canonical `failed` with zero exit is protocol incoherence (`blocked`); canonical `invalidated`/`unsupported`/`not-run` with any exit is environment/selection/coverage truth (`blocked`), never a product failure."
  - "Reverse invariant: acceptance not executed / unsupported / invalidated never yields `passed` or `failed`; the mutation is rejected as `blocked`, no transaction artifact/journal/publish/rebuild producer runs, and live source stays byte-identical (staged writes uncommitted)."
  - "Serialized verification report, artifact-set, capability-plan and execution-binding shapes stay byte-compatible; no verification-result-contract, artifact-contract, writer profile, coverage builder, trust-root, workflow or package change."
  - "Scope extension (tracked): affected slow e2e selection proved that full-runtime coverage can never close when an official slot declares no acceptance cover; `ticket_comment_delegate` and `on_workflow_approved` now declare their owning acceptance and a registry-wide guard test prevents the defect class. This is necessary consumer closure, not scope creep."
tests:
  - tests/unit/semantic-mutation-verification-adapter.test.ts
  - tests/unit/verification-artifact-claim-summary.test.ts
  - tests/unit/acceptance-coverage-closure.test.ts
  - tests/integration/semantic-mutation-apply.test.ts
---

# semantic-mutation-classification-v1

Issue #215 slice 1B-4. Close Semantic Mutation classification truth after the
1B-3 writer profile: split the isolated runner into execution core plus a thin
verification/Coverage wrapper, and separate real physical failure from
environment/selection/coverage truth.

## Root cause and invariant

The host classifier reduced every non-passed canonical artifact to `failed`
whenever the child exited nonzero, so an unavailable acceptance channel or an
invalidated runtime gate could be misreported as a product failure. The unified
claim summary already distinguishes `failed` from `invalidated`/`unsupported`/
`not-run`; 1B-4 makes the classifier consume that truth and adds a dedicated
reverse invariant proving acceptance-not-executed never publishes.

## Ordered ownership

1. A0 freezes this manifest, atomically archives
   `verification-writer-profile-v1`, and reconciles pointer + rolling plan.
2. The single code Worker owns the thin classifier wrapper, the execution core
   delegation, and the listed tests.
3. A0 alone owns candidate freeze, Review custody, hosted Gate custody,
   expected-head integration, new-main readback, and cleanup.

## Migration boundary

- No serialized field, Gate plan, writer, coverage builder, workflow,
  package/lock, Evidence schema, trust-root or docs/authority.json change.
- The classifier module lives under `platform/compiler/semantic-mutation/` and
  is auto-owned by the existing semantic-mutation test-impact prefix, so no
  test-impact-rules change is needed.
- Issue #215 closes after this slice's new-main readback; old PR #234 is linked
  as a frozen design source and #240/#242 remain frozen until this readback.

## Verification budget

Focused batch is the three listed test files plus affected consumers;
typecheck, docs:doctor, repository audit, one affected run, independent
exact-head Review, hosted Quick, squash merge, and new-main readback complete
the gate sequence.
