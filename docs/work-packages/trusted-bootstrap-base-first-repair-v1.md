---
schema: codex-development-work-package-v1
id: trusted-bootstrap-base-first-repair-v1
tracking: issue-311
base: 33216029c751fd55a1bace1b5ce63d3937a0064c
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: base-first-bootstrap-kernel
    owner: ci-verification-maintainer
    ownedPaths:
      - .github/workflows/sec-trusted-bootstrap.yml
      - platform/shared/tcb-closure-lock.ts
      - scripts/ci-verification.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/unit/ci-verification-execution.test.ts
  - id: bootstrap-repair-control-plane
    owner: development-governance-maintainer
    ownedPaths:
      - docs/work-packages/trusted-bootstrap-base-first-repair-v1.md
      - docs/work-packages/verification-action-kernel-finalization-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/documentation-authority.test.ts
forbiddenPaths:
  - .agents/
  - .github/workflows/compiler-pr-validation.yml
  - .github/workflows/compiler-release-validation.yml
  - .github/workflows/sec-merge-gate.yml
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/archive/
  - docs/authority.json
  - docs/evidence/
  - docs/roadmap.md
  - docs/system-architecture.md
  - docs/development-governance.md
  - docs/verification-governance.md
  - docs/work/current-state.yaml
  - docs/work-packages/verification-action-trusted-cutover-v9.md
  - platform/compiler/
  - platform/dev-runner/
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-evidence-reuse-contract.ts
  - platform/shared/ci-trust-root-registry.json
  - platform/shared/ci-verification-plan.ts
  - platform/shared/tcb-trust-root-contract.ts
  - platform/shared/test-impact-rules/
  - scripts/ci-pr-risk.ts
  - scripts/codex/branch-closeout.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/sec-merge-bootstrap.ts
  - scripts/codex/verification-action-github-provider.ts
  - scripts/codex/verification-session.ts
  - tests/unit/verification-action-github-provider.test.ts
  - tests/unit/verification-session-runtime.test.ts
acceptance:
  - 'The bridge is one direct child of main@33216029c751fd55a1bace1b5ce63d3937a0064c and contains only the explicit candidate-root checker, its steady-state trusted-bootstrap workflow/contracts, and this control-plane takeover. It absorbs no VerificationSession, hosted provider, MainHealth, merge, branch, Compiler, or V9 product delta.'
  - 'Trusted bootstrap materializes disjoint exact trusted-base and candidate worktrees, proves both commit/tree identities and clean physical non-symlink roots, and obtains checker executable code, parser, policy, toolchain, dependencies, and final verdict only from the trusted-base worktree.'
  - 'The candidate is data before the trusted verdict. No trusted checker phase imports or executes the candidate closure owner, generator, CI verifier, package script, dependency tree, bunfig preload, or tests.'
  - 'One canonical TCB closure implementation accepts a validated explicit candidate root through source read, import resolution, traversal, and module digest computation. There is no candidate-specific second algorithm and no ambient cwd, environment, or hidden compilerRoot fallback after the root is selected.'
  - 'Candidate roots and consumed modules are absolute, canonical, repository-contained, ordinary physical directories/files, non-symlink and realpath-identical. Traversal, aliases, reparse points, nonregular nodes, missing imports, tree drift, or checker/candidate root overlap fail closed before bytes can authorize a result.'
  - 'The trusted-base checker produces PRE and POST receipts binding base SHA/tree, candidate SHA/tree, checker source/tool identity, candidate source inventory and closure digest. Candidate regression runs only as credential-free SUT work between them; immutable fields and candidate closure must be byte-identical before and after.'
  - 'A candidate policy/schema/entrypoint/edge expansion that the trusted base cannot interpret is manual-bootstrap-required, never passed and never delegated to the candidate checker.'
  - 'This bridge changes the checker itself and therefore cannot authorize its own merge. Its candidate tests are corroborative only; integration requires frozen old-base transition evidence, an independent exact-head Review with no P0-P2, an expected-head manual squash merge, and exact new-main tree/readback.'
  - 'After the bridge reaches main, every old Review, Gate, Evidence, Session, bootstrap receipt, and merge authorization is stale. TASK_RESTART_REQUIRED is emitted before the verification-action candidate is rebuilt as V10 from the new trust root.'
  - 'The active pointer digest is derived from the staged manifest Git blob, the rolling plan selects only this repair, and docs/work/current-state.yaml remains unchanged.'
tests:
  - tests/contract/ci-contract.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/unit/ci-verification-execution.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/test-impact.test.ts
---

# trusted-bootstrap-base-first-repair-v1

Review `3745507962` proved that the bootstrap workflow at
`main@33216029c751fd55a1bace1b5ce63d3937a0064c` checks out the candidate and then
executes the candidate's own closure owner and CI verifier. Choosing another working directory does
not repair that authority inversion because the trusted-base closure reader is bound to its own
module-level `compilerRoot` and has no explicit candidate-data root.

This package is the smallest base-first trust-epoch bridge. It keeps one closure/parser/digest
algorithm, adds one validated explicit candidate root, and makes the default-branch workflow execute
the trusted-base script and dependencies against candidate Git/file data. Candidate regression is a
separate SUT observation between trusted PRE and POST receipts; it cannot mint the checker verdict.

The bridge itself is integrated only through a frozen one-time old-base transition harness and an
independent exact-head Review. A successful merge establishes a new trust revision, invalidates all
proof bound to the prior main, and ends the epoch with `TASK_RESTART_REQUIRED`. The preserved V9
implementation is then reconstructed as `verification-action-trusted-cutover-v10` on that new main;
it is deliberately outside this bridge's write set.
