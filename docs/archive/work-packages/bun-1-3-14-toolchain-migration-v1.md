---
schema: codex-development-work-package-v1
id: bun-1-3-14-toolchain-migration-v1
tracking: none
base: cb1442ae972d67b5c6fc782e52a614905b23a29b
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: bun-toolchain-migration
    owner: a0
    ownedPaths:
      - .bun-version
      - .github/workflows/architecture-tools.yml
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/work-packages/bun-1-3-14-toolchain-migration-v1.md
      - package.json
      - platform/compiler/compose/microservice-lower-pass.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/shared/bun-runtime-version.ts
      - platform/shared/project-runtime.ts
      - tests/helpers/compiler-fixtures.ts
      - tests/integration/project-runtime.test.ts
      - tests/integration/semantic-mutation-apply.test.ts
      - tests/unit/microservice-lower-pass.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
forbiddenPaths:
  - docs/evidence/
  - tests/e2e/
acceptance:
  - ".bun-version is the single canonical Bun version and contains 1.3.14; packageManager and every setup-bun workflow are tested projections."
  - "Compiler dependency bootstrap rejects declared, canonical, or actual Bun version disagreement before loading third-party modules."
  - "The isolated runner build guard and generated microservice Docker image consume the same canonical version."
  - "Historical Bun 1.3.6 evidence and synthetic evidence fixtures retain their original identities."
  - "The change adds no Playwright execution, browser automation, C, Rust, FFI, Full, slow, or production sentinel run."
tests:
  - "bun test tests/integration/project-runtime.test.ts tests/unit/microservice-lower-pass.test.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=3cdb1f87ed341aed8036147c80aa694ba65463d2 bun run imports:check"
  - "bun run docs:doctor"
  - "git diff --check"
---

# Bun 1.3.14 Toolchain Migration V1

仓库此前声明 Bun 1.3.6，但开发环境实际执行 1.3.14；dependency binding、CI、isolated runner 与生成 Docker 因此存在双重工具链事实。本包不改写任何历史 1.3.6 evidence，而是从此提交起把 `.bun-version` 设为唯一当前 authority，并使所有可执行投影统一消费或验证 1.3.14。

升级和 dependency generation 同批收敛，使旧 runtime 创建的 active tree 在加载 TypeScript 等第三方模块前失效并重建。任何 canonical/packageManager/actual 三方不一致都以 `IMPORT-AUTHORITY-001` 一次性终止，不再让版本漂移延迟成 import、loader 或测试噪声。
