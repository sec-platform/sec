---
schema: codex-development-work-package-v1
id: sm3-exit-closure-v4
tracking: issue-106
base: 75806415f2279106ada32b7619786e5f4f76d35a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: sm3-runtime-package-identity-repair
    owner: a0
    ownedPaths:
      - docs/03-MVP实施计划与路线图.md
      - docs/evidence/v0-4-semantic-mutation-exit-closure-2026-07-19.json
      - docs/work-packages/sm3-exit-closure-v1.md
      - docs/work-packages/sm3-exit-closure-v2.md
      - docs/work-packages/sm3-exit-closure-v3.md
      - docs/work-packages/sm3-exit-closure-v4.md
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/runtime-verification-invocation-contract.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
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
  - "The v3 production sentinel remains one terminal failed identity at df8ddfaaed7dd2335d1c7ba171786eff9fbfd6aa: 0 pass / 1 fail in 6799 ms after capability and materialization, before child/browser/AppContainer execution; it is never rerun."
  - "Every direct runtime command descriptor owns both its module entrypoint and package-manifest path; unit-only commands own neither."
  - "Runtime capability issuance requires each non-null entrypoint and manifest as nonempty exact plan inputs before publication, so materialization cannot succeed with an identity-incomplete package."
  - "Production and unit fixtures derive directories, entrypoint bytes, and package manifests only from the canonical descriptor; no helper duplicates Next or Playwright paths."
  - "Focused negative tests remove or empty each required entrypoint/manifest and prove capability unavailable before materialization."
  - "No package installation, Playwright/browser execution, shared warmup, AppContainer change, C, Rust, FFI, builder duplication, or request expansion is added."
  - "After exact-head focused/static gates pass, exactly one v4 production sentinel proves bundle, capability, materialization, child, Verification, settlement, and cleanup."
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

# SM-3 Exit Closure V4

V3 已使 cold linked worktree 的 compiler/runtime/cache authority 与 plan-owned sentinel fixtures 正确闭合；其唯一 production run 的 capability issuance 和 materialization 均通过，随后在读取 staged `next/package.json` 时 fail-fast。现有 runtime invocation contract 只声明 `next/dist/bin/next` 与 `@playwright/test/cli.js`，runtime plan 因而允许“有 executable entry、无 package identity”的不完整依赖进入 materialized tree。

V4 在唯一 invocation descriptor 上增加 package-manifest path，并让 capability issuance 同时要求 nonempty entrypoint 与 manifest。生产与 unit fixtures遍历相同 descriptor生成目录和最小 package identity；negative tests逐项删除/清空这两类输入。该修复关闭所有当前及未来 direct runtime command 的同类缺口，不新增安装或执行面。
