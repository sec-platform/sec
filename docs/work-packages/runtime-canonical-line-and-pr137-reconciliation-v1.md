---
schema: codex-development-work-package-v1
id: runtime-canonical-line-and-pr137-reconciliation-v1
tracking: issue-132
base: 4ef0d38f726ce38d931ea66e859d20214469c69e
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v11
tasks:
  - id: reconstruct-one-runtime-authority-and-retire-pr137
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - bun.lock
      - package.json
      - docs/05-编译器核心实现规格.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/runtime-canonical-line-and-pr137-reconciliation-v1.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - platform/compiler/semantic-mutation/isolated-verification-phase-telemetry.ts
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/dev-runner/dependency-bootstrap.ts
      - platform/dev-runner/fast-test-policy.ts
      - platform/dev-runner/test-runner.ts
      - platform/shared/ci-verification-plan.ts
      - platform/shared/dependency-environment.ts
      - platform/shared/project-base.ts
      - platform/shared/project-runtime.ts
      - platform/shared/runtime-dependency-spec.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/integration/project-runtime.test.ts
      - tests/integration/semantic-mutation-apply.test.ts
      - tests/setup/runtime-deps.setup.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tests/unit/dependency-environment.test.ts
      - tests/unit/dev-runner-dependency-bootstrap.test.ts
      - tests/unit/playwright-browser-cache.test.ts
      - tests/unit/runtime-dependency-spec.test.ts
      - tests/unit/runtime-verification.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/unit/semantic-mutation-isolated-phase-telemetry.test.ts
      - tests/unit/test-runner.test.ts
forbiddenPaths:
  - .claude/
  - .gitattributes
  - .githooks/
  - AGENTS.md
  - README.md
  - bunfig.toml
  - tsconfig.json
  - docs/00-文档索引与一致性规则.md
  - docs/01-用户能力模块化开发-主题整理稿.md
  - docs/02-工程编译器-MVP-PRD与架构稿.md
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/06-Registry与Block协议规范.md
  - docs/07-Pass状态机、错误码与恢复机制.md
  - docs/08-Verification、Provenance与Graph规范.md
  - docs/09-AI Runtime、任务信封与治理规范.md
  - docs/10-升级迁移与Override规范.md
  - docs/11-Workbench与可视化规范.md
  - docs/12-编译管道与行为流图示.md
  - docs/13-独立工具分发与打包规划.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/archive/
  - docs/evidence/
  - docs/goals/
  - docs/governance/
  - docs/scripts/
  - platform/compiler/index.ts
  - platform/shared/ci-verification-revision.ts
  - platform/shared/process.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/install-git-hooks.ts
  - tests/e2e/
  - tests/fixtures/
acceptance:
  - "The successor is a single-parent reconstruction on 4ef0d38. Old runtime branches, PR #137, historical Work Packages, evidence files and control-plane documents are sources only and are not merged or replayed."
  - "The stable production blobs selected from d2f7083 are preserved for runtime verification, staged external Node authority, dependency lifecycle, snapshot identity, process isolation and phase telemetry. The ceaf72a temporary diagnostic blob cf25874 is absent; semantic-mutation-apply.test.ts uses stable blob 8343772 before any necessary V11-only normalization."
  - "runtime-dependency-spec.ts is the only runtime package identity owner. Root package.json pins @playwright/test to one exact numeric release, generated runtime manifests preserve it, and invalid ranges fail before dependency or browser materialization."
  - "project-runtime.ts remains the only external Node and project-local Playwright cache/install lifecycle owner. The installer has one positive bounded timeout, abort/process-tree cleanup, lock release and inspected executable postcondition; no hook, verifier or ambient cache implements a second installer."
  - "run-runtime-verification.ts only orchestrates the shared dependency owner, stages one external Node authority, builds fail-closed platform environments and emits the canonical phase protocol. The isolated child consumes the runtime plan and never computes a second plan or revision."
  - "Windows namespaced TEMP and browser-cache representations stay inside staging-owned authority; POSIX stays canonical. Runtime acceptance receives only the physically proven shell surface required by Node, Playwright and cleanup."
  - "Fast-test process isolation is owned by fast-test-policy.ts and executed by test-runner.ts. Tests do not duplicate the policy and no one-shot diagnostic selector remains active."
  - "Main already owns ci-verification-v10. Because this package changes verifier/runtime trust-root inputs, V1 advances atomically to ci-verification-v11 and sec-verification-v11-* while V2 composition remains ci-verification-v7. Candidate-hosted evidence cannot self-authorize this bootstrap."
  - "Canonical docs record one dependency/runtime authority and do not copy current SHA, PR, run, artifact namespace, timeout value or historical failure tables."
  - "Focused owner tests, control-plane lifecycle, typecheck, changed-only imports, docs doctor, manifest scope, patch hygiene and GitNexus change detection pass on the frozen head."
  - "Canonical affected executes exactly once on the final exact head. Only a real affected PASS permits one selected Risk execution; focused results or historical failures cannot be composed into PASS."
  - "The successor PR has no unresolved review or REQUEST_CHANGES and is integrated through the documented V11 manual bootstrap. Only after the successor is in main is PR #137 closed as absorbed/superseded and its remote branch removed."
  - "After merge, main is reloaded and every local branch/worktree is deleted only after its committed and uncommitted bytes are adopted, proven equivalent or explicitly retired."
