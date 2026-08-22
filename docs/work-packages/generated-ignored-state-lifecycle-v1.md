---
schema: codex-development-work-package-v1
id: generated-ignored-state-lifecycle-v1
tracking: issue-271
base: cf59ef7b1e166fa184592ab870fa5788466e2df9
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - architecture
  - development-governance
  - verification-governance
tasks:
  - id: generated-state-semantic-owner
    owner: generated-state-contract-owner
    ownedPaths:
      - platform/shared/generated-state-contract.ts
      - platform/shared/generated-state-registry.json
      - tests/unit/generated-state-contract.test.ts
  - id: generated-state-physical-transaction
    owner: generated-state-lifecycle-owner
    ownedPaths:
      - tooling/sec-dev/generated-state-lifecycle.ts
      - tooling/sec-dev/generated-state-operations.ts
      - scripts/codex/generated-state.ts
      - scripts/codex/environment-settlement.ts
      - tests/unit/generated-state-lifecycle.test.ts
  - id: producer-birth-and-settlement
    owner: generated-state-integration-owner
    ownedPaths:
      - platform/dev-runner.ts
      - .githooks/pre-commit
      - platform/dev-runner/dependency-bootstrap.ts
      - platform/dev-runner/import-organizer.ts
      - platform/dev-runner/typecheck-runner.ts
      - platform/cli/register-commands.ts
      - platform/shared/dependency-environment.ts
      - platform/shared/project-runtime.ts
      - tests/integration/compiler-dependency-installation.test.ts
      - tests/unit/dependency-environment.test.ts
      - tests/unit/import-organizer-staged.test.ts
      - tests/e2e/install-git-hooks.test.ts
  - id: generated-state-verification-and-control-projection
    owner: generated-state-control-owner
    ownedPaths:
      - docs/development-governance.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/generated-ignored-state-lifecycle-v1.md
      - docs/work-packages/sec-static-convergence-v1.md
      - tsconfig.json
      - platform/shared/ci-contract.ts
      - platform/toolchain/typecheck-provider.ts
      - tests/contract/typecheck-provider-boundary.test.ts
      - package.json
      - .githooks/pre-push
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/tcb-trust-root-contract.ts
      - platform/shared/ci-trust-root-registry.json
      - platform/shared/test-impact-contract.ts
      - platform/shared/test-impact-rules/verification.ts
      - platform/shared/test-ownership-contract.ts
      - tests/contract/dev-runner-contract.test.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-trust-closure-contract.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/install-git-hooks.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/tcb-trust-root-contract.test.ts
      - tests/unit/test-impact-cache.test.ts
      - scripts/ci-verification.ts
      - scripts/install-git-hooks.ts
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-trusted-bootstrap.yml
  - id: trusted-candidate-impact-bootstrap
    owner: trusted-test-impact-provider-owner
    ownedPaths:
      - docs/verification-governance.md
      - platform/shared/ci-pr-risk-selection.ts
      - platform/shared/test-impact-rules/governance.ts
      - scripts/codex/ci-orchestration-core.ts
      - scripts/codex/exact-git-blob.ts
      - scripts/codex/trusted-runtime-closeout.ts
      - scripts/codex/verification-session-runtime.ts
      - scripts/codex/verification-session.ts
      - tests/unit/ci-orchestration-git-isolation.test.ts
      - tests/unit/ci-pr-risk-selection.test.ts
      - tests/unit/exact-git-blob.test.ts
      - tests/unit/verification-session-runtime.test.ts
  - id: bounded-control-cli-projection
    owner: development-governance-owner
    ownedPaths:
      - scripts/codex/document-control-plane.ts
      - scripts/codex/repository-audit.ts
      - scripts/codex/work-selection.ts
      - tests/unit/control-cli-projection.test.ts
  - id: dev-runner-authority-impact-boundary-repair
    owner: dev-runner-authority-proof-owner
    ownedPaths:
      - platform/dev-runner/fast-test-policy.ts
      - platform/dev-runner/test-runner.ts
      - platform/shared/test-budget-contract.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/dev-runner-authority-program.test.ts
      - tests/contract/dev-runner-live-authority.test.ts
      - tests/helpers/dev-runner-authority-proof.ts
      - tests/unit/test-runner.test.ts
forbiddenPaths:
  - .agents/
  - AGENTS.md
  - bun.lock
  - bunfig.toml
  - docs/authority.json
  - docs/product.md
  - docs/roadmap.md
  - docs/system-architecture.md
  - platform/compiler/
  - platform/orchestrator/
  - platform/registry/
  - public-docs/
  - source/
