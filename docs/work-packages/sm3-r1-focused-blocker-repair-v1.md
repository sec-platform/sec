---
schema: codex-development-work-package-v1
id: sm3-r1-focused-blocker-repair-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: sm3-r1-terminal-store
    owner: a0
    ownedPaths:
      - platform/compiler/semantic-mutation/mutation-terminal-record.ts
      - platform/compiler/semantic-mutation/mutation-recovery-record.ts
      - tests/unit/semantic-mutation-apply.test.ts
  - id: sm3-r1-workspace-creator-lease
    owner: a0
    ownedPaths:
      - platform/orchestrator/workspace-orchestrator.ts
      - platform/shared/workspace-write-lease.ts
      - tests/integration/pipeline-workspace-write-lease.test.ts
      - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
      - tests/unit/workspace-write-lease.test.ts
  - id: sm3-r1-isolated-runtime
    owner: a0
    ownedPaths:
      - platform/compiler/compose/template-engine.ts
      - platform/compiler/emit/write-local-views.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - tests/integration/semantic-mutation-apply.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
  - id: sm3-r1-appcontainer
    owner: a0
    ownedPaths:
      - platform/shared/windows-appcontainer-executor.ts
      - platform/shared/windows-appcontainer-native-helper.ts
      - tests/contract/semantic-mutation-apply-contract.test.ts
      - tests/unit/windows-appcontainer-executor.test.ts
  - id: sm3-r1-evidence
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-r1-focused-blocker-repair-v1.md
      - docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json
      - docs/evidence/v0-4-semantic-mutation-apply-repair-risk-batch.json
forbiddenPaths:
  - .agents/skills/sec-architecture-change/SKILL.md
  - .agents/skills/sec-ci-triage/SKILL.md
  - .agents/skills/sec-pr-closeout/SKILL.md
  - .agents/skills/sec-repo-audit/SKILL.md
  - .agents/skills/sec-verification-evidence/SKILL.md
  - .agents/skills/sec-work-package-plan/SKILL.md
  - .gitignore
  - AGENTS.md
  - PLANS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/scripts/docs-doctor.ts
  - docs/work-packages/_template.md
  - package.json
  - platform/cli/
  - platform/compiler/ir/
  - platform/compiler/projection/
  - platform/compiler/semantic-impact/
  - platform/compiler/workbench/
  - platform/orchestrator/pipeline-orchestrator.ts
  - platform/orchestrator/semantic-mutation-orchestrator.ts
  - platform/policies/
  - platform/registry/
  - platform/shared/engineering-ir/
  - platform/shared/semantic-impact-types.ts
  - platform/shared/semantic-mutation-transaction-types.ts
  - platform/shared/semantic-mutation-types.ts
  - source/
  - tsconfig.json
acceptance:
  - "The original 39-file Semantic Mutation owner batch passes with zero failures without increasing any timeout or deleting or weakening a test."
  - "Dry-run and apply happy paths produce a ready plan from the production host-path-free isolated runner bundle; runtime unavailability no longer cascades into SEMANTIC-MUTATION-010."
  - "Compose and emit resource roots resolve from compilerRoot plus canonical repository-relative paths; the isolated runtime materializes compose templates at the matching compiler/compose destination and never embeds the checkout path."
  - "initWorkspace creates only its requested workspace root before acquiring the generic writer lease; generic lease acquisition against a missing root remains fail closed with WORKSPACE-WRITE-LEASE-004 and path-free structured details."
  - "Terminal receipt exact lookup is O(1), allocator steady-state is O(1), legacy bootstrap performs at most one full audit, and pruning remains transaction-record authoritative with O(NG + N log N) work."
  - "Each terminal receipt is durably published without replacement before the internal sequence head advances; restart catches up any interrupted receipt, never reuses its sequence, and preserves immutable receipt cross-binding and malformed-evidence fail-closed behavior."
  - "Retention remains exactly the latest 256 rejected, verified, or rolled-back terminals; active and recovery-required records and recovery-required backups are never automatically removed."
  - "Windows AppContainer public capability remains exactly status-only; internal failure evidence is path-free and preserves stage, invariant, native phase/code, and primary-versus-cleanup failure without SID, path, environment, stdout, stderr, or raw Error leakage."
  - "The AppContainer sentinel reads the real outer canary, cannot wedge permanently on owned-canary cleanup, publishes durable recovery authority before helper-side effects, atomically publishes owner records, retries a transient native-helper bundle build, and preserves primary plus cleanup failure evidence."
  - "AppContainer ACL, no-network, no-outside-read/write, Job fence, process cleanup, lease-loss recovery, profile cleanup, and fail-closed isolation requirements are unchanged."
  - "No Pipeline stage order, canonical IR, Fact Delta, Impact, public Semantic Mutation type, Verification requirement union, Registry contract, product adapter, dependency, CI contract, or PR #108 context asset changes."
  - "If the single combined batch still exposes an AppContainer failure, the run stops with a new exact-head stop record containing only typed stage/invariant/native-code, cleanup state, and residue evidence; no single-test rerun follows."
