---
schema: codex-development-work-package-v1
id: sm3-exit-closure-v2
tracking: issue-106
base: 75806415f2279106ada32b7619786e5f4f76d35a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: sm3-exit-import-authority-repair
    owner: a0
    ownedPaths:
      - docs/03-MVP实施计划与路线图.md
      - docs/evidence/v0-4-semantic-mutation-exit-closure-2026-07-19.json
      - docs/work-packages/sm3-exit-closure-v1.md
      - docs/work-packages/sm3-exit-closure-v2.md
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/shared/project-runtime.ts
      - tests/contract/semantic-mutation-contract.test.ts
      - tests/helpers/semantic-mutation-production-sentinel.ts
      - tests/unit/runtime-verification.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
forbiddenPaths:
  - .github/workflows/
  - AGENTS.md
  - bun.lock
  - bunfig.toml
  - package.json
  - platform/shared/windows-appcontainer-executor.ts
  - platform/shared/windows-appcontainer-native-helper.ts
  - scripts/
  - tests/e2e/
acceptance:
  - "The failed v1 production sentinel remains recorded as one terminal identity: Bun 1.3.14, 0 pass / 1 fail, ENOENT before bundle, child, publish, or browser execution; it is never rerun under the v1 identity."
  - "One dependency authority names compilerModulesRoot, dependencyModules, and browserCache independently; the active validated compiler generation is never inferred from the generated-project .shared-deps runtime subset."
  - "The production isolated child and production sentinel consume that authority directly; neither owns a second dependency-root, manifest, install, or builder algorithm."
  - "Focused executable tests prove local-generation, external-host, legacy shared-runtime, alias, and identity-drift behavior, while a source contract prevents the sentinel from restoring the obsolete .shared-deps compiler-root derivation."
  - "No Playwright or browser installation/automation, AppContainer execution change, C, Rust, FFI, second builder, request-schema expansion, or duplicate production sentinel is added."
  - "After focused/static gates pass on the repair head, exactly one v2 production sentinel proves the real bundle, child, Verification, completion, settlement, and cleanup path."
  - "Final evidence binds exact head/tree/runtime, every command/result/duration, v1 invalidation, v2 product/test blob ledger, reuse decisions, and AppContainer capabilityComplete:false."
tests:
  - "bun test tests/unit/runtime-verification.test.ts tests/contract/semantic-mutation-contract.test.ts --timeout 180000"
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=75806415f2279106ada32b7619786e5f4f76d35a bun run imports:check"
  - "git diff --check"
  - "SEC_RUN_SM3_PRODUCTION_SENTINEL=1 bun test tests/integration/semantic-mutation-production-sentinel.test.ts --timeout 300000"
  - "bun run test:affected"
  - "bun run test:contract-freeze"
  - "bun run docs:doctor"
---

# SM-3 Exit Closure V2

V1 的 Bun 1.3.14 production sentinel 在任何 bundle、child、publish、Playwright 或 AppContainer 执行前，以 `.shared-deps/node_modules/playwright-core/browsers.json` 的 `ENOENT` fail-fast。该失败证明 Import Permanent Closure 已把 compiler dependencies 迁入 manifest-bound active generation，但 Semantic Mutation 的 dependency-source resolver 与 production sentinel 仍把 compiler generation、generated-project runtime subset 和 browser cache 当成同一个 `.shared-deps` pair。

V2 不修补缺失目录，也不恢复旧依赖树。唯一修复是把 dependency authority 建模为三个独立、命名且可测试的 source；active compiler generation 继续由 `project-runtime` 的 canonical path/binding owner 管理，隔离 child 与 sentinel 只消费 resolver 结果。静态合同永久禁止 sentinel 自行推导 `.shared-deps` compiler root。所有非 production 门禁通过后，V2 使用新 manifest identity 运行一次 production sentinel；V1 失败身份不重跑。
