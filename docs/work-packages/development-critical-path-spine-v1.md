---
schema: codex-development-work-package-v1
id: development-critical-path-spine-v1
tracking: issue-398
base: 36b174ebc783bb2b2e0c079d58fb825f0966b60b
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - external-provider
  - runtime-distribution
  - system-architecture
  - verification-governance
tasks:
  - id: critical-path-pure-composition
    owner: development-critical-path-owner
    ownedPaths:
      - platform/shared/development-critical-path-contract.ts
      - tooling/sec-dev/development-critical-path.ts
      - tests/unit/development-critical-path-contract.test.ts
      - tests/unit/development-critical-path.test.ts
  - id: semantic-assurance-and-owner-federation
    owner: development-critical-path-owner
    ownedPaths:
      - platform/shared/documentation-authority-contract.ts
      - scripts/codex/repository-audit.ts
      - docs/scripts/docs-doctor.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/repository-audit.test.ts
      - tests/integration/repository-audit-canary.test.ts
      - tests/unit/control-cli-projection.test.ts
  - id: exact-effect-capability-closure
    owner: verification-effect-capability-owner
    ownedPaths:
      - platform/shared/git-observer.ts
      - platform/shared/git-read-environment.ts
      - platform/git/transport.ts
      - platform/git/objects.ts
      - platform/git/attributes.ts
      - platform/git/repository.ts
      - platform/git/authoring.ts
      - platform/git/read-environment.ts
      - platform/shared/ci-trust-root-registry.json
      - platform/shared/observed-process.ts
      - platform/shared/process.ts
      - platform/shared/shared-boundary-contract.ts
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/ci-verification-revision.ts
      - platform/shared/project-tracked-files.ts
      - platform/shared/reference-drift-scan.ts
      - scripts/codex/exact-git-blob.ts
      - scripts/codex/ci-orchestration-core.ts
      - scripts/codex/branch-lifecycle-command.ts
      - scripts/codex/document-control-plane.ts
      - scripts/codex/skill-applicability.ts
      - scripts/ci-pr-risk.ts
      - platform/dev-runner/repository-mutation-fence.ts
      - platform/release/release-git-tree-source.ts
      - tooling/sec-dev/git/git-read.ts
      - tooling/sec-dev/branch-lifecycle-command.ts
      - tooling/sec-dev/text/text-byte-census.ts
      - tooling/sec-dev/workspace/worktree-settlement.ts
      - docs/scripts/docs-doctor-ledgers.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/docs-doctor-ledgers.test.ts
      - tests/contract/test-architecture.test.ts
      - tests/helpers/retained-git-write-tree-probe.ts
      - tests/integration/sec-dev-git-observation.test.ts
      - tests/unit/exact-git-blob.test.ts
      - tests/unit/git-read-environment.test.ts
      - tests/unit/observed-process-lifecycle.test.ts
      - tests/unit/process-output.test.ts
      - tests/unit/sec-dev-git-read-batching.test.ts
  - id: external-cache-and-provider-receipt
    owner: runtime-environment-owner
    ownedPaths:
      - platform/shared/environment-materialization-contract.ts
      - tooling/sec-dev/environment-cache-lifecycle.ts
      - platform/shared/project-runtime.ts
      - platform/shared/sec-runtime-state-contract.ts
      - platform/shared/sec-linux-verification-environment.ts
      - platform/shared/environment-specs/sec-linux-verification-v1.json
      - platform/runtime/environments/sec-linux-verification-v1/authority.ts
      - platform/runtime/environments/sec-linux-verification-v1/spec.json
      - platform/shared/runtime-dependency-spec.ts
      - platform/shared/dependency-environment.ts
      - platform/dev-runner/dependency-bootstrap.ts
      - platform/dev-runner/test-runner.ts
      - platform/dev-runner/typecheck-runner.ts
      - scripts/codex/local-github-actions-runner.ts
      - scripts/codex/trusted-runtime-container.ts
      - tests/unit/environment-materialization-contract.test.ts
      - tests/unit/environment-cache-lifecycle.test.ts
      - tests/unit/sec-runtime-state-contract.test.ts
      - tests/unit/sec-linux-verification-environment.test.ts
      - tests/unit/runtime-dependency-spec.test.ts
      - tests/unit/dependency-environment.test.ts
      - tests/unit/dev-runner-dependency-bootstrap.test.ts
      - tests/unit/test-runner.test.ts
      - tests/unit/local-github-actions-runner.test.ts
      - tests/unit/trusted-runtime-container.test.ts
      - tests/integration/project-dependency-runtime.test.ts
      - tests/integration/compiler-dependency-installation.test.ts
  - id: retained-inventory-deletion
    owner: physical-no-follow-owner
    ownedPaths:
      - platform/shared/physical-no-follow.ts
      - platform/dev-runner/env-manager.ts
      - platform/dev-runner/test-process-temp.ts
      - scripts/codex/worktree-physical-closeout.ts
      - tests/unit/physical-no-follow.test.ts
      - tests/unit/env-manager.test.ts
      - tests/unit/test-process-temp.test.ts
  - id: generated-state-terminal-gc
    owner: generated-state-lifecycle-owner
    ownedPaths:
      - platform/shared/generated-state-contract.ts
      - platform/shared/generated-state-registry.json
      - tooling/sec-dev/generated-state-lifecycle.ts
      - tooling/sec-dev/generated-state-operations.ts
      - tests/unit/generated-state-contract.test.ts
      - tests/unit/generated-state-lifecycle.test.ts
      - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
  - id: verification-and-closeout-consumer
    owner: verification-consumer-owner
    ownedPaths:
      - platform/shared/test-impact-contract.ts
      - platform/shared/test-budget-contract.ts
      - platform/shared/verification-action-ci-contract.ts
      - platform/shared/verification-action-contract.ts
      - platform/shared/verification-action-provider-contract.ts
      - platform/shared/verification-provider-capability-contract.ts
      - platform/shared/ci-evidence-contract.ts
      - platform/shared/ci-hosted-sut-observation-contract.ts
      - platform/dev-runner/verification-action-executor.ts
      - platform/dev-runner/fast-test-policy.ts
      - platform/shared/test-impact-rules/verification.ts
      - scripts/ci-verification.ts
      - scripts/codex/trusted-runtime-closeout.ts
      - scripts/codex/verification-action-github-provider.ts
      - scripts/codex/verification-session.ts
      - scripts/codex/verification-session-runtime.ts
      - .github/workflows/compiler-pr-validation.yml
      - tooling/sec-dev/runtime-state-authority.ts
      - tooling/sec-dev/runtime-state-journal-filesystem.ts
      - tooling/sec-dev/runtime-state-paths.ts
      - tooling/sec-dev/verification-action-runner.ts
      - tooling/sec-dev/verification-action-journal.ts
      - tests/contract/verification-action-tooling-boundary.test.ts
      - tests/unit/ci-verification-composition-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/test-impact-cache.test.ts
      - tests/unit/verification-action-ci-contract.test.ts
      - tests/unit/verification-action-contract.test.ts
      - tests/unit/verification-action-github-provider.test.ts
      - tests/unit/ci-hosted-sut-observation-contract.test.ts
      - tests/unit/verification-action-runner.test.ts
      - tests/unit/verification-action-journal.test.ts
      - tests/unit/trusted-runtime-merge-gate-adapter.test.ts
      - tests/integration/development-critical-path-exact-tree.canary.test.ts
  - id: performance-and-canonical-docs
    owner: development-performance-owner
    ownedPaths:
      - platform/shared/benchmark-contract.ts
      - tests/contract/benchmark-budget.test.ts
      - docs/development-governance.md
      - docs/external-provider-policy.md
      - docs/runtime-and-distribution.md
      - docs/system-architecture.md
      - docs/verification-governance.md
  - id: import-authoring-freeze
    owner: import-authoring-owner
    ownedPaths:
      - platform/dev-runner.ts
      - platform/dev-runner/import-organizer.ts
      - platform/dev-runner/import-transform-transaction.ts
      - .githooks/pre-commit
      - .githooks/pre-push
      - .githooks/post-checkout
      - .githooks/post-merge
      - .githooks/post-rewrite
      - scripts/install-git-hooks.ts
      - tests/contract/dev-runner-contract.test.ts
      - tests/unit/import-transform-transaction.test.ts
      - tests/unit/import-organizer-staged.test.ts
      - tests/unit/install-git-hooks.test.ts
      - tests/e2e/import-organizer-staged.test.ts
      - tests/e2e/import-organizer-worktree-isolation.test.ts
      - tests/e2e/install-git-hooks.test.ts
  - id: work-package-control
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/default-branch-health-repair-4291ea94f26858c6570144f6632100a568832039-9606c61e638edb6562dd98421c5442fd28aca119c1fd8a9f472d74c1f606c010.md
      - docs/work-packages/development-critical-path-spine-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/unit/codex-work-package-contract.test.ts
      - tests/contract/document-control-plane-lifecycle.test.ts