tests:
  - "bun test tests/unit/semantic-mutation.test.ts tests/unit/semantic-mutation-source-adapter.test.ts tests/unit/semantic-mutation-apply.test.ts tests/unit/semantic-mutation-verification-adapter.test.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/unit/windows-appcontainer-executor.test.ts tests/unit/workspace-write-lease.test.ts tests/contract/semantic-mutation-contract.test.ts tests/contract/semantic-mutation-source-adapter-contract.test.ts tests/contract/semantic-mutation-apply-contract.test.ts tests/integration/semantic-mutation-apply.test.ts tests/integration/semantic-mutation-recovery-lifecycle.test.ts tests/integration/semantic-mutation-windows-rollback.test.ts tests/integration/pipeline-workspace-write-lease.test.ts tests/integration/project-runtime.test.ts tests/unit/runtime-verification.test.ts tests/integration/workspace-engineering-ir.test.ts tests/integration/semantic-core-vertical.test.ts tests/integration/semantic-pipeline-spine.test.ts tests/unit/semantic-architecture-boundary.test.ts tests/unit/fact-delta.test.ts tests/contract/fact-delta-contract.test.ts tests/unit/impact-propagation.test.ts tests/contract/impact-propagation-contract.test.ts tests/unit/validated-engineering-ir.test.ts tests/contract/test-impact.test.ts tests/contract/contract-freeze.test.ts tests/integration/file-migrations.test.ts tests/integration/migration-files.test.ts tests/integration/migration-validation.test.ts tests/integration/pipeline-kernel.test.ts tests/integration/text-migrations.test.ts tests/integration/workbench-writer-lease.test.ts tests/integration/upgrade-pipeline-kernel.test.ts tests/unit/db-expand-contract.test.ts tests/unit/graph-graphical-mutations.test.ts tests/unit/graph-mutation-dry-run.test.ts tests/unit/project-write-boundary-upgrade.test.ts tests/unit/repair-plan.test.ts --timeout 600000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=f29ecb73ac64aaae23b7989688c4a3ca79593d43 bun run imports:check"
  - "SEC_AFFECTED_TESTS_BASE=f29ecb73ac64aaae23b7989688c4a3ca79593d43 bun run test:affected"
  - "bun run test:contract-freeze"
  - "bun run docs:doctor"
  - "git diff --check"
---

# SM-3R1 Focused Blocker Repair V1

本包只关闭 `docs/evidence/v0-4-semantic-mutation-apply-focused-batch-stop-record.json` 中冻结的四个失败簇。`main@f29ecb73ac64aaae23b7989688c4a3ca79593d43` 已包含 SM-3 apply、lease、journal、isolated Verification、publish、rollback 与 recovery 的主体实现，但 2026-07-13 的一次 39-file owner batch 为 263 pass / 5 fail；该失败证据与两份更早 stop record 共同优先于历史聊天或旧分支状态。

修复顺序固定为：先完成四簇静态实现与 deterministic instrumentation，再集中审查一次完整 diff；只有静态审查无新增 blocker 时，才运行一次原 39-file combined owner batch 与 typecheck。该批通过后才进入 changed-only imports、canonical affected、完整 Contract Freeze、docs doctor、patch hygiene 与 frozen-head Quick/Risk evidence。不得运行 Full、all-slow、workspace/reference full chain 或 GitHub Actions。

四个实现 seam 不改变 canonical contract：terminal store 只拆分 full audit、exact lookup 与 durable sequence head；workspace creator 只在 `initWorkspace()` 创建边界补齐 root 生命周期；isolated runtime 只消除 bundle 的 checkout path 并对齐被复制的 compose resource destination；AppContainer 只修复已静态确认的 sentinel/recovery/cleanup 缺陷并保留 path-free typed internal evidence。任何需要修改 forbidden path、public capability shape、Pipeline order、retention 数值或 Verification reduction 的发现都必须先停止并重新冻结 Work Package。

Draft PR #108 独立拥有六个 repository Skill、`PLANS.md`、`.gitignore`、`docs/04-AI自主实现执行蓝图.md`、`docs/scripts/docs-doctor.ts` 与 `docs/work-packages/_template.md`。本包不得触碰这些 11 个路径，也不得把 #108 的 context-engineering 设计提前复制进 `main`。
