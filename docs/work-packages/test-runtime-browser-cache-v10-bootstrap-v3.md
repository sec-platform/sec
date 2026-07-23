---
schema: codex-development-work-package-v1
id: test-runtime-browser-cache-v10-bootstrap-v3
tracking: issue-132
base: 8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v10
tasks:
  - id: runtime-browser-cache-and-acceptance-shell-closure
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/03-MVP实施计划与路线图.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/05-编译器核心实现规格.md
      - docs/evidence/test-runtime-isolated-failure-attribution-2026-07-23.json
      - docs/test-feedback-and-ci-lanes.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/test-runtime-browser-cache-v10-bootstrap-v1.md
      - docs/work-packages/test-runtime-browser-cache-v10-bootstrap-v2.md
      - docs/work-packages/test-runtime-browser-cache-v10-bootstrap-v3.md
      - docs/work-packages/test-runtime-isolated-failure-attribution-v1.md
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/dev-runner/dependency-bootstrap.ts
      - platform/dev-runner/test-runner.ts
      - platform/shared/ci-verification-plan.ts
      - platform/shared/dependency-environment.ts
      - platform/shared/project-base.ts
      - platform/shared/project-runtime.ts
      - scripts/codex/merge-gate.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/integration/project-runtime.test.ts
      - tests/integration/semantic-mutation-apply.test.ts
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
  - platform/compiler/compose/apply-overrides.ts
  - platform/compiler/parse/load-override-manifest.ts
  - platform/compiler/semantic-mutation/
  - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
  - platform/compiler/verify/runtime-verification-invocation-contract.ts
  - platform/shared/observed-process.ts
  - platform/shared/process.ts
  - platform/shared/runtime-dependency-spec.ts
  - platform/shared/windows-appcontainer-executor.ts
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - tests/e2e/
  - tests/fixtures/
  - tests/testkit/
acceptance:
  - "V3 absorbs the complete V2 browser-bootstrap and structural-snapshot candidate rather than running a second dependent landing package. All V2 external-Node, Playwright registry/cache, lock, pre-fanout, structural-key, revalidation, materialization, launch-proof, bounded-cache, v10 trust-root, and manual-bootstrap invariants remain required."
  - "The immutable de5f84e affected identity remains FAIL and Risk remains not run. TEST-H3 at b258517/f6dd49b proves fast passed, runtime build passed, runtime unit passed, and only runtime acceptance failed at customer-flow.spec.ts; child outcome is failed at verify-all/verify-runtime and the path-free error class is ENOENT uv_spawn cmd.exe. The unique retained workspace was validated, the evidence was committed, and the literal workspace was deleted with a zero-count proof."
  - "buildIsolatedProcessEnvironment remains byte-semantically unchanged. Isolated build and unit keep the generic empty-PATH environment. Only the acceptance Playwright CLI receives a controlled shell environment because its nested webServer and Windows cleanup execute through a shell. That environment never leaks to build, unit, compiler child, compose, or non-isolated verification."
  - "On POSIX, acceptance PATH contains only the physical directory of the exact running Bun executable and carries no ComSpec, PATHEXT, SystemRoot, SYSTEMROOT, or WINDIR. Bare bun must resolve before launch to the same physical executable as process.execPath."
  - "On Windows, acceptance PATH is exactly validated System32 followed by the physical Bun directory. ComSpec is exactly validated System32/cmd.exe, PATHEXT is exactly .EXE, and the environment contains one case-insensitive key for each authority. SystemRoot and WINDIR resolve to the same physical root. Relative, missing, conflicting, aliased, reparse, non-directory, or non-regular cmd.exe/taskkill.exe/Bun authorities fail closed before Playwright launch; a fake bun, cmd, or taskkill in the Bun directory cannot shadow System32 or process.execPath."
  - "The generated Playwright webServer command is built from bun, --no-env-file, --no-install, the project-local node_modules/next/dist/bin/next module, start, host, and port. Its cwd is exactly the generated project/config directory. When SEC_ISOLATED_VERIFICATION=1 it also includes --config=../.isolated-process/runtime/bunfig.toml; resolving that relative argument from the frozen cwd must equal the unique fixed config inside the staging workspace, otherwise launch fails closed before Playwright. The nested Bun process therefore cannot consume the overrideable project bunfig. It never uses .bin/next, bare next start, node, npx, bun run, an ambient package manager, a global Next installation, or a host PATH entry."
  - "Tests reconcile the generated Next module identity with RUNTIME_VERIFICATION_INVOCATION_CONTRACT.build.moduleRelativePath without adding a shared-to-compiler import. Runtime reports and durable evidence retain only the logical command label; absolute Bun, System32, ComSpec, config, or workspace paths never enter the public report schema."
  - "The temporary retain-on-callback-failure selector is removed from semantic-mutation-apply.test.ts before the landing candidate is frozen. The diagnostic evidence and manifests remain as audit records, but no retained workspace, raw log, absolute/repository path, environment value, source byte, or diagnostic-only behavior remains active."
  - "Focused tests prove generic empty PATH, acceptance-only controlled PATH, Windows and POSIX negative vectors, and the exact generated command. A new named integration sentinel, distinct from the old TEST-H3 title, asserts that project cwd plus the relative config argument resolves to the unique staging fixed config, then executes generated project -> isolated acceptance environment -> Playwright CLI -> webServer shell -> fixed isolated bunfig -> project-local Next -> reachable URL -> teardown and free port; on Windows it also rejects cmd.exe/taskkill lookup failure. The final affected aggregate may select this changed sentinel again as deliberate selector/end-to-end overlap, but no Gate identity or old exact title is rerun. Only an affected PASS permits one canonical Risk execution."
  - "The final exact base-to-head diff is limited to owned paths, contains no temporary probe or runtime artifact, preserves zero dependency cycles, and receives independent review for the ensureProjectBase blast radius. This trust-root candidate never dispatches hosted Scope, Quick, Risk, Full, or release to self-certify; landing uses frozen local evidence and manual bootstrap."
