---
schema: codex-development-work-package-v1
id: issue-disposition-safety-v1
tracking: issue-352
base: eccdfee5280119cfbba82f01d421a5f0ec9765e4
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: issue-disposition-safety
    owner: development-integration-closeout-owner
    ownedPaths:
      - .github/workflows/sec-merge-gate.yml
      - docs/development-governance.md
      - docs/roadmap.md
      - docs/work-packages/issue-disposition-safety-v1.md
      - docs/work-packages/work-discovery-and-plan-convergence-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/shared/issue-disposition-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - scripts/codex/issue-disposition-github.ts
      - scripts/codex/issue-disposition.ts
      - scripts/codex/verification-session-github.ts
      - scripts/codex/verification-session.ts
      - tests/contract/documentation-authority.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/issue-disposition-contract.test.ts
      - tests/unit/issue-disposition-github.test.ts
      - tests/unit/verification-session-runtime.test.ts
  - id: trust-runtime-recovery
    owner: development-trust-transition-owner
    ownedPaths:
      - .github/workflows/sec-trusted-bootstrap.yml
      - .githooks/post-checkout
      - .githooks/post-merge
      - .githooks/post-rewrite
      - .githooks/pre-commit
      - .githooks/pre-push
      - docs/verification-governance.md
      - platform/dev-runner.ts
      - platform/dev-runner/dependency-bootstrap.ts
      - platform/shared/tcb-closure-lock.ts
      - scripts/install-git-hooks.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/unit/dev-runner-dependency-bootstrap.test.ts
      - tests/unit/install-git-hooks.test.ts
forbiddenPaths:
  - .codex/
  - AGENTS.md
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - package.json
  - platform/compiler/
  - scripts/codex/branch-closeout-contract.ts
  - scripts/codex/branch-closeout-receipt.ts
  - scripts/codex/branch-closeout.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/local-main-closeout.ts
acceptance:
  - GitHub lexical closing keywords and manually linked closing issues have zero authority in every controlled pull request title body and generated merge message
  - the canonical pull request renderer emits one exact Work Package locator and one explicit progress-only or close-tracking-after-readback field while rejecting all closing lexical patterns including negation mixed case optional colon cross-repository full-URL and multiple-Issue forms
  - candidate observation rejects GraphQL partial errors binds title body digest and proves the complete bounded closing-issue reference set with stable totalCount before revalidating immediately before the sole merge effect
  - post-main IssueDisposition binds repository Issue current-spec revision stable acceptance IDs exact new-main commit and tree and available evidence while explicitly recording that trusted completion assessment is unavailable
  - VerificationSession cannot manufacture satisfied acceptance status or zero work child consumer census and therefore every current disposition is progressed with zero Issue mutation authority
  - GitHub Issue PATCH is not represented as CAS because the provider exposes no documented conditional unsafe mutation and the production adapter contains no close or reopen writer effect-start or terminal receipt
  - post-merge reconciliation returns manual-action-required only when the latest provider ClosedEvent causally names the exact merged pull request and merge commit and otherwise returns typed no-op or blocked without mutation
  - VerificationSession remains the sole run coordinator while IssueDisposition alone owns Issue lifecycle decisions and branch closeout remains unchanged
  - the hosted integration workflow performs read-only unexpected-close reconciliation after merge readback stops on maintainer action and observes tracking-Issue progress only after exact post-merge MainHealth
  - the previous selected manifest is retired and no v2 v3 parallel candidate branch second coordinator compatibility alias or general Issue-management SDK is introduced
  - validation is limited to direct IssueDisposition provider seam merge-workflow documentation and test-impact contracts plus targeted TypeScript import closure
  - the exact candidate generated TCB closure lock matches every module blob content digest edge loader dispatcher and closure digest before publication
  - every managed Git hook marks hook execution and dependency bootstrap never recursively installs hooks in that context even when dependencies are first materialized
  - pre-push performs only zero-write imports sealing and zero-write TCB closure checking while explicit tcb closure apply remains the sole lock writer
  - trusted bootstrap converts only complete paired blob and content substitutions plus one closure digest mismatch in old-main into manual-bootstrap-required evidence and rejects every structural or unknown lock failure
tests:
  - tests/unit/issue-disposition-contract.test.ts
  - tests/unit/issue-disposition-github.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/unit/dev-runner-dependency-bootstrap.test.ts
  - tests/unit/install-git-hooks.test.ts
---

# Work Package: Issue Disposition Safety V1

This package removes GitHub prose parsing from SEC completion authority. A
controlled pull request contains only a machine-readable non-effect disposition
plan. Exact merged-main observation produces a progress receipt, not close
authority: the repository has no independent post-main completion-assessment
owner, and GitHub documents no conditional unsafe mutation for Issue PATCH.

GitHub auto-closing remains an untrusted provider side effect. The pre-merge
guard rejects every known trigger. Post-merge reconciliation proves exact
causality from `ClosedEvent`, but returns a typed maintainer action instead of
issuing a racy last-writer-wins reopen. The tracking Issue remains open until a
future trusted assessment and real conditional-write capability cutover exist.

The same successor also repairs the trust transition exposed while publishing
this package. Three already-merged manual transitions changed five causal TCB
modules without regenerating the exact closure lock. Managed hooks now separate
execution from installation, pre-push performs a pure lock check, and the
base-first bootstrap can preserve bounded evidence for substitution-only stale
locks without treating structural drift as recoverable or as PASS.
