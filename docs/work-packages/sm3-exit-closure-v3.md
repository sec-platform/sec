---
schema: codex-development-work-package-v1
id: sm3-exit-closure-v3
tracking: issue-106
base: 75806415f2279106ada32b7619786e5f4f76d35a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: sm3-exit-cold-worktree-repair
    owner: a0
    ownedPaths:
      - docs/03-MVP实施计划与路线图.md
      - docs/evidence/v0-4-semantic-mutation-exit-closure-2026-07-19.json
      - docs/work-packages/sm3-exit-closure-v1.md
      - docs/work-packages/sm3-exit-closure-v2.md
      - docs/work-packages/sm3-exit-closure-v3.md
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
  - "The v2 production sentinel remains one terminal failed identity at a6fc58c78a986db4cac52094dc3e77ae6b1c7ddf: 0 pass / 1 fail in 4154 ms, bundle diagnostic available, capability unavailable before child or browser execution; it is never rerun."
  - "Compiler generation, generated-project runtime modules, and browser cache resolve independently. A cold worktree with no shared runtime tree reuses its already proven compiler generation for runtime-module capture instead of returning a known-missing path."
  - "The production sentinel binds its existing minimal plan-owned runtime module and browser fixtures explicitly while retaining the real active compiler generation for bundled TypeScript/ts-morph closure."
  - "The sentinel fixture derives both required direct runtime entrypoints from the canonical runtime-verification invocation contract; it adds no package, installation path, browser execution, or duplicate command definition."
  - "No Playwright installation/automation, shared-dependency warmup, whole compiler-tree runtime copy, AppContainer execution change, C, Rust, FFI, second builder, or request-schema expansion is added."
  - "Focused tests cover warm shared runtime, cold shared runtime, alias/drift fallback, exact direct runtime entrypoint presence, and source authority."
  - "After exact-head focused/static gates pass, exactly one v3 production sentinel proves the real bundle, child, Verification, completion, settlement, and cleanup path."
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

# SM-3 Exit Closure V3

V2 已消除 `.shared-deps` compiler-root 硬编码，真实 resolver 也把 compiler generation 与 runtime subset 分成独立字段。其唯一 production run 随后在 capability issuance fail-fast：linked worktree 的 test preload 只准备 manifest-bound compiler generation，`.shared-deps` 只有 `.bun-cache`，resolver 的 pair fallback 却仍返回已知不存在的 runtime modules 路径。专用 production bundle diagnostic 为 `available`，因此不再调整 Bun builder。

V3 取消最后一层 pair 假设：compiler、runtime modules、browser cache 分别选择经过证明的 source。shared runtime tree 冷缺失或失稳时，runtime modules 可退回已验证 compiler generation；cache 失稳只影响 cache 自身。为避免 sentinel 扫描整棵 compiler generation或触发 shared warmup，测试显式绑定其已有的 plan-owned runtime/browser fixtures，并从唯一 invocation contract 生成两个 direct module entrypoint；compilerModulesRoot 仍是生产 active generation。该组合验证真实 bundle/child/Verification seam，同时不安装或运行 Playwright。
