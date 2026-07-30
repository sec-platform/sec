---
schema: codex-development-work-package-v1
id: dev-loop-speed-v2
tracking: none
base: 7b46604e212d64b0aa8288cda86f5be3fd9cf138
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: eliminate-cold-start-overhead
    owner: cold-start-worker
    ownedPaths:
      - platform/shared/project-runtime.ts
      - platform/shared/config-cache.ts
      - platform/dev-runner.ts
      - platform/dev-runner/import-organizer.ts
      - tests/unit/project-runtime-stamp.test.ts
      - tests/contract/project-runtime-contract.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - scripts/codex/sec-merge-bootstrap.ts
      - tests/unit/sec-merge-bootstrap.test.ts
  - id: harden-test-infrastructure
    owner: test-infra-worker
    ownedPaths:
      - tests/testkit/workspace.ts
      - tests/testkit/workspace-cleanup.ts
      - tests/setup/runtime-deps.setup.ts
      - platform/shared/test-impact-contract.ts
      - platform/dev-runner/env-manager.ts
      - tests/unit/test-impact-cache.test.ts
  - id: parallelize-compiler-pipeline
    owner: compiler-pipeline-worker
    ownedPaths:
      - platform/compiler/codegen/code-builder.ts
      - platform/compiler/parse/manifest-cache.ts
      - platform/compiler/parse/load-manifest.ts
      - platform/compiler/resolve/resolve-graph.ts
      - platform/compiler/compose/compose-project.ts
      - platform/compiler/compose/microservice-lower-pass.ts
      - platform/compiler/compose/format-output-files.ts
      - platform/compiler/compose/generate-runtime-host.ts
      - platform/compiler/compose/install-opaque-modules.ts
      - platform/compiler/compose/map-custom-routes.ts
      - platform/compiler/compose/frontend-stitching.ts
      - platform/compiler/compose/merge-tailwind-theme.ts
      - platform/compiler/verify/build-acceptance-coverage.ts
      - platform/compiler/emit/runtime-attribution.ts
      - platform/compiler/emit/write-explain-graph.ts
      - platform/compiler/emit/write-review-summary.ts
      - platform/compiler/emit/templates/vertical-summary.ejs
      - platform/orchestrator/semantic-orchestrator.ts
      - platform/shared/fs.ts
      - tests/unit/code-builder-shared-project.test.ts
      - tests/unit/manifest-cache-activation.test.ts
  - id: parallelize-check-fast-stages
    owner: check-fast-worker
    ownedPaths:
      - platform/dev-runner/check-runner.ts
      - platform/shared/heavy-verification-gate-lease.ts
      - tests/contract/dev-runner-contract.test.ts
  - id: optimize-affected-tests
    owner: affected-tests-worker
    ownedPaths:
      - platform/shared/affected-test-inventory.ts
      - platform/shared/ci-pr-risk-selection.ts
      - platform/dev-runner/test-runner.ts
      - tests/unit/affected-test-selection.test.ts
      - tests/unit/local-gate-union.test.ts
forbiddenPaths:
  - bun.lock
  - scripts/codex/work-package-contract.ts
  - scripts/codex/parallel-work-package-contract.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/ci-verification.ts
  - scripts/ci-pr-risk.ts
  - .github/workflows/
  - platform/shared/contract-freeze-contract.ts
  - platform/shared/ci-verification-revision.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/ci-contract.ts
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-evidence-reuse-contract.ts
  - platform/shared/ci-evidence-composition-policy-registry.ts
  - platform/shared/ci-git-changed-files.ts
  - docs/work/active-work-package.md
  - docs/work/current-state.yaml
  - docs/work/rolling-plan.md
  - docs/work-packages/dev-loop-speed-v1.md
  - docs/work-packages/ci-merge-gate-speed-v1.md
  - tests/e2e/
