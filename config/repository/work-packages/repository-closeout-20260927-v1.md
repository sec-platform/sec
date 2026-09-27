---
schema: codex-development-work-package-v1
id: repository-closeout-20260927-v1
tracking: none
base: 263878d40ee4b92485ee07d14185fe6f606aee8d
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: close-repository-maintenance-and-local-ref-effects
    owner: repository-closeout-owner
    ownedPaths:
      - .documentation/
      - .github/workflows/repository-maintenance.yml
      - catalog/registry/official/ticket.basic/files/src/installed/ticket/ticket-service.ts
      - config/repository/
      - docs/开发/AI协作/规则装载与任务恢复.md
      - docs/运行/发布运行与资源生命周期.md
      - src/adapters/release/
      - src/adapters/filesystem/write-lease.ts
      - src/adapters/providers/git/
      - src/adapters/providers/git-read/runtime/session.ts
      - src/adapters/providers/git-read/runtime/scratch-index-generation.ts
      - src/adapters/runtime-state/generated-state/
      - src/adapters/runtime-state/physical/runtime/physical-no-follow.ts
      - src/adapters/runtime-state/physical/runtime/observed-process.ts
      - src/adapters/runtime-state/physical/runtime/process.ts
      - src/adapters/runtime-state/physical/runtime/process-resource-session.ts
      - src/adapters/runtime-state/physical/runtime/process-resource-session.test.ts
      - src/adapters/runtime-state/physical/runtime/windows-host-filesystem-authority.ts
      - src/adapters/self-hosting/control/branch-lifecycle/
      - src/adapters/self-hosting/control/documentation/document-control-plane.ts
      - src/adapters/self-hosting/control/main-health/
      - src/adapters/self-hosting/control/repository-maintenance/
      - src/adapters/self-hosting/development/commit-admission/
      - src/adapters/self-hosting/development/commit/
      - src/adapters/self-hosting/development/hooks/
      - src/adapters/self-hosting/development/runner/fast-test-policy.ts
      - src/adapters/self-hosting/development/runner/cli.ts
      - src/adapters/self-hosting/development/runner/env-manager.ts
      - src/adapters/self-hosting/development/runner/test-process-temp.ts
      - src/adapters/toolchain/dependencies/
      - src/adapters/toolchain/runtime/bun-version.ts
      - src/adapters/toolchain/runtime/layout.ts
      - src/adapters/verification/run-semantic-mutation-isolated-child.ts
      - src/adapters/verification/run-runtime-verification.ts
      - src/adapters/verification/semantic-mutation-isolated-runtime-plan.ts
      - src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts
      - src/adapters/verification/platform/trust/contract/ci-trust-root-registry.json
      - src/adapters/verification/platform/ci/runtime/verification-session.ts
      - src/adapters/verification/platform/test-impact/contract/budget.ts
      - src/adapters/mutation/staging-workspace.ts
      - src/bootstrap/engineering/verify-orchestrator.ts
      - src/entry/cli/dependency-environment.ts
      - src/assurance/policies/gate.ts
      - tests/
forbiddenPaths:
  - AGENTS.md
  - LICENSE
  - LICENSES/
  - README.md
  - bun.lock
  - package.json