forbiddenPaths:
  - .agents/
  - AGENTS.md
  - bun.lock
  - bunfig.toml
  - docs/authority.json
  - docs/product.md
  - docs/roadmap.md
  - docs/work/current-state.yaml
  - package.json
  - platform/orchestrator/
  - platform/shared/review-stability-contract.ts
  - platform/toolchain/typecheck-provider.ts
  - public-docs/
  - source/
acceptance:
  - CACHE-ROOT-001 repository State and Cache roots are physically disjoint and every supported rebuildable large object uses one centralized versioned cache layout without becoming authority
  - CACHE-REUSE-002 exact local generation is reused first then exact offline artifact closure then only missing remote acquisition; disabled-network fixtures prove no unnecessary download or rebuild
  - RESOURCE-BIRTH-003 every supported generated cache or provider resource has durable owner identity lease retention and terminal obligation before its first externally visible Effect
  - DELETE-FAST-004 one retained no-follow batch primitive opens the root once each directory once and ancestors zero times while rejecting reparse symlink identity drift foreign siblings and replaced leaves
  - RECEIPT-SETTLE-005 provider ensure publishes one current exact desired generation endpoint and state-bound canonical receipt; observers fail closed and consumer-zero retirement prevents unbounded history
  - BUILDKIT-BOUNDARY-006 one exact SEC docker-container Buildx builder identity and provider-native cache interface are explicit; no global Docker prune wildcard or foreign builder mutation exists
  - TERMINAL-GC-007 operational terminal and physical clean are separate; exact eligible residue may recover as GC pending while unknown foreign active or unauthorized residue remains blocked
  - LEASE-DEATH-008 materializer and consumer timeout only admit a host boot PID and process-start identity death observation; time alone never steals a live remote or liveness-unknown owner
  - CLOSEOUT-009 focused and property tests typecheck real provider cache deletion and crash-resume canaries independent exact-head Review merge new-main readback and exact task artifact cleanup complete
  - WORK-PACKAGE-TRANSITION-010 successor freeze owns every new control target and retired pointer-bound manifest source endpoint and trusted-base admission rejects an omitted endpoint before expensive Verification
  - DIRTY-SEPARATION-011 mutable tracked index and untracked authoring bytes are content-addressed with effectAuthority none; unrelated dirty cannot block immutable object analysis while producer-closure drift and non-exact physical execution fail closed at their own boundaries
  - ROOT-ROLE-SEPARATION-012 Verification Action execution requires three explicit non-interchangeable roots namely durable Runtime State authority exact Git static authority and physical process cwd; a temporary journal directory can never be interpreted as a Git repository or execution workspace
  - SANDBOX-STRUCTURE-013 hosted sandbox isolation is a typed phase-owned operation graph whose command argv is only a bound transport projection; ordinary execution binds exactly the candidate retained descriptor while bootstrap execution additionally binds exactly one dependency descriptor, and validators/tests do not infer authority from shell substrings
  - CONTROL-FREEZE-014 one authoring generation is based directly on live default and the canonical freeze transaction publishes manifest active pointer and rolling projection together before the generation is committed; a stale or independently staged projection is rejected rather than repaired after a second commit
  - AUDIT-ASSURANCE-015 inventory coverage and semantic assurance remain independent fail-closed axes; a control-plane binding failure can explain a semantic finding but cannot suppress reclassify or zero it, and only a successful exact frozen readback closes that finding
  - IMPORT-AUTHORING-016 normal import freeze automatically canonicalizes working-tree and staged-index snapshots as separate recoverable transactions, publishes an exact HEAD/index/provider receipt, preserves partial staging, and leaves one zero-write pre-commit sentinel while push checkout merge and rewrite perform zero eager import or dependency work
  - DOCUMENTATION-CLOSURE-017 every resolved problem updates its canonical invariant causal rationale state and resource diagrams failure recovery verification boundary and truthful implementation stage before any agent worker Review or closeout may project resolved implemented or complete; missing closure is typed documentation-closure-missing
  - the pure critical-path contract consumes existing ActionKey journal MainHealth provider generated-state worktree and ref facts without creating a second truth or Effect owner
  - fresh PASS fresh failure authenticated in-flight missing stale and unknown observations partition deterministically into reuse pass reuse failure join execute and blocked with at most one physical start per ActionKey
  - tree-equivalent candidate to main reuse is proposed only when policy tool provider environment and required closure revisions are all exactly equivalent; otherwise full MainHealth remains required
  - parser envelope admission and current-owner semantic validation remain distinct typed phases and tampered binding digest or semantic binding fails before Effect
  - startup and warm observation cost is bounded by current owner closure and missing or stale actions rather than repository PR run or receipt history
  - the canonical architecture and state diagrams bind every node and edge to one owner authority Effect principal receipt recovery and retirement path with zero competing document graph
  - static dimension claims resolve to canonical documentation authority records and producer revisions; path regexes are candidate hints only and missing producer consumer recovery or retirement edges become typed blocking Unknowns
  - repository audit reports inventory coverage and semantic assurance separately; required analyzer failure or not-run state projects failed or incomplete and can never be represented as zero-finding healthy
  - Verification Action boundaries are compiled from the canonical runner resolved dependency closure; blanket directory bans and unresolved candidate targets cannot create false authority violations
  - every production Verification Action Effect consumes one reviewed process or provider capability acquires the provider consumer lease before start releases it only after durable terminal publication and exposes independently readable Evidence for execute reuse join and failure
  - one platform-owned Git observer constructs closed semantic operations over one bounded process transport and one isolated Git environment; the retired scripts and tooling observers generic argv surface and duplicate dispatcher are absent
  - semantic tests pure state-machine tests filesystem canaries Git canaries and provider process canaries are separate ActionKey closures; each real Effect setup runs at most once per exact environment generation