acceptance:
  - the final architecture is one content-addressed derivation graph where Demand and Impact derive a DerivationKey, observation selects terminal reuse, in-flight join, one execution or typed block, execution publishes a typed identity, Evidence, materialization or effect receipt, and only result-owner reachability authorizes retirement and physical readback; RequiredClosure intersect MissingOrStale is the demand projection rather than a second mechanism
  - this Work Package implements only the physical derived-result slice of the repository-wide Engineering Semantic Graph; it does not promote generated-state fields into a universal schema or duplicate the system architecture owner, domain semantic extensions, application and adapter boundaries, or effect transition authority
  - one versioned generated-state semantic owner records stable producer roots and policies rather than every ephemeral file; path name, ignored status, age, size, branch name and arbitrary count thresholds never manufacture deletion authority
  - the first production migration closes the complete registry-required-at-birth family comprising compiler staging, physical compiler node_modules, shared dependency cache and import candidate snapshots, which bind repository, physical workspace/root identity, owner operation and lifecycle phase before producer content is written or at first verified reuse
  - already registered unchanged generations use exact readback with zero writes; producer terminal cleanup targets only its registered root and never scans unrelated tmp siblings, while explicit inspect remains the separate reconciliation and unknown-detection surface
  - inventory is deterministic and no-follow; unregistered, replaced, active, malformed, reparse or unknown objects remain protected, and active state may be healthy without becoming cleanup eligible
  - cleanup executes exact inventory, retired-owner authorization, identity revalidation, same-filesystem quarantine, bounded no-follow deletion and physical readback; completed, partial-residue and no-op are distinct receipts
  - automatic, safe and all-rebuildable profiles select only already classified retired objects; identity-bound control state, recovery authority, active owners and unknown objects are never selected
  - branch/ref recovery, registered worktree mutation, test resource cleanup and provider cache semantics remain owned by issues 313, 186, 190 and 193; this slice does not scan or reinterpret those owners
  - one tooling owner exposes inspect, plan, cleanup and environment-settlement operations through the dev-runner projection; obsolete scripts/codex wrappers are deleted, inspect is zero-write, timestamps and receipt identities are owner-generated, and callers cannot hand-fill them
  - focused tests cover ignored unknown, active versus retired generation, reparse root, changed-after-inventory replacement, foreign sibling preservation, bounded physical cleanup and dependency producer birth/disposal; no browser or unrelated business tests are required
  - sufficient exploration is derived from authority, dependency, causal, consumer and Impact closure; explicit reconciliation census is not equivalent to reading every object body
  - dev-runner route behavior, exact live-host authority closure and the finite adversarial proof catalog are separate evidence units; route edits remain millisecond-fast, affected host-closure edits run only the live proof, and proof implementation changes run the full finite Program
  - bounded-owner process census is module-scoped, so one owner cannot alias or expose its process capability while independent transitive modules remain free to consume the canonical shared process owner under their own contracts
  - a frozen Work Package manifest exists only for the selected work or one byte-proven delayed predecessor; future roadmap identity remains in the roadmap and is refrozen from its actual exact main when selected rather than retaining a stale execution manifest
  - generated-state machine data uses explicit owner-only Impact evidence instead of generic reverse-import fanout; executable sources retain module-graph propagation and ownerless machine data remains unresolved
  - trusted main computes TestImpact from the exact candidate Git tree as immutable data, with one bounded tree inventory and one strict lazy cat-file batch; candidate declarations never self-authorize a smaller closure
  - selector and documentation control edits no longer mechanically select unrelated business baselines, while unknown input remains conservative
  - stale CI-lane assertions no longer preserve the retired broad baseline; documentation, package, shared-fixture and module-graph inputs each assert their actual owner-derived obligation
  - managed-hook fast reuse verifies the fixed installed file set, executable mode and deployed-byte digest; marker plus directory existence cannot self-certify a mutated generation
  - control-plane CLI stdout is a digest-bound bounded decision projection by default; full internal results require explicit full or output intent
  - successful unchanged Git-hook operations are silent while failures and explicitly invoked maintainer commands retain actionable output
  - TCB policy and exact Git tree are the only sources of truth; trusted-main code derives closure identity from immutable candidate bytes, while tracked generated locks, generatedAt, archive/CAS writers and merge-driver/Hook mutation are retired
  - TCB computation is selected only by actual Impact and reused by exact-tree ActionKey; unrelated deltas do zero TCB work and Hook bypass cannot bypass the effect consumer
  - concurrent import candidate snapshots are independently birth-registered and disposed as operation children; the shared parent is not a cleanup identity, while the mutable TestImpact cache is protected by its domain owner and logical canonical path without turning atomic refresh into a new birth
  - generated-state retirement has no public caller-supplied digest surface; one producer session must birth/adopt the exact registration before owner-generated retirement, and dependency clean routes registered roots through that lifecycle without nested duplicate deletion
  - import snapshot Git writes retain a no-follow physical directory capability through the child Effect and reject ancestor substitution without writing candidate bytes into the replacement
  - trusted bootstrap and release workflows consume exact-tree-derived TCB identity without generated-region/CLI compatibility paths; VerificationSession proves clean exact main from Git identity, candidate TCB compilation occurs only in an Impact-selected Action bound to the exact tree and its trusted-base Action dependency, and POST reuses the authenticated PRE terminal instead of starting either unchanged ActionKey again
  - stale registry rules with no live producer are deleted; canonical repository roots cannot replace the lifecycle owner with caller test hooks, and the existing product-to-control-plane dependency boundary rejects a second CLI business owner