tests:
  - "runtime-identity-focused: bun test tests/unit/runtime-dependency-spec.test.ts tests/unit/playwright-browser-cache.test.ts tests/unit/runtime-verification.test.ts tests/unit/dependency-environment.test.ts tests/unit/dev-runner-dependency-bootstrap.test.ts --timeout 180000"
  - "runtime-plan-focused: bun test tests/unit/semantic-mutation-isolated-phase-telemetry.test.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/unit/test-runner.test.ts tests/integration/project-runtime.test.ts --timeout 180000"
  - "v11-contract-focused: bun test tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/docs-doctor.test.ts tests/contract/sec-merge-gate.test.ts tests/unit/codex-work-package-contract.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts --timeout 180000"
  - "control-plane-lifecycle: bun test tests/contract/document-control-plane-lifecycle.test.ts --timeout 180000"
  - "typecheck: bun run typecheck"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=4ef0d38f726ce38d931ea66e859d20214469c69e with bun run imports:check"
  - "docs-doctor: bun run docs:doctor"
  - "canonical-affected: SEC_CHANGED_BASE=4ef0d38f726ce38d931ea66e859d20214469c69e and bun run test:affected exactly once on the final exact head"
  - "impacted-risk: one selected ci-verification-v11 Risk execution only after canonical affected PASS"
  - "manual-bootstrap: independent scope/review plus base-side integration for the V11 trust-root change"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check 4ef0d38f726ce38d931ea66e859d20214469c69e HEAD --"
  - "gitnexus: impact before edits and detect_changes compare against main after final freeze"
---

# Runtime Canonical Line and PR #137 Reconciliation V1

## Architectural goal

把分散在 PR #137 与 retained runtime worktrees 中仍有效的能力重建为一个 canonical runtime authority：精确 dependency identity、唯一 external Node/Playwright lifecycle、可验证的 staging plan、隔离环境与阶段 telemetry。旧分支只提供 blob 与失败线索；只有新 `main` 上的最终实现、测试、CI、Review 和真实产物可以证明完成。

```text
root dependency identity
→ shared dependency/runtime lifecycle
→ frozen staged runtime plan
→ isolated child materialization
→ runtime verification
→ exact affected evidence
```

## Closure order

```text
freeze one package
→ reconstruct stable production/test blobs
→ reconcile V11 trust root and canonical docs
→ focused owner contracts
→ type/import/docs/control/scope
→ canonical affected once
→ selected Risk once only after PASS
→ manual bootstrap + review
→ merge successor
→ close #137 as absorbed
→ reload main and clean proven-redundant refs/worktrees
```

## Gate ownership and stop

A0 是全部 Gate 的唯一 owner。任何 focused failure只允许一次根因修复和最小 sentinel；canonical affected、Risk、cleanup 或 bootstrap失败立即冻结 exact-head evidence，禁止同 identity 重跑或把局部 PASS 拼接成通过。

## Reload if

- live `origin/main` 不再是 `4ef0d38f726ce38d931ea66e859d20214469c69e`。
- PR #137 的 head、base、state、Review 或 CI 变化。
- Goal combined revision 不再是 `sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676`。
- 选定的稳定 blob、dependency identity、browser revision、runtime plan或 ownership seam 与代码冲突。
- 需要修改任一 forbidden path，或出现临时诊断、retained workspace、process、lock、artifact drift。

## Stop conditions

- 精确 Playwright pin仍不能使 generated runtime、browser registry与可执行文件 identity一致。
- runtime lifecycle、plan、telemetry 或 process isolation出现第二 owner。
- canonical affected失败。
- Risk、Review或V11人工 bootstrap拒绝 exact head。
