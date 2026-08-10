---
schema: codex-development-work-package-v1
id: verification-action-trusted-cutover-v10
tracking: issue-311
base: caa4a5a6000c02f47011b3bd192e529b85bb78c3
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
      - docs/work-packages/trusted-bootstrap-base-first-repair-v1.md
      - docs/work-packages/verification-action-trusted-cutover-v10.md
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
  - docs/work/current-state.yaml
  - docs/work-packages/verification-action-kernel-finalization-v1.md
  - docs/work-packages/verification-action-trusted-cutover-v9.md
  - platform/compiler/
  - platform/shared/test-impact-rules/governance.ts
  - platform/shared/test-impact-rules/pipeline.ts
  - platform/shared/test-impact-rules/semantic.ts
  - scripts/ci-pr-risk.ts
acceptance:
  - 'V10 is reconstructed directly on trusted M1 main@caa4a5a6000c02f47011b3bd192e529b85bb78c3 from the preserved H340 candidate commit 702abeca7110b03451cef195a4e17efd3461e536 and tree 73c16e6f3047e568862abe8c0a4c2d18e9e39612; preservation does not revive any authority, Review, Evidence, Session, receipt, authorization, or completion claim from the old trust epoch.'
  - 'The final M1-to-V10 write set has exactly 100 unique paths: 86 exact mechanical non-overlap records bound by the 19,449-byte sec-v10-preservation-plan-v1 digest sha256:8f9eac1d3412523b3494ecc0a225ef105550be127132a59bb5d7a38baaddebd4, twelve bridge-overlap semantic replays, this V10 manifest addition, and deletion of docs/work-packages/trusted-bootstrap-base-first-repair-v1.md. The predecessor 90-record digest sha256:abe25c409edacb06537ef4526e39ff7699ecac53fa5d121617d630edc8c50d47 remains reproducible as the prior explicit plan, but is superseded by the four Review repairs now classified as semantic overlaps.'
  - 'sec-v10-preservation-plan-v1 has canonical top-level fields {baseCommit,baseTree,records,schema,sourceBaseCommit,sourceCommit,sourceTree}: baseCommit caa4a5a6000c02f47011b3bd192e529b85bb78c3, baseTree 78e7a9eb678d8ac78ec4586f7fe5da8c7ff4d652, sourceBaseCommit 33216029c751fd55a1bace1b5ce63d3937a0064c, sourceCommit 702abeca7110b03451cef195a4e17efd3461e536, and sourceTree 73c16e6f3047e568862abe8c0a4c2d18e9e39612. Each record has exactly {afterBlob,afterMode,beforeBlob,beforeMode,change,path} from git diff --no-renames --no-abbrev --raw sourceBaseCommit to sourceCommit.'
  - 'The plan is independently recomputable: records are unique and path-sorted and exclude the twelve semantic overlaps named below plus docs/work-packages/verification-action-trusted-cutover-v9.md and docs/work-packages/verification-action-kernel-finalization-v1.md; recursive object keys use JS UTF-16 code-unit lexical order; arrays preserve order; UTF-8 compact JSON.stringify has no final newline; and A/D records preserve Git raw zero identities. Its LF path list with trailing LF is 3,802 bytes with digest sha256:532d9bebf20e539a956540c07123def5b4950e30b3d1de2a4318f0a54bc865a7. The old opaque sha256:31a4a5f8c6746616ee1b92910afe70f8146f60eec5c50155674b22fe8afbe422 serialization is unreproducible and retired, not reusable Evidence.'
  - 'Each of the 86 mechanical records preserves the H340 source blob identity and mode exactly, including the distinct scripts/codex/verification-action-contract.ts deletion and platform/shared/verification-action-contract.ts addition. Any missing, extra, renamed, mode-drifted, or byte-drifted mechanical record blocks the candidate.'
  - 'The twelve semantic overlaps are .github/workflows/sec-trusted-bootstrap.yml, docs/verification-governance.md, docs/work/active-work-package.md, docs/work/rolling-plan.md, platform/shared/tcb-closure-lock.ts, scripts/codex/verification-action-github-provider.ts, scripts/codex/verification-session.ts, tests/contract/ci-contract.test.ts, tests/contract/documentation-authority.test.ts, tests/contract/tcb-closure-lock.test.ts, tests/unit/verification-action-github-provider.test.ts, and tests/unit/verification-session-runtime.test.ts. Each starts from M1 bridge truth and replays only the preserved V9 intent compatible with the explicit candidate-root checker; whole-file ours/theirs replacement is forbidden.'
  - 'docs/work-packages/verification-action-trusted-cutover-v9.md and docs/work-packages/verification-action-kernel-finalization-v1.md remain absent. Their absence is an acceptance condition, not a changed owned path, compatibility stub, archive promotion, or permission to reconstruct retired authority.'
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
  - 'Missing, malformed, incomplete, ambiguous, expired, or repository/branch/main/tree/trust-drifted MainHealth is locked with no lane. V10 does not claim an operational repair lane or self-healing; repair may activate only through a later independently frozen Work Package and contract epoch binding exact repair scope, Session, Evidence, Review, authorization, merge authority, and effect ownership.'
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
  - 'The Document Control Plane alone validates and activates this manifest, derives its raw final manifest-byte digest and pointer, promotes one reviewed rolling-plan candidate, and publishes one CAS-bound index tree plus exact worktree projections under the workspace write lease.'
  - 'Every Review, Gate, Evidence, Session, Action terminal, MainHealth ledger, analyzer proof, bootstrap receipt, merge authorization, and TCB claim bound to H340, its predecessors, the bridge candidate, or pre-M1 main is stale. Only the final one-parent V10 candidate on M1 may obtain new exact-head proof.'
  - 'M1 trusted-base bootstrap is expected to preserve the candidate-as-data boundary and may terminate manual-bootstrap-required when the V10 trust-root delta exceeds the M1 checker contract. That result is not passed; integration then requires frozen M1-rooted transition evidence, independent exact-head Review with no P0-P2, and one expected-head manual squash merge.'
  - 'After merge, exact new-main commit/tree and the 100-path result are read back under the new trust revision, all M1-bound receipts remain stale, one ordinary-candidate canary proves the new path, and TASK_RESTART_REQUIRED is reported before further trust-epoch work.'
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