acceptance:
  - the candidate is based on the exact current main and contains only paths owned by this package
  - Git scratch index writes retain an immutable generation identity through publish, settlement, and recovery
  - document-control status keeps both immutable index-tree observations and final ref fences in one bounded Git-read session sized for the provider's process and Windows stdin-worker cost
  - hosted repository maintenance persists recoverable intent before remote ref effects and settles it from exact provider readback
  - historical completed Work Package transports retire only after their live obligations and consumers are proven closed, preserving this active package and independent work
  - the registered sec/main-health check is identified by its own workflow and app provenance
  - hook installation admits an available generation after planning and preserves owned generation evidence
  - every SEC local branch ref deletion consumes one Git physical owner with exact old-OID CAS, common-dir coordination, worktree occupancy checks, readback, and durable recovery
  - consumers derive physical Git resource budgets from the provider and acquire common-dir before repository-root when both leases are needed
  - closed-unmerged and retained local branch closeout require exact content or authenticated review evidence and protect divergent or worktree-bound refs
  - merged and retained local ref deletion first settles every matching development commit journal under the same ordered leases, including absent-ref recovery
  - the local branch residue suite budget includes its real expanded recovery and concurrency cases plus the retained 30-second settlement margin, so the full suite terminates with a test result instead of an unreported child deadline
  - the worktree physical closeout suite budget covers its measured 29 real Git and Windows filesystem cases while retaining the 30-second process settlement margin
  - the full semantic mutation transaction runs under the canonical slow suite budget and runtime-heavy isolation so all five real cases can finish with a terminal result and retained process settlement
  - superseded applied local commit attempts retire through the commit journal owner only after exact object and reflog transition proof, so a bounded journal family cannot permanently block a new candidate
  - development commit, hosted closeout, and managed worktree registry writers participate in the same common-dir coordination domain
  - compiler dependency stage intents retire only after dependency owner proves terminal state, exact bytes and physical identity, with durable recovery across partial deletion, before generated-state relocates their bound paths
  - exports used only within their owner files do not expand the public module surface or block the required unused-code gate
  - a published document freeze accepts Git index metadata refresh only after the candidate tree, lock absence, journal, and recovery artifacts are independently checked
  - runtime layout rejects a nearest valid package manifest that does not own the requested entrypoint without climbing into an ambient parent package
  - compiler dependency bridge binds consumer package identity separately from its authenticated physical source owner, including junction-backed worktrees
  - project default bridges and isolated copies consume the authenticated compiler runtime materialization and source generation directly; normal execution no longer creates or prefers a second shared dependency projection
  - registered legacy .shared-deps roots retire through their generated-state and physical lifecycle owner after exact identity, inventory and terminal readback; the two known unregistered .bun-cache-only roots receive a one-time exact physical census, deletion and readback after their producer is removed, while any unknown root remains protected
  - dependency diagnostics, warmup, semantic mutation isolation, runtime verification and trusted container cache wiring no longer require or create .shared-deps
  - dependency clean --bun-cache and --all reject before any deletion until the shared Runtime Cache owner coordinates cache clearance with installs and proves physical terminal readback; --shared still uses registered legacy lifecycle retirement
  - replacement tests prove exact source identity, offline copy, no second package-manager install and no new .shared-deps with independent physical observations
  - compiler materialization identity uses effective install configuration; linked locator recovery binds the recorded source owner and finishes owner-issued lifecycle registration after a publish interruption
  - a dangling linked-worktree compiler locator is retired by its physical lifecycle owner before rebinding to the current source generation; shared consumer records do not grant cross-root generation collection
  - install-lock release accepts the retained native deletion receipt before a waiting actor can reacquire the same name; a failed physical deletion still preserves an unknown replacement
  - compiler install-lock publication retries only an exact exclusive-name collision whose competing file disappeared before retained census, while durability, parent and foreign identity failures stay blocked
  - repeated compiler readiness reads an exact existing coordination locator without publishing a transient candidate in the repository; mismatched locator bytes stay blocked and Windows native observation proves zero writes in its namespace
  - the ticket query source keeps tenant authority at its query sink so the official policy's static source-to-sink proof remains executable
  - policy gate compares source definitions against the canonical Engineering IR order by policy identity, independent of scope insertion order
  - compiler dependency Effect cases retain their assertions in separately bounded process shards under the existing test supervisor budget
  - live Git fixture cloning owns its objects and leaves the shared common-dir pack bytes and metadata unchanged
  - write-capable Git scratch provider tests use an independent temporary repository and cannot freshen the monitored candidate object store
  - workspace writer lease heartbeat failures retain bounded native phase and system code so a failed full Gate identifies its physical owner
  - Windows heartbeat replacement tolerates only short-lived EPERM/EACCES sharing denial within the existing lease freshness window, revalidating the same owner before each retry and failing closed when denial persists
  - concurrent test invocation startup tolerates a lease entry disappearing during recovery discovery while retaining no-follow authority and exact lease recovery
  - a retained child process startup failure preserves bounded owner-issued phase and native error code through the Git read transport, without weakening no-child settlement or trusting a raw exception message
  - GitRead budget and concurrent phase tests consume the resource settlement contract, preserving both terminal provider failure labels and independent outer/phase failures
  - Git scratch preflight charges both root Git commands and Windows stdin workers against the live native resource ledger before any object or index write
  - Windows ACL authority reads the effective thread token SID through the native token owner, preserving impersonation without domain name lookup or a widened admission deadline
  - action runner regression fixtures use valid admission plans, isolate distinct cancellation ActionKeys, and reserve output bytes so process-budget assertions observe the intended owner limit
  - Windows test workspaces use the stable repository-keyed cache root rather than nesting beneath per-invocation SEC_CACHE_HOME, while bounded physical directory labels preserve full identity digests in their authority records; generic file-only fixtures retain their own valid longer paths
  - semantic mutation fixtures use the canonical model and workspace artifact paths; production planning preserves a typed no-publish block when the host cannot prove process-wide isolation
  - release-set and standalone bundle entries each bind the Bun marker to their own delivery root, without borrowing a parent checkout marker
  - installed Windows CLI profile drift remains a typed capability failure while profile-matched adoption and closure rules retain their own evidence
  - independent review and required verification bind the frozen candidate head and tree before integration
  - remote merge, primary-main synchronization, and branch or worktree retirement are reported only after exact settlement and readback
