---
schema: codex-development-work-package-v1
id: test-runtime-browser-cache-v10-bootstrap-v2
tracking: issue-132
base: 8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v10
tasks:
  - id: canonical-test-browser-cache-materialization
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/03-MVP实施计划与路线图.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/05-编译器核心实现规格.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/test-runtime-browser-cache-v10-bootstrap-v1.md
      - docs/work-packages/test-runtime-browser-cache-v10-bootstrap-v2.md
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/dev-runner/dependency-bootstrap.ts
      - platform/dev-runner/test-runner.ts
      - platform/shared/ci-verification-plan.ts
      - platform/shared/dependency-environment.ts
      - platform/shared/project-runtime.ts
      - scripts/codex/merge-gate.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/integration/project-runtime.test.ts
      - tests/setup/runtime-deps.setup.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-evidence-reuse-contract.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tests/unit/dependency-environment.test.ts
      - tests/unit/dev-runner-dependency-bootstrap.test.ts
      - tests/unit/playwright-browser-cache.test.ts
      - tests/unit/runtime-verification.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/unit/test-runner.test.ts
forbiddenPaths:
  - .gitattributes
  - .githooks/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/goals/
  - docs/14-Engineering IR与语义事实规范.md
  - platform/cli/
  - platform/server/
  - platform/orchestrator/
  - platform/compiler/semantic-mutation/
  - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
  - platform/shared/process.ts
  - platform/shared/windows-appcontainer-executor.ts
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - tests/e2e/
  - tests/fixtures/
  - tests/integration/semantic-mutation-apply.test.ts
acceptance:
  - "One explicit external-Node authority is owned by project-runtime: it physically resolves the selected executable, actually runs that same absolute path, rejects Bun compatibility metadata, non-Node identity, Node below 22, an unexecutable candidate, or reported execPath drift before any install lock/download, and returns one immutable path/version binding consumed by browser bootstrap and dependency doctor."
  - "The project-local Playwright registry is invoked with that verified Node and executablePath() to derive the current Chromium headless-shell path without requiring it to exist; registry/require/runtime nonzero, malformed output, cache escape, or physical-path failure is terminal RUNTIME-DEPS-005. Before lock acquisition and again under the lock immediately before installer spawn, every existing component from the dependency root through the selected executable must be a correctly typed non-reparse path whose realpath equals the expected worktree-local physical path; only the first genuinely absent component after that proof is a cold-install condition."
  - "The materializer serializes concurrent cold callers with the existing runtime dependency install-lock authority, performs at most one install, reuses only a warm exact executable identity physically contained by the canonical cache, clears inherited NODE_OPTIONS/NODE_PATH/PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, invokes only the exact project-local Playwright CLI for chromium with the same verified Node, and re-probes the same registry identity before publishing readiness."
  - "The dedicated browser lock wait is abort-aware without changing the CRITICAL shared withInstallLock implementation; installer process execution continues to honor the same AbortSignal and lock cleanup/retry contract."
  - "ensureTestDependencies is the single test sequencing owner for compiler dependencies plus browser cache and never installs Git hooks; the common runner completes it once before any concurrent/serial Bun child, overwrites every child PLAYWRIGHT_BROWSERS_PATH, and marks every managed child to skip only the redundant preload. Direct Bun preload consumes the same composition and overwrites poisoned ambient cache state."
  - "Non-isolated runtime verification delegates browser installation to the same materializer; the isolated capability probe remains read-only/fail-closed and never downloads, copies from a global cache, weakens descriptor/reparse/hash proofs, or hides an unavailable capability."
  - "The isolated runtime source-snapshot cache is keyed by the complete structural authority identity rather than the transient JavaScript object identity of an equivalent sources wrapper. Distinct frozen wrappers with the same canonical paths, browser cache, registry destinations, runner bytes, and generated inputs share one bounded cache slot/single flight; any structural key delta selects a different slot."
  - "Every structural snapshot reuse still performs the existing root, directory-child-set, and file-identity revalidation before issuance; capture-time raw hashes, materialization-time source identity checks, destination raw-hash manifest, reparse/hardlink rejection, staging binding, and pre-launch manifest proof remain unchanged. Cache buckets and snapshots are explicitly bounded and active flights are never evicted."
  - "One explicit opt-in pre-child sentinel uses three default production capability probes with fresh canonical source wrappers, then exactly one materialization and one launch proof. It records only path-free cache counters, file/byte totals and phase durations; it proves one capture, two revalidations, one retained slot, zero flights, zero compile/test/browser phases, and zero child outcome/progress without invoking the supervisor or isolated child."
  - "A clean hosted Ubuntu checkout can reach the canonical .shared-deps/.playwright-browsers authority through its existing Node runtime and test execution path after bun install; absence of a physical Node runtime fails closed, and no workflow-only adapter, cache action, mutable external artifact, custom downloader, or pre-provisioned browser assumption is introduced."
  - "V1 revision and artifact namespace advance exactly from ci-verification-v9 to ci-verification-v10 because platform/dev-runner and project-runtime are verifier trust roots; Evidence V2 schema, selector, Gate IDs/order/argv, permissions, dispatch event, retention, trust-root set, merge eligibility, and V2 composition revision ci-verification-v7 remain unchanged."
  - "v9 manifest/evidence/artifact/status cannot satisfy the v10 gate, and this trust-root candidate never dispatches hosted Scope, Quick, Risk, Full, or release to self-certify; integration authority is frozen local exact-head evidence, independent architecture/evidence review, and manual bootstrap."
  - "The prior SM-4A aggregate missing-cache failure and scan-contaminated exact timeout remain preserved as non-PASS evidence; after this prerequisite enters main, SM-4A is replayed on the new base and runs one new-head canonical aggregate rather than composing or relabeling those attempts."
  - "The exact candidate diff contains only the owned paths, introduces no network activity inside tests after successful pre-fanout materialization, and leaves the tracked worktree clean of browser/runtime artifacts."
