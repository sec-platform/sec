---
schema: codex-development-work-package-v1
id: main-health-repair-shared-dependency-authority-v1
tracking: issue-221
base: 63760884c5529b7b7194008a2589ab256d8f7320
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: shared-dependency-authority-materialization
    owner: runtime-dependency-materializer-owner
    ownedPaths:
      - docs/runtime-and-distribution.md
      - platform/shared/project-runtime.ts
      - platform/shared/runtime-dependency-spec.ts
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/test-impact-rules/semantic.ts
      - tests/contract/project-runtime-contract.test.ts
      - tests/contract/sandbox-architecture-contract.test.ts
      - tests/contract/test-impact.test.ts
      - tests/integration/compiler-dependency-installation.test.ts
      - tests/integration/project-dependency-runtime.test.ts
      - tests/integration/project-runtime-fixtures.ts
      - tests/unit/project-runtime-stamp.test.ts
      - tests/unit/runtime-dependency-spec.test.ts
      - tests/unit/test-impact-cache.test.ts
  - id: repository-audit-mechanism-reconciliation
    owner: repository-audit-owner
    ownedPaths:
      - scripts/codex/repository-audit.ts
  - id: current-control-projection-reconciliation
    owner: development-document-control-owner
    ownedPaths:
      - docs/work-packages/main-health-repair-fast-contracts-v1.md
      - docs/work-packages/main-health-repair-shared-dependency-authority-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .agents/
  - .codex/
  - .github/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/development-governance.md
  - docs/evidence/
  - docs/roadmap.md
  - docs/verification-governance.md
  - package.json
  - source/
acceptance:
  - the repair is bound to exact main 63760884c5529b7b7194008a2589ab256d8f7320 and canonical MainHealth job 93945212264 where imports typecheck docs authority and every other fast test passed while sandbox architecture failed at the first Bun text lock observation after the earlier dependency warmup in the same shard
  - the root cause is removed by eliminating the second shared and project package-manager resolution effect rather than selecting another fragile no-lock flag; root package json plus canonical Bun lock and compiler generation remain the only resolution authority
  - runtime dependency spec owns one strict whole-object materialization binding across exact physical Bun executable and digest canonical declared and actual version raw lock root-manifest and install-config digests platform architecture and every direct and transitive package manifest and dependency edge
  - compiler generation binding advances atomically to v3 and directly binds exact package lock Bun executable bytes and the complete runtime materialization; the redundant mutable compiler stamp and caller-supplied runtime identity are retired
  - the read-only shared fast path requires exact generated manifest bytes strict v2 stamp current root and toolchain parity full target materialization binding exact package-layout closure and zero competing authority residue; a valid hit does not redundantly rescan the compiler source generation
  - shared and project materialization only copy the bounded closure from the canonical compiler generation or create an exact readback bridge; ordinary paths never spawn a second Bun install and never publish a derived lock or package-manager configuration
  - every shared projection mutation occurs under the existing install lock and physical-root fence; any historical or unknown competing authority entry including file directory symlink junction or reparse residue is preserved and typed-blocked because only an explicit generation-retirement transaction may delete it
  - allowed generated manifest and readiness control files are read and written through retained physical file identity; a child alias or observation-to-open name replacement blocks before bytes can be written through the replacement
  - staged projection and the final published readiness readback use the same full binding; missing or version-drifted transitives extra package roots malformed or extra stamp fields and Bun executable/version drift cannot reuse readiness, while an atomic validated projection avoids a duplicate pre-stamp target scan
  - the global-state sandbox architecture test file is deleted because its manifest and path assertions duplicate owner tests and its mutable repository cache assertion depends on shard order; causal projection residue provider and closure cases live in the existing owner tests without adding another test process
  - the now consumer-zero synthetic direct-only project runtime fixture is deleted because it encoded the invalid competing definition that direct manifests constitute a complete closure
  - the now consumer-zero compiler stamp unit file is deleted because the stamp duplicated generation identity and could not independently authenticate its cached facts; exact lock drift remains owned by compiler generation integration behavior
  - runtime and distribution authority records the derived-cache boundary and repository audit points to production materialization plus focused integration behavior instead of the retired test path
  - the published predecessor manifest is deleted and exactly one new selected frozen manifest remains with pointer raw digest binding and no tombstone alias archive tracked Evidence or second registry
  - the canonical TCB generator updates only identities causally changed by this vertical slice without module edge loader dispatcher or registry expansion
  - one logical run uses exactly one mutable worktree branch and candidate ref with no v2 v3 successor or parallel writer
  - no local code test typecheck affected full docs doctor or hosted Gate is run and independent exact head static Review plus exact post merge SEC MainHealth are the only new assurance steps
tests:
  - tests/e2e/runtime-host.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/project-runtime-contract.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/test-impact.test.ts
  - tests/integration/compiler-dependency-installation.test.ts
  - tests/integration/project-base.test.ts
  - tests/integration/project-dependency-runtime.test.ts
  - tests/unit/dependency-environment.test.ts
  - tests/unit/playwright-browser-cache.test.ts
  - tests/unit/runtime-dependency-spec.test.ts
  - tests/unit/test-impact-cache.test.ts
  - tests/unit/runtime-verification.test.ts
  - tests/unit/semantic-mutation-isolated-child-fence.test.ts
---

# Work Package: MainHealth Shared Dependency Authority Repair V1

Canonical MainHealth job `93945212264` is the reusable failure observation. The
job proved imports, TypeScript, documentation authority and all other fast
contracts, then exposed one deterministic same-shard sequence: dependency
warmup invoked the generated shared-root installer before the sandbox contract,
and Bun 1.3.14 persisted `.shared-deps/bun.lock` because the historical
`--no-lockfile` spelling is not part of its current install interface.

The shared dependency root is a rebuildable projection, not a package or
resolution authority. This package removes its package-manager invocation:
canonical Bun and the root lock produce one compiler generation, then a strict
materialization binding selects and copies the complete bounded package graph.
Known or unknown competing control residue is preserved and blocks readiness;
cleanup authority is not inferred from cache ownership. It also retires the
global-cache test and the direct-only synthetic fixture, consolidating causal
behavior into existing owner surfaces while reducing false coupling.

The transaction replaces the published predecessor manifest, preserves the
validated R14 candidate topology, and creates no new coordinator, compatibility
alias, evidence archive, workflow or package authority.
