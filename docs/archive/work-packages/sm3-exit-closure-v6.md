---
schema: codex-development-work-package-v1
id: sm3-exit-closure-v6
tracking: issue-106
base: 75806415f2279106ada32b7619786e5f4f76d35a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: sm3-canonical-compiler-input-authority
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
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/runtime-verification-invocation-contract.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/shared/observed-process.ts
      - platform/shared/project-runtime.ts
      - tests/contract/semantic-mutation-contract.test.ts
      - tests/helpers/semantic-mutation-production-sentinel.ts
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
  - "The v5 production sentinel remains one terminal failed identity at 6e542901d62f3109d21087fe8be810f72c8f0207: 0 pass / 1 fail in 10058 ms; it is never rerun."
  - "V5 proves bundle, capability, materialization, the real child, controlled exit, observed-process settlement, progress, and child outcome publication; its only mismatch is pipeline-resolve MANIFEST-SCHEMA-004 because the sentinel-owned registry fixture declares blocks: []."
  - "The product exports one immutable canonical runtime-input source resolver used by both default capability issuance and the production sentinel; compiler package, compiler modules, compose templates, official policies, and official registry have no second sentinel authority."
  - "The production sentinel owns only its bounded direct-runtime module/package fixtures and non-executed browser-cache fixture, and overlays exactly those two roots on the canonical compiler inputs."
  - "A source contract rejects hand-authored compiler package, compiler module, compose, policy, or registry fixtures in the production sentinel and requires consumption of the canonical resolver."
  - "No dependency installation, Playwright/browser execution, AppContainer execution change, C, Rust, new FFI surface, builder duplication, request expansion, or product capability claim is added."
  - "After exact-head focused/static gates pass, exactly one v6 production sentinel proves bundle, capability, materialization, child, Verification, settlement, and cleanup."
tests:
  - "bun test tests/unit/runtime-verification.test.ts tests/contract/semantic-mutation-contract.test.ts --timeout 180000"
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts --timeout 180000"
  - "bun test tests/unit/observed-process-lifecycle.test.ts --timeout 180000"
  - "bun test tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts -t 'native controlled failure drains stderr and proves Job closure' --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=75806415f2279106ada32b7619786e5f4f76d35a bun run imports:check"
  - "git diff --check"
  - "SEC_RUN_SM3_PRODUCTION_SENTINEL=1 bun test tests/integration/semantic-mutation-production-sentinel.test.ts --timeout 300000"
  - "bun run test:affected"
  - "bun run test:contract-freeze"
  - "bun run docs:doctor"
---

# SM-3 Exit Closure V6

V5 已证明 import/runtime identity 与 Windows observed-process settlement 闭合：真实 child 以 canonical 70 退出并发布 durable outcome，父进程进入 sentinel 的 pipeline assertion。唯一失败是 production sentinel 自己构造的 `official-registry/registry.yaml` 固定写成 `blocks: []`，与 `initWorkspace()` 初始化出的 `auth/basic-session@0.1.0` 真实需求矛盾，于 `pipeline-resolve` 返回 `MANIFEST-SCHEMA-004`。这不是产品 registry 或 import resolver 缺陷，而是测试 helper 仍持有第二套 compiler-input 权威。

V6 删除这套重复权威。产品模块公开一个冻结的 canonical runtime-input source resolver，默认 capability issuance 与 production sentinel 同时消费它；sentinel 仅覆盖 direct runtime modules/package manifests 和未执行的 browser cache 两个明确 fixture root。compiler package、compiler modules、compose templates、official policies、official registry 均直接来自同一产品 resolver，后续新增 block、policy、template 或 package identity 时无需同步修改 sentinel。