tests:
  - "browser-cache/direct-preload-focused: bun test tests/unit/playwright-browser-cache.test.ts tests/unit/dependency-environment.test.ts tests/unit/dev-runner-dependency-bootstrap.test.ts tests/unit/runtime-verification.test.ts --timeout 180000"
  - "browser-cache/managed-runner-focused: bun test tests/unit/test-runner.test.ts --timeout 180000"
  - "runtime-snapshot/structural-cache-focused: bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts -t 'runtime source snapshot cache' --timeout 180000"
  - "runtime-snapshot/real-cache-phase-sentinel: SEC_RUN_SM3_RUNTIME_SOURCE_PHASE_SENTINEL=1 bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts -t 'runtime source snapshot cache reuses real canonical authority across fresh wrappers before child' --timeout 300000"
  - "v10-bootstrap/policy-focused: bun test tests/contract/sec-merge-gate.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-evidence-reuse-contract.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts tests/unit/codex-work-package-contract.test.ts --timeout 180000"
  - "affected-tests: SEC_AFFECTED_TESTS_BASE=8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2 bun run test:affected"
  - "impact-risk: SEC_CHANGED_BASE=8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2 bun scripts/ci-pr-risk.ts"
  - "typecheck: bun run typecheck"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2 bun run imports:check"
  - "architecture/depcruise: bun run depcruise"
  - "docs-doctor: bun run docs:doctor"
  - "manifest-scope: verify exact owned paths, forbidden paths, and both active manifest pointers"
  - "patch-whitespace: git diff --check 8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2 HEAD --"
  - "gitnexus/compare: detect_changes scope compare against 8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2"
---

# TEST-H2 Runtime Browser Cache V10 Bootstrap V2

## Architectural goal

`main@8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2` 已通过 TEST-H1 把 canonical fast timeout 与 V1 revision 推进到 v9。随后 SM-4A ingress 的 exact-head affected aggregate 证明一个更早的运行前置仍未闭合：Semantic Mutation isolated runtime 只接受 worktree-local `.shared-deps/.playwright-browsers`，而 test runner、direct `bun test` preload 与 hosted Ubuntu workflow 都没有在进入测试前物化该 authority。缺失时 capability 按设计 fail closed；它不是 ingress 产品回归。

