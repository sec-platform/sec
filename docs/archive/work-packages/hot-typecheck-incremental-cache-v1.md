---
schema: codex-development-work-package-v1
id: hot-typecheck-incremental-cache-v1
tracking: issue-132
base: bb04d53eb21efc70c4747968c7ba889fad55d114
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v13
tasks:
  - id: bind-typescript-native-incremental-cache-and-bootstrap-v13
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/test-architecture.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/hot-typecheck-incremental-cache-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/shared/ci-verification-plan.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tsconfig.json
forbiddenPaths:
  - .codex/
  - .githooks/
  - .gitignore
  - AGENTS.md
  - docs/00-文档索引与一致性规则.md
  - docs/01-用户能力模块化开发-主题整理稿.md
  - docs/02-工程编译器-MVP-PRD与架构稿.md
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/05-编译器核心实现规格.md
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
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - platform/shared/ci-verification-revision.ts
  - platform/shared/test-budget-contract.ts
  - platform/shared/test-impact-contract.ts
  - scripts/
  - tests/e2e/
  - tests/fixtures/
  - tests/integration/
acceptance:
  - "Root TypeScript config enables native incremental checking and writes its sole build-info cache to .tmp/typecheck/tsconfig.tsbuildinfo; .tmp remains derived and Git-ignored."
  - "TypeScript itself owns cache validity through compiler version, compiler options and per-source signatures. SEC does not parse, copy, publish, attest or promote tsbuildinfo as Evidence."
  - "A clean checkout or absent cache performs the same full noEmit strict typecheck; a valid warm cache reduces the unchanged hot run to a five-second target without changing diagnostics or exit status."
  - "A changed source cannot be hidden by the cache, and malformed/stale build info is safely rebuilt or fails closed; deleting .tmp/typecheck always restores the cold path."
  - "The V1 verifier revision advances atomically from ci-verification-v12/sec-verification-v12-* to ci-verification-v13/sec-verification-v13-* across trusted workflows, code and current fixtures. Historical frozen manifests remain unchanged and V2 composition stays ci-verification-v7."
  - "Because tsconfig and V1 verifier files are trust root, candidate-hosted Quick returns manual-bootstrap-required and cannot self-authorize. Integration requires independent exact-head architecture/evidence review and base-side/manual bootstrap."
  - "No custom cache daemon, background watcher, cache registry, cache parser, new test lane or second typecheck runner is introduced."
tests:
  - "v13-and-cache-contract: bun test tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/docs-doctor.test.ts tests/contract/sec-merge-gate.test.ts tests/unit/codex-work-package-contract.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts --timeout 180000"
  - "cold-typecheck: remove only verified D:/Project/sec/.tmp/typecheck, then bun run typecheck once"
  - "warm-typecheck: bun run typecheck once on unchanged source; target no more than 5 seconds on the current development machine"
  - "source-invalidation: introduce one temporary typed fixture error, confirm warm typecheck is nonzero, revert only that fixture, then confirm one repaired warm run"
  - "corrupt-cache: replace only the derived tsbuildinfo with malformed bytes, confirm typecheck does not false-pass and restores a valid cache or fails closed, then clean the derived probe"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=bb04d53eb21efc70c4747968c7ba889fad55d114 with bun run imports:check once on the frozen candidate"
  - "docs-doctor: bun run docs:doctor once"
  - "manual-bootstrap: independent exact-head architecture/evidence review plus base-side integration for the V13 trust-root transition"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check bb04d53eb21efc70c4747968c7ba889fad55d114 HEAD --"
---

# Hot Typecheck增量缓存与V13 Bootstrap

## 唯一结果

让日常重复typecheck从约14秒进入五秒目标，同时保持cold/hosted correctness不变。实现直接使用TypeScript原生incremental build info；缓存是可删除的性能提示，不是SEC事实、artifact或Evidence。

```text
clean/absent cache → full strict noEmit check → publish TypeScript build info
unchanged source   → TypeScript validates identity/signatures → incremental check
changed source     → changed graph重新检查 → diagnostics/exit status保持权威
stale/corrupt      → TypeScript重建或非零退出 → 删除derived cache恢复cold path
```

## Context Capsule

- Branch：`codex/hot-typecheck-incremental-cache-v1`
- Base：`main@bb04d53eb21efc70c4747968c7ba889fad55d114`
- Goal：`sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676`
- Proof：当前`bun run typecheck`约14.85秒；相同compiler/config加原生incremental参数后cold约14.01秒、unchanged warm约4.59秒。
- Authority：`tsconfig.json`拥有compiler cache选项；TypeScript拥有build-info格式和失效判断；`platform/dev-runner/typecheck-runner.ts`保持唯一runner且不修改。
- Trust boundary：`tsconfig.json`与V1 verification revision消费者均是verifier trust root，因此原子升级V13并走manual bootstrap；V2 composition revision保持V7。
- Gate owner：A0；开发中只运行cache/diagnostic focused probes，最终只冻结一个candidate。

## Reload if

- live `origin/main`不再是`bb04d53eb21efc70c4747968c7ba889fad55d114`。
- TypeScript、Bun、root tsconfig、V1/V2 revision authority或trust-root registry变化。
- 需要修改任一forbidden path，或需要自制cache schema/daemon/runner。
- PR head/base/state、CI、Review、unresolved thread或`REQUEST_CHANGES`变化。

## Stop

- warm typecheck不能稳定进入五秒目标，或cold diagnostics/exit status发生变化。
- changed source可被warm cache漏报，corrupt cache产生false PASS，或cache逃出Git-ignored `.tmp`。
- V13与artifact namespace不能原子同步，或V2 composition被意外升级。
- 同一candidate epoch发生第二次失效。
