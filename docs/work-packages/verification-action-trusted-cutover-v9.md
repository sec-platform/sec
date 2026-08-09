---
schema: codex-development-work-package-v1
id: verification-action-trusted-cutover-v9
tracking: issue-311
base: 33216029c751fd55a1bace1b5ce63d3937a0064c
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: verification-session-effect-boundary
    owner: verification-control-plane-maintainer
    ownedPaths:
      - platform/shared/default-branch-revision-health.ts
      - platform/shared/integration-authorization-contract.ts
      - platform/shared/main-health-contract.ts
      - platform/shared/review-stability-contract.ts
      - platform/shared/scope-authorization-contract.ts
      - platform/shared/verification-action-contract.ts
      - platform/shared/verification-result-contract.ts
      - platform/shared/verification-session-contract.ts
      - scripts/codex/branch-closeout-contract.ts
      - scripts/codex/branch-closeout-receipt.ts
      - scripts/codex/branch-closeout.ts
      - scripts/codex/branch-lifecycle-command.ts
      - scripts/codex/branch-lifecycle-config.ts
      - scripts/codex/branch-lifecycle-inventory.ts
      - scripts/codex/branch-lifecycle.ts
      - scripts/codex/branch-recovery.ts
      - scripts/codex/integration-authorization-publication.ts
      - scripts/codex/sec-merge-bootstrap-contract.ts
      - scripts/codex/sec-merge-bootstrap-runtime.ts
      - scripts/codex/sec-merge-bootstrap.ts
      - scripts/codex/verification-action-contract.ts
      - scripts/codex/verification-action-journal.ts
      - scripts/codex/verification-action-runner.ts
      - scripts/codex/verification-candidate-tree.ts
      - scripts/codex/verification-session-contract.ts
      - scripts/codex/verification-session-github.ts
      - scripts/codex/verification-session-journal.ts
      - scripts/codex/verification-session-runtime.ts
      - scripts/codex/verification-session.ts
      - tests/contract/default-branch-revision-health.test.ts
      - tests/unit/branch-closeout-receipt.test.ts
      - tests/unit/branch-closeout-rest-comments.test.ts
      - tests/unit/branch-lifecycle-temp-repo.test.ts
      - tests/unit/integration-authorization-contract.test.ts
      - tests/unit/integration-authorization-publication.test.ts
      - tests/unit/main-health-contract.test.ts
      - tests/unit/review-stability-contract.test.ts
      - tests/unit/scope-authorization-contract.test.ts
      - tests/unit/sec-merge-bootstrap.test.ts
      - tests/unit/verification-action-contract.test.ts
      - tests/unit/verification-action-journal.test.ts
      - tests/unit/verification-action-runner.test.ts
      - tests/unit/verification-candidate-tree.test.ts
      - tests/unit/verification-freeze-session.test.ts
      - tests/unit/verification-result-core.test.ts
      - tests/unit/verification-session-contract.test.ts
      - tests/unit/verification-session-journal.test.ts
      - tests/unit/verification-session-runtime.test.ts
  - id: hosted-sut-terminal-truth
    owner: ci-verification-maintainer
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - .github/workflows/sec-trusted-bootstrap.yml
      - platform/dev-runner.ts
      - platform/dev-runner/fast-test-policy.ts
      - platform/shared/ci-contract.ts
      - platform/shared/ci-evidence-contract.ts
      - platform/shared/ci-evidence-reuse-contract.ts
      - platform/shared/ci-hosted-sut-observation-contract.ts
      - platform/shared/ci-trust-root-registry.json
      - platform/shared/ci-verification-plan.ts
      - platform/shared/ci-verification-revision.ts
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/tcb-trust-root-contract.ts
      - platform/shared/test-impact-rules/verification.ts
      - platform/shared/verification-action-ci-contract.ts
      - platform/shared/verification-action-provider-contract.ts
      - scripts/ci-verification.ts
      - scripts/codex/merge-gate.ts
      - scripts/codex/verification-action-github-provider.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-evidence-contract-v3.test.ts
      - tests/unit/ci-evidence-contract-v4.test.ts
      - tests/unit/ci-evidence-reuse-contract.test.ts
      - tests/unit/ci-hosted-sut-observation-contract.test.ts
      - tests/unit/ci-verification-composition-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/tcb-trust-root-contract.test.ts
      - tests/unit/test-runner.test.ts
      - tests/unit/verification-action-ci-contract.test.ts
      - tests/unit/verification-action-github-provider.test.ts
      - tests/unit/verification-action-provider-contract.test.ts
  - id: dev-runner-authority-proof-kernel
    owner: ci-verification-maintainer
    ownedPaths:
      - tests/helpers/dev-runner-authority-proof.ts
      - tests/contract/dev-runner-contract.test.ts
      - tests/unit/dev-runner-authority-proof.test.ts
  - id: trusted-cutover-control-plane
    owner: development-governance-maintainer
    ownedPaths:
      - docs/development-governance.md
      - docs/scripts/docs-doctor.ts
      - docs/verification-governance.md
      - docs/work-packages/verification-action-kernel-finalization-v1.md
      - docs/work-packages/verification-action-trusted-cutover-v9.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - scripts/codex/document-control-plane-contract.ts
      - scripts/codex/document-control-plane.ts
      - tests/contract/document-control-plane-lifecycle.test.ts
      - tests/contract/docs-doctor-byte-exact.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/documentation-authority.test.ts
