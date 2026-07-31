---
schema: codex-development-work-package-v1
id: exact-default-base-identity-v1
tracking: none
base: ea41e264f5448f2005dd141514bcd6f7e546c1cd
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: fix-repository-audit-default-base
    owner: exact-base-worker
    ownedPaths:
      - scripts/codex/repository-audit.ts
      - tests/contract/repository-audit.test.ts
      - platform/shared/ci-execution-environment.ts
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/exact-default-base-identity-v1.md
      - docs/archive/work-packages/verification-result-claim-migration-v1.md
forbiddenPaths:
  - bun.lock
  - package.json
  - platform/shared/verification-result-contract.ts
  - platform/shared/verification-types.ts
  - platform/shared/ci-artifact-contract.ts
  - platform/shared/ci-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/verification-artifact-contract.ts
  - platform/compiler/verify/verify-project.ts
  - platform/compiler/verify/run-runtime-verification.ts
  - platform/compiler/verify/run-policy-gate.ts
  - platform/orchestrator/verify-orchestrator.ts
  - scripts/codex/sec-merge-bootstrap.ts
  - scripts/codex/work-package-contract.ts
  - scripts/codex/parallel-work-package-contract.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/ci-verification.ts
  - scripts/ci-pr-risk.ts
  - .github/workflows/
  - docs/work/current-state.yaml
  - tests/e2e/
  - tests/unit/verification-claim-migration.test.ts
  - tests/unit/verification-result-core.test.ts
acceptance:
  - "scripts/codex/repository-audit.ts auditRepository accepts options.defaultRef as exact commit SHA or ref; when provided, uses it instead of refs/remotes/origin/main; CLI supports --default-ref <value>."
  - "scripts/codex/repository-audit.ts when defaultRef is an exact SHA, uses git show <sha>:<path> and git rev-parse <sha> without requiring remote-tracking ref existence."
  - "scripts/codex/repository-audit.ts reports structured unknowns when default ref object is missing, not a commit, or SHA is malformed; fail-closed preserved."
  - "scripts/codex/repository-audit.ts CLI --default-ref takes precedence; env SEC_REPOSITORY_AUDIT_DEFAULT_REF is read only when CLI flag absent; no other inference paths."
  - "platform/shared/ci-execution-environment.ts forwards SEC_CHANGED_BASE to child gate env (existing behavior preserved); no new ambient keys added unless strictly required."
  - "tests/contract/repository-audit.test.ts covers: (1) shallow repo with head+parent only, no origin/main, exact base SHA passed → audit passes; (2) same checkout without default-base → fail closed; (3) nonexistent object/tree/blob/wrong-SHA → unresolved/non-zero; (4) base not head direct parent → rejected; (5) local live refs/remotes/origin/main resolves and reports head; (6) stale ref vs exact base semantics distinguished; (7) control-plane manifest exists/missing/matching-digest on exact base; (8) persist-credentials:false unchanged, no network fetch; (9) candidate env cannot override trusted base; (10) SEC_CHANGED_BASE forwarded to audit in CI mode."
tests:
  - tests/contract/repository-audit.test.ts
---

# Work Package: exact-default-base-identity-v1

Issue #212. Trust-root repair.

## Problem

PR #210 removed the unauthenticated redundant `git fetch` from `compiler-pr-validation.yml` to preserve `persist-credentials: false`. PR #211's hosted run then exposed a deeper root cause: Hosted shallow checkout contains exact PR head + its direct parent, but does NOT create `refs/remotes/origin/main`. `auditRepository()` defaults to `refs/remotes/origin/main` as default branch identity, so it reports `default ref unavailable`, failing `tests/contract/repository-audit.test.ts` (part of `test:fast`), blocking all subsequent hosted verification.

## Fix

Establish a **Repository Audit Default-Base Identity Contract**:

1. **Explicit input contract**: `auditRepository()` accepts `options.defaultRef` as an exact commit SHA or ref string. CLI adds `--default-ref <value>`. Env `SEC_REPOSITORY_AUDIT_DEFAULT_REF` is read only when CLI flag is absent. No other inference paths.

2. **Hosted wiring**: CI test suite (`tests/contract/repository-audit.test.ts`) passes `SEC_CHANGED_BASE` (already validated 40-hex SHA by `ci-execution-environment.ts`) as the default-ref when `refs/remotes/origin/main` is unavailable. No raw fetch restored. No `persist-credentials: true`.

3. **Audit semantics**: `git show <exactBase>:<manifest>` and `git rev-parse <exactBase>` use the same exact base. Default ref unavailable remains unknown/fail-closed, but supported shallow CI must not fail due to missing remote-tracking ref. Stale base, wrong parent, missing object, merge commit, multi-parent head, fork/unsupported shape produce structured results.

4. **Trust route**: This package modifies the repository audit trust root. It must be verified by the old trusted base-side runner or explicit manual bootstrap path, not self-proven by the candidate's new audit. Final acceptance requires a subsequent non-trust-root PR whose hosted verification completes normally.

## Out of Scope

- Unified verification result contract (`verification-result-contract.ts`)
- CI contract, workflow files (`.github/workflows/`)
- Merge-gate infrastructure
- Product compiler code
- package.json / lockfile
- Test impact, runtime, e2e tests
