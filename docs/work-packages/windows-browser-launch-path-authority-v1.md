---
schema: codex-development-work-package-v1
id: windows-browser-launch-path-authority-v1
tracking: issue-132
base: 4ef0d38f726ce38d931ea66e859d20214469c69e
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v11
tasks:
  - id: close-windows-browser-launch-path-and-runtime-reconciliation
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - bun.lock
      - package.json
      - docs/05-编译器核心实现规格.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/runtime-canonical-line-and-pr137-reconciliation-v1.md
      - docs/work-packages/windows-browser-launch-path-authority-v1.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - platform/compiler/semantic-mutation/isolated-verification-phase-telemetry.ts
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/compiler/verify/semantic-mutation-staged-project-input.ts
      - platform/compiler/verify/windows-browser-launch-path.ts
      - platform/dev-runner/dependency-bootstrap.ts
      - platform/dev-runner/fast-test-policy.ts
      - platform/dev-runner/test-runner.ts
      - platform/shared/ci-verification-plan.ts
      - platform/shared/dependency-environment.ts
      - platform/shared/project-base.ts
      - platform/shared/project-runtime.ts
      - platform/shared/runtime-dependency-spec.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/integration/project-runtime.test.ts
      - tests/integration/semantic-mutation-apply.test.ts
      - tests/setup/runtime-deps.setup.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tests/unit/dependency-environment.test.ts
      - tests/unit/dev-runner-dependency-bootstrap.test.ts
      - tests/unit/playwright-browser-cache.test.ts
      - tests/unit/runtime-dependency-spec.test.ts
      - tests/unit/runtime-verification.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/unit/semantic-mutation-isolated-phase-telemetry.test.ts
      - tests/unit/semantic-mutation-runtime-materialization.test.ts
      - tests/unit/test-runner.test.ts
      - tests/unit/windows-browser-launch-path.test.ts
forbiddenPaths:
  - .claude/
  - .gitattributes
  - .githooks/
  - AGENTS.md
  - README.md
  - bunfig.toml
  - tsconfig.json
  - docs/00-文档索引与一致性规则.md
  - docs/01-用户能力模块化开发-主题整理稿.md
  - docs/02-工程编译器-MVP-PRD与架构稿.md
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
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
  - platform/compiler/index.ts
  - platform/shared/ci-verification-revision.ts
  - platform/shared/process.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/install-git-hooks.ts
  - tests/e2e/
  - tests/fixtures/
acceptance:
  - "The package adopts the stable runtime/V11 reconstruction from 3a72882151072ca96a83d974d01acc0b033fdd1a as source only. Its exact-head canonical affected result remains permanently failed and is never rerun or presented as completion evidence."
  - "The retained failed workspace and a bounded launch probe prove that the exact browser cache is complete, the 171-character source executable launches, the 323-character namespaced staged executable is not Win32-launch-compatible, and a 160-character projection of the same physical cache launches."
  - "Windows filesystem addressability and Win32 launch compatibility are separate canonical contracts. The staged browser cache remains the only exact physical runtime materialization; a launch projection may expose only that cache and never becomes a second cache, installer or package identity owner."
  - "The Windows launch projection is unique per execution, rooted in an inspected host temporary directory, resolves to the exact staged physical cache, proves the required browser executable through the projected path, enters only the fixed isolated environment, and is revalidated immediately before child execution."
  - "Projection cleanup is mandatory on success, child failure, timeout, abort and pre-launch rejection. Failed cleanup fails closed; stale or attacker-controlled roots, aliases, targets and path escapes are rejected without deleting unowned data."
  - "POSIX continues to use the canonical physical staging path and creates no projection."
  - "The child consumes one runtime plan and one environment binding. run-runtime-verification accepts only the parent-issued launch path bound to its exact staged cache; ambient PLAYWRIGHT_BROWSERS_PATH cannot become authority."
  - "Isolated acceptance starts generated Next as one direct child of the SEC verifier through the exact staged Node, proves loopback readiness, and closes that direct child on every exit. The generated Playwright config does not register a webServer in isolated mode and cannot delegate lifecycle to Playwright's Windows shell/taskkill fallback."
  - "The SM-3 production sentinel timeout is derived from and strictly exceeds the canonical isolated supervisor deadline plus cleanup margin, so the test runner cannot begin afterAll cleanup while production verification still owns the staging workspace."
  - "Staged Verification project-input identity excludes only canonical runtime/build outputs, including the project dependency stamp and Next-managed next-env.d.ts. Source, tests, configuration and every unclassified root entry remain exact-bound and fail closed on drift."
  - "The old namespaced browser-path assumption is removed from canonical docs. Windows TEMP may remain namespaced; browser launch paths must instead satisfy the launch-compatible projection contract."
  - "Focused projection, environment, materialization, child lifecycle and retained SM-3 sentinel tests pass. No one-shot diagnostic selector or retained test workspace enters the candidate."
  - "Typecheck, changed-only imports, docs doctor, control-plane lifecycle, manifest scope, patch hygiene and GitNexus change detection pass on the frozen head."
  - "Canonical affected executes exactly once on the final successor head. Only a real affected PASS permits one selected ci-verification-v11 Risk execution."
  - "The successor PR has no unresolved review or REQUEST_CHANGES and is integrated through V11 manual bootstrap. Only after the successor is in main is PR #137 closed as absorbed/superseded and its remote branch removed."
