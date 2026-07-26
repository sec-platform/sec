---
schema: codex-development-work-package-v1
id: fast-feedback-closure-v2
tracking: issue-132
base: e30e434d15c9a87541866e64a56051d08b70cad4
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v16
tasks:
  - id: close-fast-feedback-structural-waste
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/test-architecture.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/fast-feedback-closure-v2.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/dev-runner/env-manager.ts
      - platform/dev-runner/fast-test-policy.ts
      - platform/dev-runner/test-runner.ts
      - platform/shared/ci-verification-plan.ts
      - platform/shared/test-budget-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - platform/shared/test-impact-rules/pipeline.ts
      - platform/shared/test-impact-rules/semantic.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/test-impact.test.ts
      - tests/e2e/install-git-hooks.test.ts
      - tests/e2e/pipeline.test.ts
      - tests/e2e/runtime-host.test.ts
      - tests/e2e/semantic-runtime-contract.test.ts
      - tests/e2e/summary.test.ts
      - tests/e2e/windows-appcontainer-executor.test.ts
      - tests/helpers/semantic-mutation-recovery-fixture.ts
      - tests/helpers/windows-browser-launch-path-fixture.ts
      - tests/integration/overview.test.ts
      - tests/integration/pipeline-kernel.test.ts
      - tests/integration/pipeline-workspace-write-lease.test.ts
      - tests/integration/semantic-core-vertical.test.ts
      - tests/integration/workspace-engineering-ir.test.ts
      - tests/unit/canonical-ir-identity-revision.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-evidence-reuse-contract.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-pr-risk-selection.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tests/unit/env-manager.test.ts
      - tests/unit/install-git-hooks.test.ts
      - tests/unit/semantic-mutation-apply.test.ts
      - tests/unit/test-runner.test.ts
      - tests/unit/windows-browser-launch-path.test.ts
      - tests/unit/windows-appcontainer-executor.test.ts
      - tests/testkit/workspace.ts
forbiddenPaths:
  - .codex/
  - .githooks/
  - AGENTS.md
  - docs/00-文档索引与一致性规则.md
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/archive/
  - docs/evidence/
  - docs/goals/
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - platform/shared/ci-evidence-reuse-contract.ts
  - platform/shared/test-impact-contract.ts
  - scripts/
  - tsconfig.json
acceptance:
  - "The immutable reusable-evidence fixture is read from the exact HEAD Git blob; Windows checkout CRLF bytes never act as Git raw authority and no normalization hides the mismatch."
  - "The import organizer micro-sentinel is concurrent-safe and absent from the process-isolation registry."
  - "Fast process planning keeps every selected file exactly once, raises the already-bounded concurrent shard capacity without raising Bun test concurrency, and distinguishes bounded-parallel process isolation from truly exclusive execution."
  - "Default test:fast excludes deterministic deep acceptance owned by full Workspace, durable recovery, server/runtime, repository worktree, and upgrade transactions; explicit affected selection and test:full retain every excluded file."
  - "Concurrent fast shards execute in one bounded batch concurrency, settle already-started siblings on failure, and never launch later batches after the first failed batch."
  - "Bounded-parallel isolated children never exceed the single canonical concurrency cap; exclusive repository, host-profile, and runtime-lifecycle owners remain sequential."
  - "Every fast run owns one safe mutable test-workspace namespace and parent cleanup executes after success, child failure, planner failure, or thrown child execution; terminal residue makes the run fail while the versioned immutable template cache remains outside run ownership."
  - "Canonical IR artifact and policy-report exclusion acceptance reuses the existing workspace Engineering IR integration setup; the unit file contains no full workspace preparation."
  - "Structural tests prove fewer process waves, one workspace setup for the migrated IR acceptance, no duplicate or missing test file, and zero failed-run workspace residue without a wall-clock threshold."
  - "Fast retains executable micro-sentinels while real Git/worktree acceptance, exhaustive SM-3 durable filesystem acceptance, and native AppContainer acceptance have explicit slow registry owners selected by test impact."
  - "Full Pipeline completion proof, verified semantic projection, locked overview, compile reentrant lease, and production Windows browser host authority run only in existing slow owners; their fast files retain focused in-memory or pre-runtime sentinels."
  - "Slow-file expensive setup is capability-scoped or lazy, so selecting an unrelated named sentinel never starts an unselected full Pipeline; locked/runtime host owners are registry-classified as runtime-heavy."
  - "The AppContainer MAX_PATH acceptance proves either successful execution or exact launch/nativeCode 267 fail-closed, with identical process/profile/owner/runtime/ACL residue checks on both paths."
  - "Comparative performance uses a fixed candidate and environment, one warm-up, at least five valid samples, median and observed range; a single duration is diagnostic only."
  - "V1 verifier revision and every active artifact producer/lookup advance atomically from V15 to V16. V2 composition stays V7, and the candidate uses manual bootstrap rather than self-authorization."
