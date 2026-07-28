---
schema: codex-development-work-package-v1
id: runtime-authority-and-package-layout-v1
tracking: issue-167
base: 2513f640c91eafbe6eaecd1d33227fbfa59da11c
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v17
tasks:
  - id: freeze-runtime-authority-and-control-plane
    owner: a0
    ownedPaths:
      - docs/00-文档索引与一致性规则.md
      - docs/02-工程编译器-MVP-PRD与架构稿.md
      - docs/05-编译器核心实现规格.md
      - docs/13-独立工具分发与打包规划.md
      - docs/archive/work-packages/repository-audit-trust-root-closure-v2.md
      - docs/work-packages/repository-audit-trust-root-closure-v2.md
      - docs/work-packages/runtime-authority-and-package-layout-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
  - id: implement-runtime-authority-and-layout
    owner: runtime-authority-trust-root-worker
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - platform/compiler/compose/template-engine.ts
      - platform/compiler/emit/write-local-views.ts
      - platform/compiler/parse/load-policy-declarations.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/orchestrator/workbench-server-v2.ts
      - platform/orchestrator/workspace-orchestrator.ts
      - platform/shared/paths.ts
      - platform/shared/runtime-authority.ts
      - platform/shared/runtime-layout.ts
      - scripts/build-release.ts
      - scripts/codex/merge-gate.ts
      - tests/contract/repository-runtime.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/unit/heavy-verification-gate-lease.test.ts
      - tests/unit/runtime-authority.test.ts
      - tests/unit/runtime-layout.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/unit/workbench-server.test.ts
forbiddenPaths:
  - bun.lock
  - docs/scripts/docs-doctor.ts
  - package.json
  - platform/cli/
  - platform/dev-runner.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/project-runtime.ts
  - platform/shared/test-impact-contract.ts
  - platform/shared/test-impact-rules/
  - platform/shared/workspace-write-lease.ts
  - scripts/publish-public.ts
acceptance:
  - "One active Chinese authority separates runtime-neutral Semantic Core, Host Runtime, Toolchain Provider, generated Target Runtime Profile, optional capabilities, and host Evidence without claiming Node support."
  - "The current public baseline decision remains minimum Node 22 and reference Node 24 after an official release-schedule read on 2026-07-28; Bun 1.3.14 remains the independent repository Toolchain Provider."
  - "Runtime contracts keep Host Runtime identity, Toolchain Provider identity, canonical Target Runtime Profile, and execution Evidence as distinct typed axes; no contract infers Bun toolchain identity from process.execPath."
  - "Package root, dependency root, bundled executable path, runtime asset root, and development-only source root have one fail-closed layout resolver for source and bundled package modes."
  - "Official registry, policy, compose-template, and local-view-template consumers resolve from runtime asset root, while package metadata, dependencies, cache, and toolchain state remain rooted at the package root."
  - "One runtime resource inventory owns native relative paths, derived POSIX identities, source/bundle absolute roots, and every default isolated staging destination; production consumers cannot spell the four resource roots independently."
  - "The release builder copies the complete canonical runtime resource inventory from repository source root to runtime asset root without maintaining a second resource list."
  - "The release builder consumes the shared layout contract for dist/index.js and dist/platform assets; package.json remains unchanged and no engines or Node support declaration is added."
  - "Because paths.ts is verifier trust root, runtime-layout.ts becomes an explicit canonical trust file and both trusted workflow trustFiles projections match the base-side registry exactly."
  - "The candidate cannot authorize itself: existing hosted verification must return manual-bootstrap-required, while trusted-base parser/TCB evidence and independent exact-head Review authorize only an admin/manual integration."
  - "The pre-existing heavy-gate sentinel locates the generic dependency bootstrap after the test:affected lease without mistaking check:affected's injected preparation callback for that bootstrap; platform/dev-runner.ts remains unchanged."
  - "Focused negative tests reject unknown module layout, invalid runtime identities, incomplete target profiles, and accidental coupling of Node Host to Bun Toolchain."
  - "Workbench transport, atomic workspace lease, compiler dependency execution, generated project profiles, publication, CI matrix, and optional native adapters remain unchanged and explicitly deferred to their dependent Work Packages."
  - "All base-to-candidate changed records have exactly one owner and no forbidden intersection; final evidence distinguishes implemented layout authority from deferred Node 22/24 clean-package smoke."
tests:
  - "bun test tests/unit/runtime-authority.test.ts tests/unit/runtime-layout.test.ts tests/contract/repository-runtime.test.ts --timeout 180000"
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts --test-name-pattern 'canonical isolated runtime inputs keep compiler-owned sources under one authority' --timeout 180000"
  - "bun test tests/unit/workbench-server.test.ts --timeout 180000"
  - "bun test tests/unit/heavy-verification-gate-lease.test.ts tests/contract/sec-merge-gate.test.ts --timeout 180000"
  - "bun test tests/contract/document-control-plane-lifecycle.test.ts --test-name-pattern '^(shared resolver fails closed|real Git lifecycle resolves)' --timeout 180000"
  - "bun test tests/unit/codex-work-package-contract.test.ts --test-name-pattern '^(frozen Work Package V1|Work Package ownership)' --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run audit:repository"
  - "bun run check:affected --plan"
  - "bun run imports:freeze"
---

# Runtime 权威与包布局 V1

本包只闭合 Issue #167 的第一个可审查纵向切片：把 Semantic Core、Host Runtime、Toolchain Provider、Target Runtime Profile 与 host Evidence 分成独立合同，并让源码执行和 `dist/index.js` 单文件包执行共享一个显式 package/runtime layout owner。

`platform/shared/paths.ts` 属 verifier trust root，因此 layout owner 的接入必须在同一 candidate 内登记 `runtime-layout.ts` 并同步受信 workflow 投影；该 delta 只能由 trusted base Evidence、独立 Review 与 admin/manual bootstrap 集成，进入新 `main` 后立即返回 `TASK_RESTART_REQUIRED`。原子 workspace lease 仍是 Node 可变路径的真实阻塞，因此保留为紧随其后的严格前置包。Workbench 只迁移 official catalog 的 runtime asset locator，transport 保持不变；本包不得修改 lease、compiler dependency executor、生成目标投影或发布/CI 矩阵，也不得把类型、文档、`target: node` 或 Bun 下的 bundle 成功写成 Node 支持。

该包已由 PR #172 进入 `main@a2f4463ab94c12346134a46ee3ae0ff4a16082a8`，现作为历史 frozen manifest 归档。
