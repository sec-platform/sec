---
schema: codex-development-work-package-v1
id: main-health-repair-tcb-closure-single-owner-v1
tracking: issue-221
base: dae660a84b469e9e6666f3dddab0e7e3ca90a749
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: tcb-closure-single-owner-migration
    owner: tcb-trust-root-owner
    ownedPaths:
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-trusted-bootstrap.yml
      - docs/verification-governance.md
      - platform/shared/ci-trust-root-registry.json
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/tcb-trust-root-contract.ts
      - scripts/codex/verification-session.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/tcb-trust-root-contract.test.ts
      - tests/unit/verification-session-runtime.test.ts
  - id: current-control-projection-reconciliation
    owner: development-document-control-owner
    ownedPaths:
      - docs/work-packages/main-health-repair-shared-dependency-authority-v1.md
      - docs/work-packages/main-health-repair-tcb-closure-single-owner-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .agents/
  - .codex/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/development-governance.md
  - docs/evidence/
  - docs/roadmap.md
  - package.json
  - platform/dev-runner/
  - platform/shared/project-runtime.ts
  - platform/shared/runtime-dependency-spec.ts
  - source/
acceptance:
  - the repair is bound to exact main dae660a84b469e9e6666f3dddab0e7e3ca90a749 and canonical MainHealth run 31546571774 job 93960264719 where imports typecheck documentation authority and 278 fast tests passed while the only failure was TCB closure lock and registry causalRuntimePaths identity parity
  - the successful exact-main runtime cases for missing or drifted transitive packages stale residue reparse roots child aliases hardlinks zero competing package-manager authority and no second install remain reusable and are not rerun
  - trusted bootstrap registry v3 owns only static paths runtime entrypoints and reviewed edges and contains no causalRuntimePaths field alias compatibility reader or generated closure copy
  - TCB_CLOSURE_LOCK modules remain the only frozen causal-runtime identity and one pure trust-root compiler validates required surfaces entrypoints reviewed edge sources static boundaries ordering uniqueness overlap and canonical paths before any consumer may match a path
  - trusted bootstrap and release provider readers obtain causal paths only from the exact trusted-base canonical generated lock object and retain strict UTF-8 schema module count ordering path and envelope validation
  - the trusted-base checker computes its base trust-root view from the base runtime closure before changed-path classification and compares candidate closure only with that derived base closure rather than registry prose
  - registry schema advances to v3 with every production test and workflow consumer migrated in the same exact tree and no v2 compatibility export or consumer remains
  - verification governance records policy-input versus generated-closure ownership so future import graph expansion requires only canonical lock generation and cannot recreate a second hand-maintained module list
  - the published predecessor manifest is deleted and exactly one new selected frozen manifest remains with pointer raw digest binding and no tombstone alias tracked Evidence or second registry
  - one logical run uses exactly one mutable worktree branch and candidate ref with no v2 v3 successor or parallel writer
  - no local code test typecheck affected full docs doctor candidate product CLI or hosted Gate is run and independent exact-head static Review plus exact post-merge MainHealth are the only new assurance steps
tests:
  - tests/contract/ci-contract.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/unit/ci-verification-execution.test.ts
  - tests/unit/tcb-trust-root-contract.test.ts
  - tests/unit/verification-session-runtime.test.ts
---

# MainHealth TCB closure single-owner repair

This package removes the duplicate hand-maintained causal module inventory that allowed the generated lock and
provider policy registry to drift. The registry keeps only policy inputs; the generated lock owns the derived
closure; consumers receive one compiled trust-root view. No successful runtime dependency behavior is reopened.