本包闭合 test/runtime dependency bootstrap，并吸收该实现首次 canonical affected 暴露的 snapshot reuse 前置。`platform/shared/project-runtime.ts` 作为既有 dependency authority owner增加唯一external-Node authority与browser-cache materializer：先实际执行并绑定一个Node 22+ physical executable，再由同一Node调用project-local Playwright registry区分fatal authority failure与cold cache，最后复用现有跨进程install lock。`dependency-environment.ts` 的doctor只消费同一Node authority，不再把Bun模拟的`process.versions.node`当作external runtime证明。common test runner在任何child fan-out前调用组合入口，direct Bun preload为绕过dev-runner的focused命令调用，现有non-isolated runtime verification也委托同一owner。

V1 candidate `528a78085fc5cb7ba51b162be9b128f88adc38d1` 的 canonical affected 在真实 cache 已物化后证明另一项前置：runtime source snapshot cache按临时 `sources` 对象身份分桶，而production每次probe重新创建等价冻结对象；同一测试的两次plan与apply replan因此可重复读取并哈希约675 MiB browser cache与370.73 MiB dependency tree。V2只在canonical runtime-plan owner中把外层identity改为完整结构化authority key并加总量有界/LRU；原有每次revalidation、raw hash、reparse/hardlink、materialization与launch proof不变。Mutation合同、orchestrator、isolated child、300秒测试合同与公共结果均不变。

## Prerequisite and observed evidence

- 上游 Goal 两份 Markdown 已全文读取，combined revision 为 `sha256:fbe08bd8dd24224b873619fa48746778eeb4357ddb5cd917d6ee45e45134f86d`。
- `origin/main` 为 `8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2` / tree `6e16ec68fa510cada4c304be5750e01a34bb1d15`；open PR 为零，Issue #132 仅作陈旧导航。
- SM-4A candidate `bca9102dc2a2bf865fff94b4e521383d8afac0ba` 的 focused/static gates已通过。canonical affected唯一真实 blocker首先是 revision 1217 browser cache缺失；物化后一次 exact-title尝试又与广域递归磁盘扫描重叠并在300秒超时，约307秒的 artifact-read 是 teardown 次生错误。两次都不是 admissible PASS。
- `docs/test-feedback-and-ci-lanes.md` 第195行禁止把后续 exact-title PASS冒充失败aggregate PASS；修复后必须在新exact head运行canonical aggregate。
- `.github/workflows/compiler-pr-validation.yml` 在 fresh `ubuntu-latest` 上只执行 `bun install --frozen-lockfile` 后进入 verification；Playwright不是 trusted lifecycle dependency，且没有任何 action/cache/install步骤物化 canonical worktree cache。因此 hosted viability 是真实 prerequisite，不允许由 ingress 包扩大 forbidden seam。
- Windows exact diagnostic证明同一Playwright CDN URL经curl与system Node 24返回redirect，但Bun 1.3.14的`fetch`和`node:https`稳定`ECONNREFUSED`；因此Playwright官方Node CLI不能绑定`process.execPath`所指向的Bun。初版resolver只检查PATH文件存在，且registry使用`executablePathOrDie()`把所有nonzero误分类为cold miss，架构复审判定NO-GO。本次重冻结要求project-runtime实际执行candidate并验证Node identity/version/execPath，再以非抛出`executablePath()`取得期望路径；任何registry failure在lock/download前fatal，不引入自定义下载实现或workflow特例。
- V1 exact-head affected在`300039.56ms`命中唯一primary timeout；其后`SEMANTIC-MUTATION-010`是同一已超时async body的迟到failed result，不是第二个被选测试。临时artifact已清理，具体failed lane不可恢复，不能伪造。相关SM fixture/runtime-plan/child/orchestrator blob在base与V1 head一致，raw fixture/EOL审查未发现确定性byte mismatch。
- Canonical browser tree为610 files / 707791179 bytes（675.0 MiB），dependency tree为10967 files / 388737526 bytes（370.73 MiB）。exact title顺序执行两次plan与一次apply replan；`runtimeSourceSnapshotsBySources`却按每次新建的sources对象身份分桶。该静态链是V2的根因修复目标；因失败workspace telemetry已删除，不把它写成V1 exact-run phase事实。
- V2 opt-in real-cache sentinel在当前working tree通过：三个default probes均`available`，cache delta为1 capture / 2 revalidations / 1 entry / 0 flights，已捕获snapshot为11979 files / 1158544347 bytes；capture为40660ms，两次revalidation分别为6081ms与6412ms，materialize为24804ms，launch proof为40429ms。summary保存在ignored `.tmp/runtime-browser-cache-v10-phase-attribution.json`，无absolute path、compile/next/unit/playwright event、child outcome或progress checkpoint。该结果仍不是frozen exact-head aggregate证据。