forbiddenPaths:
  - .agents/
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
  - platform/compiler/
  - platform/shared/test-impact-rules/governance.ts
  - platform/shared/test-impact-rules/pipeline.ts
  - platform/shared/test-impact-rules/semantic.ts
  - scripts/ci-pr-risk.ts
acceptance:
  - 'The complete V8 trust-epoch candidate remains one immutable write set based directly on main@33216029; V9 is a proof reset for the final exact-review corrections and the witnessed dev-runner analyzer input-boundary defect, not permission to reopen unrelated product work or restore retired authority.'
  - 'The credential-free hosted SUT facade emits only schema-validated primitive physical observations. Raw transport cannot emit, choose, or carry a Verification Result, cleanup decision, normalized-operation copy, or canonical terminal projection.'
  - 'One shared pure observation contract owns path-independent execution authorization and the sole physical-observation-to-Result/cleanup reducer. It binds ActionKey, exact normalized argv and operation, ticket, candidate/input/archive/dependency/Git closures, hosted environment, sandbox/tool policy, and provider origin.'
  - 'Fresh trusted assembly independently reconstructs the resolution, ticket, execution authorization, command semantics, archive inputs, sandbox settlement, raw artifact identity, and provider provenance before invoking the sole reducer. The durable terminal retains the execution proof and its validator replays that reducer; recomputed caller self-digests cannot make contradictory Result, cleanup, argv, identity, closure, settlement, or provider facts valid.'
  - 'A raw SUT execution cannot assert not-run. Passed, failed, unsupported, and invalidated are derived from physical observation; absence of a legal physical terminal remains a trusted coordinator-owned not-run or blocked fact.'
  - 'ActionKey remains the only result-changing execution identity used by dev-runner, CI Evidence, VerificationSession, and merge-gate. A durable cross-process claim permits at most one physical producer and every ambiguity blocks.'
  - 'BranchLifecycleContext, createBranchLifecycleContext, BranchLifecycleCommandResult, runBranchCommand, requireBranchCommandText, and optionalBranchCommandText are absent from the public and barrel export surfaces and have zero production or test consumers.'
  - 'Branch lifecycle exposes only finite typed inventory, configuration, candidate-tree, preparation, and recovery operations whose inputs cannot express arbitrary Bun, Git, GitHub, merge, comment, push, or ref-deletion commands.'
  - 'VerificationSession is the sole physical merge and branch-closeout owner. Raw merge, comment publication, remote branch deletion, and local branch deletion executors remain private and execute only after exact authorization and provider effect-marker readback; MERGED recovery performs zero second effects.'
  - 'A sole canonical exact-main check that terminates non-success materializes one valid degraded MainHealth ledger with a failure fingerprint, canonical owner, proposal-only repair locator, and repair as its only semantic routing lane. It never fails construction because policy and ledger invariants disagree.'
  - 'MainHealth allowedLanes is a semantic routing restriction, not physical capability or merge authority. While the repair locator is proposal-only or activation is not-frozen, production exposes no repair command, accepts no caller-selected repair lane, creates no repair authorization, and performs zero repair or integration effects; current consumers remain ordinary-only and reject degraded MainHealth.'
  - 'Missing, malformed, incomplete, ambiguous, expired, or repository/branch/main/tree/trust-drifted MainHealth is locked with no lane. V8 does not claim an operational repair lane or self-healing; repair may activate only through a later independently frozen Work Package and contract epoch binding exact repair scope, Session, Evidence, Review, authorization, merge authority, and effect ownership.'
  - 'Review-Stable Barrier is satisfied before expensive hosted verification and reread immediately before authorization. It binds exact head/tree/scope and an independent trusted principal, rejects current REQUEST_CHANGES, unresolved blocking threads, incomplete pagination, head drift, policy drift, and review-only drift.'
  - 'The only physical merge executor consumes a fresh single-use IntegrationAuthorization receipt, rereads live PR/base/head/tree/manifest/scope/review/evidence/MainHealth/trust state, uses match-head squash merge without --admin, never rewrites the candidate, and rejects every raw or unbound merge request.'
  - 'Successful integration proves merged-tree equals the verified candidate tree before idempotent closeout. Legacy sec-merge-bootstrap mutation authority, repeated dispatch or PR-body refresh, branch-lifecycle finalize, public receipt publishers/finalizers, and every ordinary --admin merge path remain retired.'
  - 'All public GitHub transports expose typed observe/ensure transactions only; raw merge, issue-comment, review-request, dispatch, environment, and runner mutation ports remain module-private.'
  - 'The six proven fast-test process hazards remain registered exactly once as independent fresh Bun processes without --concurrent, and the AST contract rejects unregistered process-global environment mutation or module mocks.'
  - 'tests/helpers/dev-runner-authority-proof.ts remains the sole analyzer-kernel owner. Its live physical inventory is derived from the exact live scenario authority-owner fields and their tracked, identity-bound transitive runtime resource closure; the historical platform/scripts prefix census is retired and no filename, directory, module, JSON, or scenario allowlist replaces it.'
  - 'Every selected executable, declaration, package-surface, and internal runtime data resource is canonical, repository-contained, tracked where required, regular and non-symlink, allocation-bounded, identity/size/EOF read back, and deterministically ordered. Valid tracked JSON reached by the authority closure is bounded input; missing, escaping, untracked, ambiguous, malformed, oversized, symlinked, or drifted resources remain fail closed.'
  - 'The complete live authority closure and all 41 adversarial scenarios still use one inventory read, one immutable TypeScript Program, one TypeChecker, one NodeNext resolution cache, one ProgramSymbolIndex, one frozen typed topology, and one graph solve. Phase counters prove exact-once keyed work, no post-solve mutation, input-derived work bounds, canonical parity, cross-scenario isolation, and unrelated-module non-amplification under the existing 180-second fast-test policy without scenario removal, timeout growth, a second analyzer, cached PASS, or verification weakening.'
  - 'Integration authorization independently revalidates the original initiating actor and the current triggering actor on every run attempt before any integration effect. Missing, drifted, or unauthorized current triggering identity blocks, while durable provenance continues to bind the original initiating actor.'
  - 'Merged recovery preserves the exact provider run and publication attempt encoded by the durable recovery artifact that crossed the first-effect boundary. A later recovery host or workflow rerun proves its own current identity but cannot restamp or rewrite the original artifact attempt.'
  - 'The hosted SUT job timeout strictly exceeds the 3,600-second sandbox maximum by a separately bounded terminalization reserve for reap, reduction, settlement, and artifact publication; an equal or shorter outer timeout is rejected by the workflow contract.'
  - 'The post-merge MainHealth join budget is at least the canonical producer timeout plus one complete polling interval, and the workflow contract couples the producer timeout, join deadline, and actual polling interval.'
  - 'The Document Control Plane alone validates and activates this manifest, derives its digest and pointer, promotes one reviewed rolling-plan candidate, and publishes one CAS-bound index tree plus exact worktree projections under the workspace write lease.'
  - 'Any V9 manifest, write-set, Action, terminal-proof, Session, MainHealth, analyzer proof, Review, Evidence, or TCB change invalidates all V8 exact-head proof. Only the final one-parent V9 candidate may obtain independent exact-head Review and old-main trusted bootstrap.'
  - 'After merge, the new trust revision is reloaded, all old receipts are stale, one ordinary-candidate canary proves the new path, and TASK_RESTART_REQUIRED is reported before further trust-epoch work.'
