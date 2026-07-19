---
schema: codex-development-work-package-v1
id: sm3-exit-closure-v5
tracking: issue-106
base: 75806415f2279106ada32b7619786e5f4f76d35a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: sm3-observed-process-natural-exit-repair
    owner: a0
    ownedPaths:
      - docs/03-MVP实施计划与路线图.md
      - docs/evidence/v0-4-semantic-mutation-exit-closure-2026-07-19.json
      - docs/work-packages/sm3-exit-closure-v1.md
      - docs/work-packages/sm3-exit-closure-v2.md
      - docs/work-packages/sm3-exit-closure-v3.md
      - docs/work-packages/sm3-exit-closure-v4.md
      - docs/work-packages/sm3-exit-closure-v5.md
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
  - "The v4 production sentinel remains one terminal failed identity at aa23f6d494401e5df2327d8716a823bf96f73b93: 0 pass / 1 fail in 10593 ms; it is never rerun."
  - "The v4 child emitted exactly 47 stderr bytes with sha256:b96092f9911932a4794955e9b53cbe1b128ecad22d78266920e11ab5e2b4c10b, which is the canonical controlled-failure marker, and reached a closed child, drained streams, and closed tree; therefore no further import, bundle, package-identity, Bun-argument, browser, or AppContainer probing is permitted for that identity."
  - "The single observed-process owner distinguishes a naturally exited closed Job from a lifecycle failure without treating root close alone as tree proof, weakening bounded termination, or adding a second census/termination algorithm."
  - "A focused real Windows native-child regression proves nonzero controlled exit, final stderr drain, exact exit code, zero forced termination, and closed Job settlement."
  - "Deterministic lifecycle tests continue to reject an unproved census and preserve lease, output-budget, timeout, and cleanup behavior."
  - "No dependency or directory patch, package installation, Playwright/browser execution, AppContainer execution change, C, Rust, new FFI surface, builder duplication, or request expansion is added."
  - "After exact-head focused/static gates pass, exactly one v5 production sentinel proves bundle, capability, materialization, child, Verification, settlement, and cleanup."
tests:
  - "bun test tests/unit/observed-process-lifecycle.test.ts --timeout 180000"
  - "bun test tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts -t 'native controlled failure drains stderr and proves Job closure' --timeout 180000"
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

# SM-3 Exit Closure V5

V4 已闭合 compiler generation、runtime modules、browser cache、direct entrypoint 与 package identity。其唯一 production run 中，child 输出 47 字节受控失败标记；字节数和摘要与 runner 的 canonical stderr 完全一致，且 high-level outcome 已证明 child close、stream drain 和最终 tree close。失败原因不是新的 import 缺口，而是共享 Windows observed-process 在 natural exit 后的 Job census handoff 将一个已经闭合的受控退出误分类为 `lifecycle-failed` 并多做一次 forced termination。

V5 只修复这一个共享生命周期权威：native child adapter 继续负责 suspended launch、Job custody 与 pipe EOF；`runObservedCommand` 继续负责 natural-close 后的唯一 Job accounting proof。两层之间必须传递仍有效的 Job controller，正常非零退出不得触发 termination；census 失败仍 fail closed。新增的 real Windows focused regression 使用当前 Bun 直接产生 canonical 47-byte stderr 和非零退出码，不执行浏览器或 AppContainer。所有静态与 focused 门禁通过后，使用新 identity 仅运行一次 v5 production sentinel。