tests:
  - tests/unit/development-critical-path-contract.test.ts
  - tests/unit/development-critical-path.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/integration/repository-audit-canary.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/unit/control-cli-projection.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/test-architecture.test.ts
  - tests/integration/sec-dev-git-observation.test.ts
  - tests/unit/exact-git-blob.test.ts
  - tests/unit/observed-process-lifecycle.test.ts
  - tests/unit/process-output.test.ts
  - tests/unit/sec-dev-git-read-batching.test.ts
  - tests/unit/environment-materialization-contract.test.ts
  - tests/unit/environment-cache-lifecycle.test.ts
  - tests/unit/sec-runtime-state-contract.test.ts
  - tests/unit/sec-linux-verification-environment.test.ts
  - tests/unit/runtime-dependency-spec.test.ts
  - tests/unit/dependency-environment.test.ts
  - tests/unit/dev-runner-dependency-bootstrap.test.ts
  - tests/unit/test-runner.test.ts
  - tests/unit/local-github-actions-runner.test.ts
  - tests/unit/trusted-runtime-container.test.ts
  - tests/integration/project-dependency-runtime.test.ts
  - tests/integration/compiler-dependency-installation.test.ts
  - tests/unit/physical-no-follow.test.ts
  - tests/unit/env-manager.test.ts
  - tests/unit/test-process-temp.test.ts
  - tests/unit/generated-state-contract.test.ts
  - tests/unit/generated-state-lifecycle.test.ts
  - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
  - tests/unit/test-impact-cache.test.ts
  - tests/contract/verification-action-tooling-boundary.test.ts
  - tests/unit/ci-verification-composition-execution.test.ts
  - tests/unit/ci-verification-execution.test.ts
  - tests/unit/verification-action-ci-contract.test.ts
  - tests/unit/verification-action-contract.test.ts
  - tests/unit/verification-action-github-provider.test.ts
  - tests/unit/ci-hosted-sut-observation-contract.test.ts
  - tests/unit/verification-action-runner.test.ts
  - tests/unit/verification-action-journal.test.ts
  - tests/unit/trusted-runtime-merge-gate-adapter.test.ts
  - tests/unit/codex-work-package-contract.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/benchmark-budget.test.ts