tests:
  - src/adapters/providers/git/ref-effect.test.ts
  - src/adapters/runtime-state/generated-state/lifecycle.test.ts
  - src/adapters/runtime-state/physical/runtime/process-resource-session.test.ts
  - tests/unit/windows-host-filesystem-authority.test.ts
  - tests/unit/git-scratch-budget-native.test.ts
  - tests/contract/repository-maintenance-workflow.test.ts
  - tests/unit/repository-maintenance.test.ts
  - tests/unit/branch-lifecycle-temp-repo.test.ts
  - tests/unit/branch-closed-unmerged-closeout.test.ts
  - tests/unit/branch-local-residue-closeout.test.ts
  - tests/unit/branch-supersession-review.test.ts
  - tests/unit/closed-unmerged-closeout-production.test.ts
  - tests/unit/closed-unmerged-recovery-retirement.test.ts
  - tests/unit/development-commit.test.ts
  - tests/unit/install-git-hooks.test.ts
  - tests/unit/local-main-closeout.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/unit/verification-session-hosted-local-ref.test.ts
  - tests/unit/work-selection-main-health.test.ts
  - tests/unit/work-selection-live.test.ts
  - tests/unit/git-read-environment.test.ts
  - tests/unit/workspace-write-lease.test.ts
  - tests/unit/observed-spawn-failure.test.ts
  - tests/unit/ci-orchestration-git-isolation.test.ts
  - tests/unit/verification-action-runner.test.ts
  - tests/unit/test-process-temp.test.ts
  - tests/unit/env-manager.test.ts
  - tests/unit/test-runner.test.ts
  - tests/unit/test-planning-path-identity.test.ts
  - tests/unit/workspace-fixture-input.test.ts
  - tests/unit/worktree-physical-closeout-temp-repo.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/e2e/install-git-hooks.test.ts
  - tests/unit/release-artifact.test.ts
  - tests/integration/release-set-portable.test.ts
  - tests/unit/runtime-layout.test.ts
  - tests/unit/runtime-verification.test.ts
  - tests/integration/compiler-dependency-generation.test.ts
  - tests/integration/compiler-dependency-external.test.ts
  - tests/integration/compiler-dependency-recovery.test.ts
  - tests/integration/compiler-dependency-locks.test.ts
  - tests/integration/project-dependency-runtime.test.ts
  - tests/unit/dependency-environment.test.ts
  - tests/unit/trusted-runtime-container.test.ts
  - tests/integration/semantic-mutation-apply.test.ts
  - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
  - tests/integration/workspace-engineering-ir.test.ts
  - tests/integration/semantic-projection-consumers.test.ts
  - tests/unit/windows-control-cli-installed-adoption.test.ts
---

# Repository closeout and coordinated local ref effects

This package binds one maintenance candidate to the current default branch. It
integrates independently useful closeout work and keeps unresolved branch or
worktree content protected until the canonical owner proves its disposition.
The proposal-only publication of this package carries no activation, health,
Gate, review, or integration authority.