acceptance:
  - "platform/shared/project-runtime.ts ensureCompilerDepsReady short-circuits via a stamp file keyed on stat(package.json).mtimeMs + stat(bun.lock).mtimeMs, skipping N package.json reads and 4 entry SHA-256 hashes when stamp matches."
  - "platform/dev-runner.ts no longer calls reenterWithResolvedDependencies when deps were just installed; the current process continues with the resolved nodeModulesPath."
  - "platform/dev-runner/import-organizer.ts workingTreeTypeScriptTargets uses a single git status --porcelain=v1 -z + git diff --name-only -z call instead of 4 independent spawnSync calls."
  - "platform/shared/config-cache.ts exports a ConfigCache module that caches parsed JSON/YAML results keyed on stat mtimeMs+size, used by project-runtime.ts and import-organizer.ts."
  - "tests/testkit/workspace.ts cloneWorkspaceTemplate uses hard links (fs.link) or a process-internal workspace pool with refcount for read-only tests, reducing per-test fs.cp recursive copy overhead."
  - "tests/testkit/workspace-cleanup.ts retryDelaysMs uses exponential backoff with jitter [50,100,200,400,800] instead of fixed [100,200,300,400,500], and tests/testkit/workspace.ts deferredCleanupConcurrency uses createConcurrencyLimit(min(availableParallelism,16)) instead of hardcoded 4."
  - "tests/setup/runtime-deps.setup.ts preload no longer calls cleanStaleWorkspaces; cleanup is performed once by runFastTests before spawning shards."
  - "platform/shared/test-impact-contract.ts persists testImportSpecifiersCache to .tmp/test-impact-cache.json keyed on testFile+stat.mtimeMs, surviving across processes."
  - "platform/compiler/codegen/code-builder.ts accepts an optional shared ts-morph Project via constructor option or a module-level getDefaultProject() singleton, eliminating 40-75 Project instantiations per compile."
  - "platform/compiler/parse/manifest-cache.ts manifestCache is imported and used by loadManifestById and loadManifestForResolvedBlock, eliminating 4-5x redundant manifest reads per compile."
  - "platform/compiler/compose/microservice-lower-pass.ts, install-opaque-modules.ts, generate-runtime-host.ts, map-custom-routes.ts use Promise.all with createConcurrencyLimit for independent I/O instead of serial for-await loops."
  - "platform/compiler/compose/format-output-files.ts resolves prettier config once outside the loop instead of per-file."
  - "platform/compiler/compose/generate-runtime-host.ts generateRuntimeHostScaffold reuses entries from scaffoldEntries instead of calling it twice."
  - "platform/dev-runner/check-runner.ts runFastCheck runs docs:doctor in parallel with typecheck (not just with imports:prepare), reducing wall time by max(docs-doctor, typecheck) - docs-doctor."
  - "platform/shared/heavy-verification-gate-lease.ts supports per-namespace leases so test:fast and test:affected can run concurrently when they use different workspace namespaces."
  - "platform/shared/affected-test-inventory.ts builds a reverse-import-map (source-file -> test-files) once per run instead of O(changed × tests) linear scan per changed file."
  - "platform/dev-runner/test-runner.ts runAffectedTestPlan reuses plan.selectionResolved instead of recomputing affectedTestSelection."
  - "All focused contracts, typecheck, docs doctor, repository audit pass on one single-parent candidate."
tests:
  - tests/unit/project-runtime-stamp.test.ts
  - tests/unit/test-impact-cache.test.ts
  - tests/unit/code-builder-shared-project.test.ts
  - tests/unit/manifest-cache-activation.test.ts
  - tests/unit/affected-test-selection.test.ts
  - tests/contract/project-runtime-contract.test.ts
  - tests/contract/dev-runner-contract.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/contract/sandbox-architecture-contract.test.ts
---

# Development Loop Speed v2

## 背景

`dev-loop-speed-v1`（PR #202）解决了测试并行化、check:fast gate 并行化、docs:doctor 增量模式、CI 缓存优化和 preload marker 优化。全工程速度审计（4 个并行 agent，64 个瓶颈）发现本地开发循环仍有显著冷启动开销、测试基础设施冗余 I/O、编译器管线串行化等问题。

本 Work Package 系统性消除本地开发反馈循环中剩余的高影响瓶颈，覆盖 5 个 Slice：冷启动消除、测试基础设施加固、编译器管线并行化、check:fast 阶段并行化、affected-tests 优化。

## 实现

### Slice 1 — 冷启动消除

1. `project-runtime.ts`：`ensureCompilerDepsReady` 增加基于 `stat(package.json).mtimeMs + stat(bun.lock).mtimeMs` 的 stamp 文件（`.tmp/compiler-deps.stamp.json`），stamp 匹配时直接返回上次缓存的 `CompilerDepsReadyState`，跳过 N 次 package.json 读取和 4 次 entry SHA-256 哈希。
2. `dev-runner.ts`：移除 `reenterWithResolvedDependencies`，deps 安装后当前进程直接使用新 `nodeModulesPath` 继续，避免双倍 bun 启动 + manifest hash。
3. `import-organizer.ts`：`workingTreeTypeScriptTargets` 将 4 次 `spawnSync` 合并为 1 次 `git status --porcelain=v1 -z` + 1 次 `git diff --name-only -z HEAD`，从 porcelain 输出一次性推导 staged/unstaged/untracked。
4. `config-cache.ts`（新文件）：导出 `ConfigCache` 模块，基于 `stat(filePath).mtimeMs + stat(filePath).size` 缓存 JSON/YAML 解析结果，供 `project-runtime.ts` 和 `import-organizer.ts` 使用。