tests:
  - tests/unit/ci-hosted-sut-observation-contract.test.ts
  - tests/unit/ci-verification-execution.test.ts
  - tests/unit/ci-evidence-contract-v4.test.ts
  - tests/unit/verification-action-github-provider.test.ts
  - tests/unit/verification-action-ci-contract.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/unit/branch-lifecycle-temp-repo.test.ts
  - tests/unit/branch-closeout-receipt.test.ts
  - tests/unit/branch-closeout-rest-comments.test.ts
  - tests/unit/verification-candidate-tree.test.ts
  - tests/unit/main-health-contract.test.ts
  - tests/contract/default-branch-revision-health.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/ci-lanes.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/docs-doctor-byte-exact.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/unit/dev-runner-authority-proof.test.ts
  - tests/contract/dev-runner-contract.test.ts
---

# verification-action-trusted-cutover-v9

V9 从 V8 候选 `5732830d3431746506147bec10fac19096f16b33` 的独立 exact-head
Review 与 trusted-bootstrap failure 重新冻结。V8 已关闭的产品修复继续作为同一单父候选的
实现输入，但没有任何旧 Review、Evidence、Session、bootstrap 或 merge authorization 可用于 V9。

V9 只新增两个已经有 exact witness 的闭环：完成最新 Review 对 workflow timeout、MainHealth join、
rerun principal 与 recovery artifact attempt 的绑定；把 dev-runner authority proof 从全仓
`platform/scripts` census 收敛为 catalog-owned authority roots 的 tracked、identity-bound transitive
resource closure，使 JSON/data resource 有唯一 bounded owner，并让原有 41-scenario 单 Program proof
在既有 180 秒策略内完成。它不靠隔离、加 timeout、删 scenario 或 path whitelist 获得绿色结果。

V9 不建立新的 repair 系统，不扩展产品 Compiler，不恢复 legacy bootstrap，也不改变 ActionKey、
Review、IntegrationAuthorization 或 closeout 的既有唯一 owner。两个实现纵切片停止写入后，TCB、
test-impact、控制面和候选树只做一次最终 reconciliation；最终候选仍须是
`main@33216029c751fd55a1bace1b5ce63d3937a0064c` 的唯一直接子提交。
