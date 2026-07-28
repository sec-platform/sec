---
schema: codex-development-work-package-v1
id: isolated-runtime-bundle-layout-v1
tracking: none
base: f17202dd0c076279e9ab115c722a87856c1cd42f
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v17
tasks:
  - id: freeze-isolated-bundle-layout-and-control-plane
    owner: a0
    ownedPaths:
      - docs/13-独立工具分发与打包规划.md
      - docs/archive/work-packages/merge-gate-changed-record-identity-v1.md
      - docs/archive/work-packages/runtime-authority-and-package-layout-v1.md
      - docs/work-packages/isolated-runtime-bundle-layout-v1.md
      - docs/work-packages/merge-gate-changed-record-identity-v1.md
      - docs/work-packages/runtime-authority-and-package-layout-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
  - id: implement-isolated-bundle-layout
    owner: isolated-runtime-layout-worker
    ownedPaths:
      - platform/compiler/semantic-mutation/isolated-verification-child-progress.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - tests/contract/repository-runtime.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - docs/14-Engineering IR与语义事实规范.md
  - package.json
  - platform/cli/
  - platform/orchestrator/
  - platform/shared/ci-evidence-composition-policy-registry.ts
  - platform/shared/runtime-layout.ts
  - platform/shared/test-impact-contract.ts
  - platform/shared/test-impact-rules/
  - platform/shared/workspace-write-lease.ts
  - scripts/codex/
acceptance:
  - "The isolated compiler package reuses the canonical bundle profile: package root .isolated-compiler, executable module .isolated-compiler/dist/index.js, runtime assets .isolated-compiler/dist/platform/**, and package metadata/dependencies at the package root."
  - "Bootstrap and staged loader remain verification-owned launch boundaries rather than runtime-layout authorities; the loader derives its core import from the canonical loader and runner paths without cwd, environment, ancestor search, global registration, or a third resolver mode."
  - "All compiler runtime resource destinations continue to derive from COMPILER_RUNTIME_RESOURCE_POSIX_PATHS and add exactly one bundle asset-root prefix; compilerRegistryInputs consumes SEMANTIC_MUTATION_ISOLATED_COMPILER_RESOURCE_DESTINATIONS.officialRegistry instead of rebuilding the registry destination from the package root, and no consumer spells registry, policy, or template destinations independently."
  - "Bundled dependency relocation derives the relative node_modules URL from SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH and SEMANTIC_MUTATION_ISOLATED_COMPILER_DEPS_RELATIVE_ROOT; it cannot retain the old ../../node_modules assumption from the retired platform/orchestrator core location."
  - "The exact main reproduction that exits with loader-import-failure code 75 becomes green, while the Playwright target-swap sentinel still rejects the swap before spawn."
  - "Source and public bundle runtime-layout negative contracts remain unchanged and unknown executable module locations continue to fail closed."
  - "The historical SM3 P0 one-shot evidence policy is not rewritten or reused: exact main no longer matches its legacy base-blob transition, so this package follows the ordinary V1 quick profile."
  - "No package metadata, dependency version, Node support claim, workspace lease behavior, public CLI graph, CI trust root, or generated target profile changes."
  - "All base-to-candidate changed records have exactly one owner and no forbidden intersection; focused, typecheck, docs, repository audit, imports, affected, independent Review, hosted Gate, and main readback evidence bind the final exact head."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts --test-name-pattern '^(canonical isolated runtime inputs keep compiler-owned sources under one authority|staged verify-all runner rejects a Playwright target swap before spawn)$' --timeout 180000"
  - "bun test tests/unit/runtime-layout.test.ts tests/contract/repository-runtime.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run audit:repository"
  - "bun run check:affected --plan"
  - "bun run imports:freeze"
---

# 隔离运行时复用标准 Bundle 布局 V1

`main@f17202d` 已建立唯一 source/bundle runtime layout owner，并完成 changed-record identity 的 merge-gate trust-root bootstrap；但 Semantic Mutation 的隔离物化仍把 bundled runner 放在 `.isolated-compiler/platform/orchestrator/*.mjs`，使 bundle 内的 `runtime-layout.ts` 在 module 初始化时看到未知 executable layout，并以 `RUNTIME-LAYOUT-001` 失败；staged loader 将其折叠为退出码 `75`。本包只修正这个已有主干回归：隔离包物理复用标准 bundle 形状，不扩展 resolver、不迁移依赖 authority，也不吸收 workspace lease、反馈闭环或 active corpus 分支的其他变化。

首次 candidate 修复了 executable 与通用 runtime asset destination，但最终 affected 暴露 production `compilerRegistryInputs()` 仍把 official registry 物化到旧 source 形状 `.isolated-compiler/platform/registry/official`，而 bundle lookup 只读取 `.isolated-compiler/dist/platform/registry/official`。该同根因二次失效触发 `STOP_PROOF_RESET`；随后保留 staging 的一次性物化与 diagnostic bundle 进一步证明 registry 已到达 canonical lookup，剩余失败来自旧 `../../node_modules` relocation：它从新 core `dist/index.js` 指向 staging root 而不是 package root，导致 TypeScript 标准库全部缺失。此次 redesign 把 registry、core、runtime assets 与 dependency root 一并收敛到 bundle profile 的 canonical identities，并以 source contract 禁止两种旧拼接恢复。
