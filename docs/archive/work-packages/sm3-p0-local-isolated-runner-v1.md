---
schema: codex-development-work-package-v2
id: sm3-p0-local-isolated-runner-v1
tracking: issue-106
base: 75806415f2279106ada32b7619786e5f4f76d35a
manifestState: frozen
evidenceComposition:
  policyId: sm3-p0-local-isolated-runner-v1
tasks:
  - id: sm3-exit-closure
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
      - docs/work-packages/sm3-exit-closure-v8.md
      - docs/work-packages/sm3-p0-local-isolated-runner-v1.md
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/runtime-verification-invocation-contract.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/shared/observed-process.ts
      - platform/shared/project-runtime.ts
      - platform/shared/runtime-dependency-spec.ts
      - scripts/install-git-hooks.ts
      - scripts/run-work-package-gate.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/semantic-mutation-contract.test.ts
      - tests/helpers/semantic-mutation-production-sentinel.ts
      - tests/integration/project-runtime-fixtures.ts
      - tests/integration/project-runtime.test.ts
      - tests/unit/install-git-hooks.test.ts
      - tests/unit/runtime-verification.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts
      - tests/unit/work-package-gate-execution.test.ts
forbiddenPaths:
  - .github/workflows/
  - AGENTS.md
  - PLANS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/04-AI自主实现执行蓝图.md
  - platform/cli/
  - platform/orchestrator/
  - platform/policies/
  - platform/registry/
  - platform/shared/windows-appcontainer-executor.ts
  - platform/shared/windows-appcontainer-native-helper.ts
  - platform/upgrade/
  - tests/e2e/
acceptance:
  - "The frozen candidate is exactly one commit above current main 75806415f2279106ada32b7619786e5f4f76d35a and every changed path has one literal owner."
  - "The host process performs one canonical Bun.build and supervises one verifier child; no Worker, helper process, browser host alias, second builder, C, Rust, or new FFI boundary remains."
  - "The .shared-deps runtime owner, isolated capability publication, prebound readiness, materialization, and launch proof consume one immutable 11-package manifest contract."
  - "Every required package manifest is nonempty with its exact name and a nonempty installed version; an incomplete install never publishes a ready stamp."
  - "Runtime resolution does not cache a missing-tree fallback, and the production sentinel provides no dependencyModules or compiler-source override."
  - "Managed Git hook generations bind canonical commands to the installed Bun process.execPath; internal gate worktrees disable checkout hooks and enable long-path materialization."
  - "Observed-process preserves separate root-exit, Job-settlement, final-drain, and bounded cleanup evidence and fails closed at its deadline."
  - "V7 executes residual fast, the three deterministic SM-3 siblings, and one explicit production delta without calling the legacy aggregate, Playwright, AppContainer, Full, or all-slow."
  - "SM3-A through SM3-D and the single coordinator integration obligations are complete; Workbench, Task Envelope, and AI consumers remain outside this package."
  - "AppContainer remains optional hardening with capabilityComplete false and no malicious-code or network-sandbox claim."
---

# SM-3 P0 Local Isolated Runner / Exit Closure V2

本冻结包把 SM-3 最终 exit tree 绑定到 base-owned `sm3-p0-local-isolated-runner-v1` Evidence V3 policy。产品路径保持 TypeScript / Bun：host 内唯一 `Bun.build()`、一个 verifier child、Verification-owned one-shot proof、single coordinator、bounded observed-process settlement；没有 C、Rust、新 FFI、Worker、第二 builder、Playwright 或 AppContainer 产品依赖。

import/runtime 由一个共享协议闭合：`.shared-deps` 持有唯一 runtime tree，11 个 package manifest 的完整性合同贯穿 install、capability、prebound readiness、materialize 与 launch。Git lifecycle hook 的部署 generation 绑定安装时 Bun identity；gate 的内部 detached worktree 不执行产品 hook，并固定 Git long-path 行为。由此依赖完整性、runtime launch 与 snapshot materialization 不再由 PATH、临时目录深度或 fixture override 决定。

V7 hosted verification 只按 base policy 运行 residual fast、三个 deterministic sibling 和一个 production delta。它不运行 legacy `test:affected` aggregate，不安装或执行 Playwright，不运行 AppContainer、Full 或 all-slow。最终路线图与 evidence 只在该 exact implementation tree 上完成退出裁决，并继续保留 `capabilityComplete:false`。