# verification-action-trusted-cutover-v10

V10 以 bridge 后受信根 `main@caa4a5a6000c02f47011b3bd192e529b85bb78c3` 为唯一
base，并只把 H340 `702abeca7110b03451cef195a4e17efd3461e536` / tree
`73c16e6f3047e568862abe8c0a4c2d18e9e39612` 当作不可变 preservation input。86 个
非重叠记录保持 source blob/mode 完全相等；12 个 bridge overlap 从 M1 语义重放，不能用整文件
ours/theirs 覆盖 bridge 的 explicit candidate-root trust boundary。

最终 write set 恰为 100 个路径：86 mechanical、12 个 semantic overlap、本 manifest 新增与
bridge manifest 删除。V9 manifest 和 kernel-finalization manifest 均保持不存在。旧 epoch 的
Review、Gate、Evidence、Session、receipt 与 authorization 全部 stale，不能从保存的 tree 推导完成。

V10 仍不建立新的 repair 系统，不扩展产品 Compiler，不恢复 legacy bootstrap，也不改变
ActionKey、Review、IntegrationAuthorization 或 closeout 的唯一 owner。若 M1 trusted checker 对
V10 trust-root delta 给出 `manual-bootstrap-required`，该结果只触发冻结的 M1 transition，绝不提升为
PASS。只有 independent exact-head Review、expected-head manual merge、exact new-main tree/readback
和 `TASK_RESTART_REQUIRED` 才能关闭这次 trust epoch。