tests:
  - "eol-sentinel: bun test tests/unit/ci-evidence-reuse-contract.test.ts --test-name-pattern 'synthetic immutable PASS fixture' --timeout 180000"
  - "process-plan: bun test tests/unit/test-runner.test.ts tests/unit/env-manager.test.ts --timeout 180000"
  - "ir-unit: bun test tests/unit/canonical-ir-identity-revision.test.ts --timeout 180000"
  - "ir-integration: bun test tests/integration/workspace-engineering-ir.test.ts --timeout 180000"
  - "fast-boundary: bun test tests/unit/install-git-hooks.test.ts tests/unit/semantic-mutation-apply.test.ts tests/unit/windows-appcontainer-executor.test.ts --timeout 180000"
  - "lane-ownership: bun test tests/contract/benchmark-budget.test.ts tests/contract/ci-lanes.test.ts tests/contract/test-impact.test.ts tests/contract/slow-suite-resource-budget.test.ts tests/unit/ci-pr-risk-selection.test.ts --timeout 180000"
  - "slow-file-smoke: run one named sentinel from each migrated slow file; exhaustive durability acceptance remains final selected Risk only"
  - "appcontainer-max-path: bun test tests/e2e/windows-appcontainer-executor.test.ts --test-name-pattern 'just beyond MAX_PATH' --timeout 180000"
  - "v16-contract: bun test tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/sec-merge-gate.test.ts tests/unit/codex-work-package-contract.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts --timeout 180000"
  - "typecheck: bun run typecheck once after source stabilizes"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=e30e434d15c9a87541866e64a56051d08b70cad4 with bun run imports:check once on the frozen candidate"
  - "docs-doctor: bun run docs:doctor once"
  - "performance-sampling: after one warm-up, run the complete fast suite at least five times under the canonical fixed-environment protocol; report median and observed range"
  - "manual-bootstrap: independent exact-head architecture/evidence review plus base-side integration for the V16 trust-root transition"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check e30e434d15c9a87541866e64a56051d08b70cad4 HEAD --"
---

# Fast反馈闭环V2

## 唯一结果

把 fast suite 的确定性浪费从测试语义中剥离：Git raw authority读取正确，纯 micro-sentinel 不再独占进程，真正需要进程隔离的文件按“可有界并行/必须独占”调度，完整 Workspace 接受只初始化一次，并由父 runner 对失败清理负责。

```text
exact Git blob fixture
→ bounded concurrent shards
→ bounded-parallel isolated processes
→ exclusive processes
→ parent-owned namespace cleanup
```

## Context Capsule