---

# Development Critical Path Spine V1

This package is the single #398 composition responsibility selected by WorkDecision receipt
`sha256:7ff3651781ee355b0540717e9f6b010cb1a186ee62fbd5fa963f16a325bf191e` against exact
`main@36b174ebc783bb2b2e0c079d58fb825f0966b60b` and tree
`f7dd21a385a00589ecf04a41e98fe9d9e4fb43d6`. It does not batch Issue 312, 316, 346,
or any other unselected work. Those owners contribute existing facts or consume this spine; their product authority
does not move here.

The target is one observable critical path, not one universal writable manager. The only cross-domain
state graph is `docs/system-architecture.md#development-critical-path-spine-的唯一跨领域图`; this Work
Package does not own or duplicate that graph. Its local execution order is the projection
`admission -> materialization -> Action observation -> receipt consumption -> settlement`, and every
node, transition, recovery edge and terminal meaning remains owned by the canonical graph and the
bounded domain named there. This projection retires with the Work Package.

The current V3 exact-tree analyzer is a bounded Action-admission producer: it proves exact immutable
HEAD/tree, tracked inventory and input bytes, an executing producer closure with no relevant authoring drift,
manifest/authority document closure, the supported
TypeScript module-graph boundary, Action plan identity and dependency terminals. Its machine field
names are intentionally `bounded-census-complete`, `bounded-verified-complete` and
`status=bounded-closed`: they mean only that this bounded
producer exhausted its declared inputs and found no defect that it implements; they do not prove that
all repository-wide defect classes, owner/writer conflicts, workflow/config consumers, receipt
consumers or retirement edges were enumerated. V3 now makes the exact manifest-base to head
add/change/delete/rename/copy subject mandatory, derives the owner/producer/consumer graph and SCC/fixed-point
digest, publishes structured Unknowns, and compiles `NonMisleadingProjection` from typed stage receipts.
These mechanisms do not invent missing domain facts: authenticated owner-issued domain projections,
workflow/config/provider consumers, duplicate-writer/receipt/GC census and the unified presentation adapter
remain typed gaps. Required producer-bound scope therefore blocks when any such edge is absent; no caller may
present bounded closure or a syntactically closed graph as a whole-system static proof.
The receipt and parser bind this limitation as `proofScope=bounded-action-admission`; changing or
omitting that field invalidates the content-addressed readback instead of relying on prose discipline.

Semantic ownership stays distributed: EnvironmentSpec owns desired dependency identity; each provider owns its
Effect and receipt; Verification Action owns ActionKey and execution reuse; generated state, worktree and ref owners
own their retirement; MainHealth owns its final projection. The spine only composes their immutable observations into
`execute | reuse | join | block | main-delta | operational-terminal | gc-pending`.

The implementation order is dependency-driven: pure contracts and adversarial tests first; retained inventory and
resource birth/receipt primitives second; real consumers and provider effects third; performance/canary evidence and
canonical diagrams last. `fast/slow` remains only a scheduler projection. No global prune, history scan, command-string
cache, wall-clock semantic identity, Kubernetes, or duplicate Dagger orchestration is introduced.