tests:
  - "runtime-acceptance-shell/focused-owner: bun test tests/unit/runtime-verification.test.ts --timeout 180000"
  - "project-base/runtime-command-focused: bun test tests/integration/project-runtime.test.ts -t 'project base emits the canonical isolated runtime acceptance webServer command' --timeout 180000"
  - "runtime-acceptance/real-shell-focused: bun test tests/integration/project-runtime.test.ts -t 'isolated runtime acceptance launches generated Next through the Playwright shell and closes the server' --timeout 180000"
  - "browser-cache/direct-preload-focused: bun test tests/unit/playwright-browser-cache.test.ts tests/unit/dependency-environment.test.ts tests/unit/dev-runner-dependency-bootstrap.test.ts --timeout 180000"
  - "browser-cache/managed-runner-focused: reuse 528a780 exact-head PASS only if the final diff leaves its production and test inputs byte-identical"
  - "runtime-snapshot/structural-cache-focused: reuse de5f84e affected snapshot batch and focused structural evidence only if the final diff leaves runtime-plan and snapshot tests byte-identical"
  - "runtime-snapshot/real-cache-phase-sentinel: reuse 528a780 working-tree sentinel only as a local mechanism baseline; never as aggregate or exact-head PASS"
  - "v10-bootstrap/policy-focused: bun test tests/contract/sec-merge-gate.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-evidence-reuse-contract.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts tests/unit/codex-work-package-contract.test.ts --timeout 180000"
  - "affected-tests-and-real-runtime-sentinel: SEC_AFFECTED_TESTS_BASE=8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2 bun run test:affected"
  - "impact-risk: SEC_CHANGED_BASE=8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2 bun scripts/ci-pr-risk.ts"
  - "typecheck: bun run typecheck"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2 bun run imports:check"
  - "architecture/depcruise: bun run depcruise"
  - "docs-doctor: bun run docs:doctor"
  - "manifest-scope: verify exact owned paths, forbidden paths, and both active manifest pointers"
  - "patch-whitespace: git diff --check 8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2 HEAD --"
  - "gitnexus/compare: detect_changes scope compare against 8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2"
---

# TEST-H2 Runtime Browser Cache V10 Bootstrap V3

## Architectural goal

V2 在 `de5f84e` 的唯一 canonical affected 中证明 snapshot-cache batch 已通过，却由 SM-3 exact title 返回合法且完整的 failed verification artifacts。不可重跑的 TEST-H3 在新 diagnostic head 上只启用既有 workspace retention，并从 canonical artifacts 精确读出：fast、runtime build 与 runtime unit 均通过，唯一失败为 runtime acceptance；child 在 `verify-all` / `verify-runtime` 失败，path-free error class 为 `ENOENT`、`uv_spawn`、`cmd.exe`。该 workspace 在 evidence 校验后已删除，TEST-H3 不含产品修复。