- Branch：`codex/fast-feedback-closure-v2`
- Base：`main@e30e434d15c9a87541866e64a56051d08b70cad4`
- Failing reproduction：唯一完整 fast 诊断样本在54.167秒时因 synthetic PASS fixture 的 worktree CRLF bytes 与Git blob LF bytes不一致而提前失败；它不是完整总耗时或性能baseline。
- Structural census：base计划157个fast文件，17个concurrent shard与24个逐个执行的isolated process；其中import organizer文件已是约3.5秒micro-sentinel，却仍保留旧隔离。
- Long-tail ownership：canonical IR unit中的两个完整Workspace场景分别观察到约8.3秒与6.8秒；已有`workspace-engineering-ir` integration可用一次setup吸收相同acceptance。
- Invalid warm-up：结构优化后的唯一完整fast warm-up在243.023秒提前失败，未完成全部isolated/exclusive阶段，故既不是完整总耗时也不是性能baseline；warm-up无效后没有继续浪费五次采样。
- Structural pre-warm-up：候选`8a168d1`在约12.6秒因新增独立SM-3 slow suite扩大历史P0冻结inventory而失败；耐久验收随后并入既有`semantic-runtime-contract` owner，未升级P0 verifier。
- Second diagnostic warm-up：候选`87a3756`越过上述失败点后，在`semantic-core-vertical`完整verified Workspace setup约20秒处失败；同次观察到overview约51.64秒、Pipeline kernel约65.28秒、workspace lease约24.87秒与production browser authority约9.84秒的长尾。它们均是单次phase信号，不是hard baseline；迁层依据是完整Pipeline、locked Workspace、compile或production ACL这些确定性工作内容。
- Complete diagnostic warm-up：refreeze后的完整fast inventory通过，但暴露出仍被默认执行的full semantic mutation transaction、durable recovery、full Workspace projection/upgrade、server、isolated host和real worktree owner；单文件观察值从几十秒到数百秒不等。该run只证明覆盖正确且默认inventory边界仍错，不进入五样本性能集合；重新分层依据是这些确定性工作内容，不是单次duration。
- Valid default-fast sampling：固定同一staged candidate与warm环境后，五个完整有效样本全部通过，观测值为54.754、54.947、54.955、54.973、55.118秒；median为54.955秒，observed range为54.754–55.118秒。该集合是当前candidate的可比较观测基线，不转化为wall-clock hard Gate；结构性inventory、owner与process-wave不变量仍是硬约束。
- Deterministic pseudo-fast work：`install-git-hooks`运行真实repo/commit/worktree，SM-3 retention单场景执行全量durable terminal I/O，Windows AppContainer运行native host/runtime。这些稳定副作用而非单次duration决定slow归属。
- Focused closure：迁层后3个fast owner合计17 tests在3.21秒通过；MAX_PATH slow sentinel在结构化267 fail-closed路径通过。以上仍只是focused correctness evidence，不替代最终多样本性能报告。
- Cleanup failure：失败进程后`.tmp/test-workspaces`观察到22个残留目录；当前runner没有run-owned mutable namespace与父进程finally cleanup。Versioned immutable template cache必须位于namespace外继续复用，不能被普通run cleanup反复重建。
- Performance interpretation：以上duration只定位phase；结构性进程数、波次、setup与残留是本包hard invariant。最终wall-clock只按固定环境多样本协议报告。
- Trust boundary：`platform/dev-runner/**`和V1 verification plan属于verifier trust root，因此原子升级V16并走manual bootstrap；V2 composition保持V7。
- Gate owner：A0；第二次candidate invalidation后已停止broad validation并回到owner/proof。开发中只运行manifest列出的focused sentinel；结构修正和refreeze完成后才允许一次新的完整warm-up，只有它完整通过才采集至少五个有效样本与最终Gate。

## Reload if

- live `origin/main`不再是`e30e434d15c9a87541866e64a56051d08b70cad4`。
- 需要修改compiler/orchestrator、V2 composition、`test-impact-contract.ts`、`tests/testkit/workspace-cleanup.ts`或任一剩余forbidden path。
- 有界并行暴露未声明的共享repo、host、port、workspace或artifact authority。
- 第一次candidate freeze后实现继续变化。

## Stop

- Git fixture改用line-ending normalization而不是exact Git blob。
- 通过删除断言、扩大timeout、无限并发、共享mutable workspace或依赖偶然cache命中宣称变快。
- exclusive owner与bounded-parallel owner无法由可执行registry明确区分。
- runner失败后run-owned namespace仍存在，或cleanup failure被成功状态覆盖。
- V16 producer/lookup不能原子同步，V2 composition变化，或第二次candidate invalidation。