### Slice 2 — 测试基础设施加固

1. `workspace.ts`：`cloneWorkspaceTemplate` 改为硬链接（`fs.link`）或 process-internal workspace pool（同 kind 模板对只读测试复用，refcount 跟踪生命周期），减少 per-test `fs.cp` 递归复制。
2. `workspace-cleanup.ts`：`retryDelaysMs` 改为指数退避 + 抖动 `[50,100,200,400,800]`；`workspace.ts`：`deferredCleanupConcurrency` 改为 `createConcurrencyLimit(min(availableParallelism,16))`。
3. `runtime-deps.setup.ts`：preload 不再调用 `cleanStaleWorkspaces`，改为 `runFastTests` 启动时单次调用。
4. `test-impact-contract.ts`：`testImportSpecifiersCache` 持久化到 `.tmp/test-impact-cache.json`，key 为 `testFile + stat.mtimeMs`，跨进程复用。

### Slice 3 — 编译器管线并行化

1. `code-builder.ts`：`CodeBuilder` 构造接受可选的共享 `ts-morph Project`，或通过 `getDefaultProject()` 懒加载单例，消除 40-75 次 Project 实例化。
2. `manifest-cache.ts` + `resolve-graph.ts` + `build-acceptance-coverage.ts` + `runtime-attribution.ts`：激活 `manifestCache`，所有 `loadManifest*` 调用优先查询缓存，消除 4-5x 冗余 manifest I/O。
3. `microservice-lower-pass.ts` + `install-opaque-modules.ts` + `generate-runtime-host.ts` + `map-custom-routes.ts`：将 `for-await` 串行循环改为 `Promise.all` + `createConcurrencyLimit` 并行化独立 I/O。
4. `format-output-files.ts`：在循环外一次性 `prettier.resolveConfig(projectRoot)`，传入每次 `prettier.format` 调用。
5. `generate-runtime-host.ts`：`generateRuntimeHostScaffold` 复用已计算的 `entries`，直接 `return uniqueSorted([...BASE_RUNTIME_SCAFFOLD_PATHS, ...entries.map(e => e.relativePath)])`，消除 `scaffoldEntries` 重复渲染。
6. `fs.ts`：`writeText`/`writeJson` 增加进程内 `Set<string>` 缓存已创建的目录，避免重复 `mkdir`；`copyRecursive` 改为 `Promise.all` + `defaultLimit` 并行化。
7. `resolve-graph.ts`：将 `for...of` + `await` 串行 manifest 加载改为 `Promise.all`。
8. `frontend-stitching.ts`：`applyPrefixSandboxing` 创建单一 `Project` 处理所有 .tsx/.jsx 文件。
9. `merge-tailwind-theme.ts`：补上 `skipLoadingLibFiles: true, skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true`。
10. `runtime-attribution.ts`：改为异步 `fs.promises` API + 接入 `manifestCache`。

### Slice 4 — check:fast 阶段并行化

1. `check-runner.ts`：`runFastCheck` 将 `docs:doctor` 移到与 `typecheck` 并行的分支（无数据依赖），减少 wall time。
2. `heavy-verification-gate-lease.ts`：支持 per-namespace lease，`test:fast` 和 `test:affected` 使用不同 namespace 时不互相阻塞。
3. `check-runner.ts`：提前申请 heavy-verification-gate lease（在 typecheck 进行时排队获取）。

### Slice 5 — affected-tests 优化

1. `affected-test-inventory.ts`：构建一次 reverse-import-map（source-file -> test-files），将 `testsReferencingSources` 从 O(changed × tests) 降为 O(tests) 一次性 + O(changed) 查询。
2. `ci-pr-risk-selection.ts`：先一次性调用 `CodexDevelopmentBuildAffectedTestInventoryV1(files, provider)` 获取整体 impact，避免逐文件重算。
3. `test-runner.ts`：`runAffectedTestPlan` 复用 `plan.selectionResolved`，不重算 `affectedTestSelection`。

## 退出

single-parent current-main candidate；focused/typecheck/docs/audit/imports/affected、Review 与 Full Evidence 闭合；merge 后从新 `main` readback。