tests:
  - tests/unit/generated-state-contract.test.ts
  - tests/unit/generated-state-lifecycle.test.ts
  - tests/contract/dev-runner-contract.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/ci-trust-closure-contract.test.ts
  - tests/contract/typecheck-provider-boundary.test.ts
  - tests/contract/dev-runner-live-authority.test.ts
  - tests/contract/dev-runner-authority-program.test.ts
  - tests/contract/ci-lanes.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/unit/test-runner.test.ts
  - tests/unit/import-organizer-staged.test.ts
  - tests/unit/dependency-environment.test.ts
  - tests/unit/test-impact-cache.test.ts
  - tests/unit/ci-orchestration-git-isolation.test.ts
  - tests/unit/ci-pr-risk-selection.test.ts
  - tests/unit/exact-git-blob.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/unit/control-cli-projection.test.ts
  - tests/unit/install-git-hooks.test.ts
  - tests/unit/tcb-trust-root-contract.test.ts
---

# Generated / Ignored State Lifecycle V1

本包实现 Issue #271/#430 当前规范的第一个完整纵切片。最终设计不是四个迁移面，也不是“对象生命周期 + 执行复用”两套机制，而是一张内容寻址派生图：`Demand/Impact -> DerivationKey -> observe -> reuse/join/execute/block -> typed result -> reachability/retirement/readback`。`RequiredClosure ∩ MissingOrStale`只是需求投影，ActionKey只是可复用derivation的key。TCB identity、TypeCheck cache、dependency generation、import snapshot与测试Evidence只是不同result kind；Workflow、CLI、Hook、文档和测试只是consumer或proof。它们不得再拥有平行生命周期、缓存命中或重跑语义。

这只是总体 Engineering Semantic Graph 在开发控制面中的物理derived-result纵切片，不是以generated-state字段重建第二总架构。全局最小semantic kernel、domain extension/interface、application/port/adapter分层及effect transition仍由各自canonical owner定义，并通过stable typed identity/revision在同一图中组合；本包只让physical result的materialization与retirement不再形成平行语义。

本轮迁移 registry 中全部 `required-at-birth` producer family，而不是把所有 cache 和临时目录误归给一个通用删除器。它不把 `.gitignore`、`.tmp`、目录年龄或数量当删除权限，而是从 producer birth registration 派生 owner、物理身份、生命周期与可执行 settlement。

```text
Demand / Impact
  -> DerivationKey
  -> observe absent | in-flight | terminal
  -> reuse | join | execute once | typed block
  -> identity-only | Evidence | materialization | effect receipt
  -> result-owner reachability and retirement
  -> identity revalidation, bounded effect and physical readback
```

本包只拥有 repository/workspace-local generated state 的分类、通用安全事务与 settlement projection。正常 producer 只观察自己的 exact registered root；全量 unknown census 仅由显式 reconciliation 调用。Git branch/ref recovery、registered worktree effect、Test Action resource 和 Provider cache semantics继续由各自 owner 授权；它们只能向本 owner登记稳定 root或消费其 receipt，不能靠路径命名反向取得删除权限。

## 本轮真实校准证据

- `git worktree remove` 已注销 candidate registry，但因 ignored/control state 返回 `Directory not empty` 并留下完整物理目录；registry absence 不是物理 completion。
- orphan 中 `.tmp/codex/tcb-closure-lock-v2` 曾被正确阻断为unknown recovery state；tracked TCB lock及全部consumer退役后，核实其唯一内容为六个旧operation/source记录，再把整个exact目录移出workspace到named retired state并读回workspace absent，未触碰其他`.tmp` owner。
- local annotated recovery tags被 `fetch --prune --prune-tags`作为远端镜像残留删除，证明 recovery identity不能放进 provider拥有 prune语义的 branch/tag namespace。
- superseded closed-unmerged PR remote ref 与 unmerged local source缺少 provider-neutral closeout terminal，证明 #271 receipt、#186 physical closeout和#313 ref closeout必须有清晰接缝而不能互相冒充。

这些事实用于验证通用不变量，不把具体路径、SHA或本次临时目录硬编码进长期算法。
