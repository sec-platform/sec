---
schema: codex-development-work-package-v1
id: sm3-exit-closure-v7
tracking: issue-106
base: 75806415f2279106ada32b7619786e5f4f76d35a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: sm3-complete-runtime-package-closure
    owner: a0
    ownedPaths:
      - docs/03-MVP实施计划与路线图.md
      - docs/evidence/v0-4-semantic-mutation-exit-closure-2026-07-19.json
      - docs/work-packages/sm3-exit-closure-v1.md
      - docs/work-packages/sm3-exit-closure-v2.md
      - docs/work-packages/sm3-exit-closure-v3.md
      - docs/work-packages/sm3-exit-closure-v4.md
      - docs/work-packages/sm3-exit-closure-v5.md
      - docs/work-packages/sm3-exit-closure-v6.md
      - docs/work-packages/sm3-exit-closure-v7.md
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/runtime-verification-invocation-contract.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/shared/observed-process.ts
      - platform/shared/project-runtime.ts
      - platform/shared/runtime-dependency-spec.ts
      - tests/contract/semantic-mutation-contract.test.ts
      - tests/helpers/semantic-mutation-production-sentinel.ts
      - tests/integration/project-runtime.test.ts
      - tests/unit/observed-process-lifecycle.test.ts
      - tests/unit/runtime-verification.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts
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
  - "The v6 production sentinel remains one terminal failed identity at b3c64a1d9bd09f4055bd51bf4782ab425abc019a: 0 pass / 1 fail in 14699 ms; it is never rerun."
  - "V6 proves canonical compiler package, compiler modules, compose templates, policies, registry, bundle, child, and lifecycle settlement; its remaining pipeline-resolve TEMPLATE-BUILD-001 is caused by the sentinel overlaying a direct-command-only dependencyModules tree that capability issuance incorrectly accepted as a complete prebound runtime tree."
  - "One immutable runtime dependency package-name contract is derived from the existing required dependency/devDependency keys and is consumed by isolated capability issuance and prebound-only project readiness."
  - "Capability issuance requires a nonempty package.json with the exact package name and a nonempty installed version for every required runtime package before publishing a plan; direct command entrypoint checks remain additional, not substitutive."
  - "Prebound-only readiness checks the same full manifest closure before typecheck or template validation, so a forged binding plus only next/package.json cannot enter the pipeline."
  - "The production sentinel overlays only its non-executed browser cache; dependencyModules and every compiler-owned source come from the canonical product resolver."
  - "Focused negative tests delete a non-command package manifest and forge a manifest name, proving both capability and prebound readiness fail before child execution or mutation."
  - "No dependency installation, Playwright/browser execution, AppContainer execution change, C, Rust, new FFI surface, builder duplication, request expansion, or product capability claim is added."
  - "After exact-head focused/static gates pass, exactly one v7 production sentinel proves bundle, capability, materialization, child, Verification, settlement, and cleanup."
tests:
  - "bun test tests/integration/project-runtime.test.ts -t 'prebound dependency readiness' --timeout 180000"
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

# SM-3 Exit Closure V7

V6 删除了 sentinel 对 compiler package、compiler modules、compose templates、official policies 和 official registry 的重复权威，真实 registry resolve 已成功进入 template validation。剩余 `TEMPLATE-BUILD-001` 暴露了更底层的共同缺口：isolated capability 只检查 `next` / Playwright 的 direct command entrypoint 与 package identity，`prebound-only` readiness 也只检查 `next/package.json`，因此一个缺少 React、types、YAML、ts-morph 等完整依赖的 tree 仍能携带正确 binding 进入 typecheck。

V7 把完整 runtime package manifest closure 提升为共享合同。现有 runtime dependency spec 的 dependency/devDependency 名称成为唯一冻结列表；capability publication 与 prebound-only readiness 均要求每个 package manifest 非空、name 精确、installed version 非空。direct command descriptor 继续额外绑定可执行入口，但不再冒充完整依赖证明。production sentinel 删除最后一个 dependencyModules fixture，只保留不会执行的 browser cache fixture。
