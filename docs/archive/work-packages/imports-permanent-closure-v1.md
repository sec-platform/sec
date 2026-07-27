---
schema: codex-development-work-package-v1
id: imports-permanent-closure-v1
tracking: none
base: 3cdb1f87ed341aed8036147c80aa694ba65463d2
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: imports-permanent-closure
    owner: a0
    ownedPaths:
      - .bun-version
      - .githooks/pre-push
      - .github/workflows/architecture-tools.yml
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - AGENTS.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/bun-1-3-14-toolchain-migration-v1.md
      - docs/work-packages/imports-authority-closure-v2.md
      - docs/work-packages/imports-candidate-seal-v1.md
      - docs/work-packages/imports-dependency-generation-v1.md
      - docs/work-packages/imports-permanent-closure-v1.md
      - package.json
      - platform/compiler/compose/microservice-lower-pass.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/dev-runner/dependency-bootstrap.ts
      - platform/dev-runner/import-organizer.ts
      - platform/shared/bun-runtime-version.ts
      - platform/shared/project-runtime.ts
      - scripts/install-git-hooks.ts
      - tests/helpers/compiler-fixtures.ts
      - tests/integration/project-runtime.test.ts
      - tests/integration/semantic-mutation-apply.test.ts
      - tests/unit/dev-runner-dependency-bootstrap.test.ts
      - tests/unit/import-organizer-selection.test.ts
      - tests/unit/import-organizer-staged.test.ts
      - tests/unit/install-git-hooks.test.ts
      - tests/unit/microservice-lower-pass.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
forbiddenPaths:
  - docs/evidence/
  - tests/e2e/
acceptance:
  - "Bun 1.3.14 is one canonical, enforced toolchain identity across local bootstrap, package metadata, CI setup, isolated builder, and generated Docker targets."
  - "Compiler dependencies are immutable validated generations with direct/transitive critical entry integrity, dead-owner recovery, atomic publish, and rollback preservation."
  - "Candidate import normalization uses only the complete Git index context, and commit plus pre-push hooks close ordinary, amend, rebase, and squash paths before remote execution."
  - "Hosted changed-only base failures stop with IMPORT-AUTHORITY-003 and never expand into a full repository scan."
  - "Repository operating authority, executable hooks, implementation, tests, and CI projections describe the same lifecycle."
  - "The change adds no Playwright execution, browser automation, C, Rust, FFI, Full, slow, AppContainer work, or product sentinel run."
tests:
  - "bun test tests/integration/project-runtime.test.ts tests/unit/dev-runner-dependency-bootstrap.test.ts tests/unit/import-organizer-selection.test.ts tests/unit/import-organizer-staged.test.ts tests/unit/install-git-hooks.test.ts tests/unit/microservice-lower-pass.test.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts --timeout 180000"
  - "SEC_IMPORTS_CHANGED_ONLY=0 bun run imports:check"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=3cdb1f87ed341aed8036147c80aa694ba65463d2 bun run imports:check"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "git diff --check"
---

# Imports Permanent Closure V1

本 manifest 是 PR #126 的唯一集成 authority。三个 component manifest 分别冻结 Bun 工具链迁移、compiler dependency generation 与 candidate seal 的局部合同；本文件只统一它们的 owned surface、验收和 Quick profile，不建立第二套实现定义。

闭合后的硬不变量是：开发命令先验证准确工具链与 active dependency generation；本地 candidate 只由 index snapshot 决定；commit 和 push 都重算相同 normalization；远端只读复核 exact base/head。任一身份不一致在加载第三方模块或触发远端业务 Gate 前一次性失败。