tests:
  - "windows-launch-path-focused: bun test tests/unit/windows-browser-launch-path.test.ts tests/unit/runtime-verification.test.ts tests/unit/semantic-mutation-runtime-materialization.test.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts --timeout 180000"
  - "proof-consumption-micro-sentinel: the exact staged full Verification proof test title in tests/unit/semantic-mutation-isolated-child-fence.test.ts before the production sentinel"
  - "sm3-failure-sentinel: the exact retained production test title in tests/integration/semantic-mutation-apply.test.ts once on the repaired head with no retained workspace"
  - "runtime-regression: bun test tests/integration/project-runtime.test.ts tests/unit/runtime-dependency-spec.test.ts tests/unit/playwright-browser-cache.test.ts --timeout 180000"
  - "v11-contract-focused: bun test tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/docs-doctor.test.ts tests/contract/sec-merge-gate.test.ts tests/unit/codex-work-package-contract.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts --timeout 180000"
  - "control-plane-lifecycle: bun test tests/contract/document-control-plane-lifecycle.test.ts --timeout 180000"
  - "typecheck: bun run typecheck"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=4ef0d38f726ce38d931ea66e859d20214469c69e with bun run imports:check"
  - "docs-doctor: bun run docs:doctor"
  - "canonical-affected: SEC_CHANGED_BASE=4ef0d38f726ce38d931ea66e859d20214469c69e and bun run test:affected exactly once on the final successor head"
  - "impacted-risk: one selected ci-verification-v11 Risk execution only after canonical affected PASS"
  - "manual-bootstrap: independent scope/review plus base-side integration for the V11 trust-root change"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check 4ef0d38f726ce38d931ea66e859d20214469c69e HEAD --"
  - "gitnexus: impact before edits and detect_changes compare against main after final freeze"
---

# Windows Browser Launch Path Authority V1

## Architectural goal

修复已经被真实产物证伪的 Windows 长路径假设：`\\?\` 能让文件系统访问超长路径，但不能保证 Chromium/Playwright 能从该路径启动。浏览器 bytes 继续由 staging runtime plan 唯一物化和验证；Windows 只增加一个绑定同一物理目录的短期 launch-path projection，由 child lifecycle 创建、复核并回收。

```text
exact package identity
→ exact staged physical browser cache
→ Windows-only launch projection
→ fixed isolated environment
→ SEC-owned Next direct child + Playwright child
→ server close + projection cleanup
```

## Frozen failure

`3a72882151072ca96a83d974d01acc0b033fdd1a` 的 canonical affected 在 `semantic-mutation-apply.test.ts` 首个 production closure 上得到 `3 pass / 1 fail / 1 error`，其中目标测试 300 秒超时，随后返回 runtime verification failure。该 identity 永久为 FAIL；Risk 未运行，候选未推送。

Retained workspace 显示 build/unit 通过、runtime acceptance 失败，Chromium 报 `Invalid file descriptor to ICU data received`。同一物理 cache 的 323 字符 namespaced executable 不能直接启动，而 160 字符 junction projection 与 171 字符 source executable 均成功输出版本。因而 dependency revision、安装完整性与 browser selection 不是当前根因。

重建后的 runtime regression 又暴露出独立 lifecycle 缺陷：请求与 Next 响应均已成功，但 Playwright Windows teardown 的 `taskkill /T /F` 在非特权 verifier 中返回 `Access denied`，随后无限等待 shell 退出。该问题不能靠提升权限解决；isolated acceptance 因而由 SEC verifier 直接启动和关闭 exact staged Node/Next，Playwright只消费已就绪 base URL，isolated config 不再创建 `webServer`。

首次 repaired SM-3 sentinel 随后证明其显式 300 秒 Bun test timeout 小于 production isolated supervisor 的 1200 秒 deadline；test runner 先标记 timeout 并执行 `afterAll` cleanup，仍在运行的 verification 才以 `artifact-read` 失败。外层预算现从 canonical supervisor deadline 派生并增加 cleanup margin，避免测试框架抢先撤销 workspace authority。

预算修复后的 sentinel 又证明 staged proof 的 project input digest 错把 `.runtime-deps.stamp.json` 与 Next build 重写的 `next-env.d.ts` 当成 authoring inputs。两者都是其他 authority 已拥有的派生输出：staging 验证完成后与 live rebuild 消费前的 bytes 必然可能不同。proof 因此误拒绝已验证的 live tree并触发昂贵 rollback full verification。当前合同只从摘要中排除这两个已分类输出；同一 one-shot proof micro-sentinel 仍拒绝真实源码漂移，production SM-3 再证明 live rebuild、原子发布与 replay 闭合。

## Stop conditions

- projection 不能证明与 staged physical cache exact-equal，或 cleanup 不能证明完成。
- 需要第二 browser cache、installer、package identity、runtime plan或 ambient/global fallback。
- repaired sentinel、final canonical affected、Risk、Review 或 V11 manual bootstrap 失败。
- 需要修改任一 forbidden path，或出现临时诊断、retained workspace、process、lock 或 artifact drift。

## Reload if

- live `origin/main` 不再是 `4ef0d38f726ce38d931ea66e859d20214469c69e`。
- PR #137 或 Issue #132 的 head、base、state、Review 或 CI 变化。
- Goal combined revision 不再是 `sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676`。
- Windows launch projection不能保持单 owner、exact target、bounded lifecycle或fixed-environment binding。
- retained failure artifact 与新运行证据冲突。