## Ownership, risk, and invariants

GitNexus把 `withTestDependencies` 评为 HIGH：4个直接调用并影响 affected、slow与Contract Freeze执行流程；`ensureCompilerDepsReady`同样为HIGH但本包不修改。现有 `ensurePlaywrightBrowser` 为LOW，direct preload owner为LOW。实现只能在 HIGH seam 增加一次 pre-fanout await，不改变其 callback、PATH、selection、argv、timeout或错误传播。

`project-runtime.ts` 已独占 compiler/shared dependency path、安装锁、孤儿锁回收与安装错误语义。新增materializer必须从该owner推导cache，实际执行并冻结同一external Node 22+ authority，使用project-local Playwright CLI与registry选择current revision/executable，复用现有`withInstallLock`，并在命令前后证明exact executable位于physical canonical cache。`dependency-environment.ts`只能向下消费该authority，禁止把resolver移入doctor形成cycle。不得新增第二锁算法、修改CRITICAL shared lock、修改HIGH `executableCheck()`、复制Playwright平台路径表、自建下载器、调用全局`playwright`、复制用户profile cache、信任仅目录存在、写tracked stamp或在capability probe里联网。

该包命中 verifier trust root，因此按 `docs/04` 必须推进 V1 revision/artifact namespace 到 v10并人工bootstrap。它不改变 Evidence V2/V3 schema、Gate集合、selector、timeout、workflow权限或composition v7。V1 manifest已因canonical affected证伪其“runtime snapshot不变”假设而停止；V2显式吸收唯一runtime-plan cache owner，但仍禁止orchestrator、isolated child、process lifecycle、Mutation合同、workflow专用下载及任何proof弱化。

## Gate ownership, reconciliation, and stop

A0 是全部 Gate 的唯一 `gate_owner`。新增structural-cache focused test与一次real-cache pre-child sentinel已经通过；V1 browser/runner/policy focused evidence只在intervening diff不触及其输入时复用。冻结新的单一candidate head后必须重新运行一次canonical affected aggregate；V1失败aggregate与任何exact-title结果永久只作诊断。affected通过后运行一次canonical Risk。Risk已经包含完整Contract Freeze、selector slow suites与workspace-fast，因此不得另跑独立Freeze；其后只运行typecheck、changed-only imports、dependency architecture、docs/scope/patch与GitNexus compare。不得运行hosted Scope/Quick/Full/release，也不得把预期 `manual-bootstrap-required` 当成失败或PASS。

Base/head/manifest、Goal、dependency path/lock owner、external Node/Playwright registry contract、test runner fan-out、snapshot structural key/revalidation/bounds、v10 revision/artifact、trust-root inventory、Nexus prerequisite或任何non-owned path变化都会使相关evidence失效并触发重算。若focused seam不能证明真实external Node、PATH/poisoned/incompatible/fatal-registry、pre-fanout single materialization与runtime delegation，structurally equal sources仍重复capture或structurally different sources错误复用，fresh hosted runner没有physical Node 22+ runtime，真实cache仍需workflow特例，canonical affected再次暴露实现失败，或任何修复必须弱化runtime proof，停止本包。人工集成后从新`main`重放ingress、更新其manifest/控制面并只在新exact head运行一次canonical affected。