根因不是浏览器缓存本身，而是两个未显式连接的执行合同：isolated verification 对 direct Bun modules 正确保持空 `PATH`；Playwright 的 webServer 与 Windows cleanup 却在第三方内部使用 shell，并解析裸 `bun` / `taskkill`。V3 只为 acceptance 建立最小 shell authority，不恢复 ambient PATH，也不把 host ComSpec/PATHEXT 透传。Windows 先验证并固定 System32，再绑定运行中 Bun 的物理 identity；POSIX 只绑定 Bun 目录。

nested webServer 还必须复用顶层 isolated Bun config。生成命令在 `SEC_ISOLATED_VERIFICATION=1` 时显式传入 `--config=../.isolated-process/runtime/bunfig.toml`，否则可被 compose override 的项目 `bunfig.toml` 会重新成为配置 authority。V3 不扩张 override contract，也不修改通用 process、Observed Process 或 AppContainer 的 Windows lifecycle owners。

V3 同时吸收 V2 的 browser cache 与 structural snapshot 实现，因为这些 delta 尚未进入 `main`，不能把 repair 与 closure 当成两个可独立 landing 的正式包。最终 candidate 从 `main@8aa2d2d` 计算完整 owned diff；TEST-H3 的测试 retention 改动在冻结前撤销，只保留 path-free evidence 与历史 manifest。

## Ownership and competing definitions

- `buildIsolatedProcessEnvironment()` 继续独占通用 empty-PATH environment；本包不修改它。
- `run-runtime-verification.ts` 内的窄 helper 只拥有 acceptance nested-shell launch authority；不得被宣传或导出为仓库通用 Windows system-root owner。
- `ensureProjectBase()` 只改变 Playwright config 的一个 canonical webServer command producer。GitNexus production graph 风险为 HIGH；把测试消费者纳入审计时为 40 impacted、4 direct、4 processes，A0 按高风险共享 scaffold 处理。任何其他 scaffold drift 都停止。
- `buildIsolatedProcessEnvironment()` 是 CRITICAL shared owner（production graph 16 impacted、4 direct、6 processes），因此保持 byte-semantically unchanged。
- Next module identity 仍由 `RUNTIME_VERIFICATION_INVOCATION_CONTRACT.build.moduleRelativePath` 拥有。生产层不新增 shared → compiler 反向 import；测试负责 equality reconciliation。
- `process.ts`、`observed-process.ts` 与 AppContainer 各有不同的 Windows termination/runtime lifecycle，本包既不复用其 fallback，也不修改它们。

## Evidence and Gate boundary

- 长期 Goal 两份 Markdown 已全文读取；combined revision 仍为 `sha256:fbe08bd8dd24224b873619fa48746778eeb4357ddb5cd917d6ee45e45134f86d`。
- GitHub repository 为 `sec-platform/sec`；remote `main` 为 `8aa2d2d`，open PR 为零，open Issue 仅陈旧导航 #132。`29952047837` 是 main lifecycle revalidation success，不是 candidate verification evidence。
- TEST-H3 evidence raw digest 为 `sha256:f9a98bdfb5bf6f96850861f5b7869ac75ab73b89329ced55d95f91f2b4fc468b`；它不保存 raw log、path、source bytes 或环境值。
- `de5f84e + quick + affected-tests` 永久为 FAIL；不得重跑、重命名或由成功 sub-batches 组合为 PASS。该 head 的 Risk 永久未运行。
- A0 是唯一 `gate_owner`。focused owner tests 完成后冻结新 head；canonical affected 恰好一次。只有它 PASS 才执行一次 Risk及剩余静态、文档、scope Gate。
- 本包触及 verification trust root，因此 candidate 不 dispatch hosted verification 自证；满足本地冻结证据、独立 Review 与 scope 后走 manual bootstrap。

## Stop and reconciliation

若 nested Bun 无法复用固定 isolated config，必须重新信任项目/ambient bunfig，bare `bun` 不能证明与 `process.execPath` 物理相同，System32 必须排在 Bun 目录后才能工作，case-insensitive env key 无法唯一化，acceptance env 泄漏到 build/unit，path-free report无法保持，必须触碰 competing process/Windows/override owners，必须增加 shared → compiler 反向依赖，真实 Playwright/Next launch或teardown失败，canonical affected再次失败，或 `ensureProjectBase` 出现其他 scaffold drift，则立即停止并重算。不得通过第二次 aggregate、exact-title、延长 timeout、继承 host PATH 或弱化 acceptance 掩盖。
