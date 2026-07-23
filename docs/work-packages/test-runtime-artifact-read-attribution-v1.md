---
schema: codex-development-work-package-v1
id: test-runtime-artifact-read-attribution-v1
tracking: issue-132
base: 8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v10
tasks:
  - id: retain-and-classify-v3-artifact-read-failure
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/03-MVP实施计划与路线图.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/05-编译器核心实现规格.md
      - docs/evidence/test-runtime-artifact-read-attribution-2026-07-23.json
      - docs/evidence/test-runtime-isolated-failure-attribution-2026-07-23.json
      - docs/test-feedback-and-ci-lanes.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/test-runtime-artifact-read-attribution-v1.md
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
  - "The two upstream Markdown Goal documents under docs/goals remain the long-term authority at combined revision sha256:fbe08bd8dd24224b873619fa48746778eeb4357ddb5cd917d6ee45e45134f86d. The latest formal main remains 8aa2d2d; branch, PR, plan, and diagnostic evidence do not prove product completion."
  - "test-runtime-browser-cache-v10-bootstrap-v3 stops on its own reload_if condition. affected-tests + ec97412 + quick is an immutable FAIL: the selected SM-3 file ended 3 pass / 1 fail / 77 expectations in 350.36s, the failing title returned after 254788.32ms with result rejected, verification blocked, SEMANTIC-MUTATION-010, and public isolatedVerification.stage artifact-read. Risk is not run and remains forbidden on ec97412."
  - "This package absorbs the complete unlanded PR #137 candidate only to diagnose its blocker. Every inherited production, CI, contract, and runtime blob is frozen byte-for-byte at ec97412. From that pre-diagnostic head, only this manifest, the three control planes, the single test call site, one bounded evidence file, and their canonical documentation pointers may change."
  - "Only the existing withTempWorkspace retainOnCallbackFailure option is selected at the single failing SM-3 test call site, and only when SEC_RETAIN_SM3_FAILED_WORKSPACE=1. The shared CRITICAL testkit helper, production orchestrator, isolated child, runtime plan, process lifecycle, timeout, selector, fixture bytes, and default cleanup behavior remain unchanged."
  - "One exact-title diagnostic runs on the frozen diagnostic head with retention enabled. It is a diagnostic/focused execution only, never an affected, Quick, Risk, or completion PASS, and is not repeated on the same head regardless of PASS, FAIL, timeout, or infrastructure outcome."
  - "The retained workspace is inspected without executing product code again. Evidence records the diagnostic head/tree, result classification, child exit/termination class, child outcome stage and boundary, final and pending progress checkpoints, phase durations, and for each canonical artifact role only presence, parse status, byte length, SHA-256 digest, and canonical status fields that exist. It excludes raw logs, commands, absolute or repository-relative paths, environment values, source bytes, and mutable workspace content."
  - "A path-safe census must prove exactly one retained literal sm3 workspace under the canonical .tmp/test-workspaces root. After the evidence file is written and independently parsed/digested, only that resolved literal directory is removed with native PowerShell Remove-Item, and Test-Path plus a fresh census prove zero retained workspaces."
  - "Unexpected PASS, a 300000ms timeout, zero or multiple retained workspaces, missing/unparseable child outcome or progress evidence, contradiction with the public blocked result, or cleanup failure is recorded as UNKNOWN and immediately stops this package. No second diagnostic is authorized."
  - "After evidence and cleanup, A0 stops this package and freezes one replacement repair package whose mutable production owner is selected only from the retained evidence. This package does not implement a repair, rerun affected, run Risk, dispatch hosted verification, mark PR #137 ready, merge, or claim V10 complete."
tests:
  - "retained-exact-title-diagnostic: SEC_RETAIN_SM3_FAILED_WORKSPACE=1 bun test tests/integration/semantic-mutation-apply.test.ts -t 'SM-3 dry-run/apply share one plan revision, publish atomically, rebuild live derivatives, and replay exactly once' --timeout 300000"
  - "diagnostic-evidence-validation: read the single retained child outcome, progress, phase telemetry and any canonical verification artifacts without executing product code; independently parse and SHA-256-validate docs/evidence/test-runtime-artifact-read-attribution-2026-07-23.json"
  - "cleanup-proof: resolve exactly one literal retained path beneath .tmp/test-workspaces, remove only it, prove Test-Path false, and prove the retained-workspace census is zero"
  - "typecheck: bun run typecheck"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2 bun run imports:check"
  - "docs-doctor: bun run docs:doctor"
  - "manifest-scope: verify the complete main-to-head path set, inherited-blob freeze, forbidden paths, and both active manifest pointers"
  - "patch-whitespace: git diff --check 8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2 HEAD --"
  - "gitnexus/compare: detect_changes scope compare against 8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2"
---

# TEST-H4 V3 Artifact-read Failure Attribution V1

## Architectural goal

PR #137 的 V3 candidate `ec97412efda4a61efe147575fd6f641338b110c9` 已证明 acceptance-only shell authority 的 focused sentinel、完整 project-runtime batch与静态边界，但唯一 canonical affected 仍以 FAIL 终结。失败已从旧 `cmd.exe` runtime-acceptance 归因推进为新的 host-side `artifact-read` 阻塞；公开错误为安全而只暴露 stage，callback 随后删除临时 workspace，故现有证据无法区分 child progress、child outcome 或四个 verification artifacts 中的具体读取点，也不能知道 child 的终止分类。

本包只恢复一次失败现场，不改生产实现。它从 latest `main@8aa2d2d` 观察整个未落地 candidate，同时把 `ec97412` 固定为 pre-diagnostic blob baseline。测试调用点按显式环境变量选择已经存在的 retention 机制；默认测试和全部共享 helper语义不变。诊断结束后删除唯一 retained workspace，并依据实际 child/artifact owner重算 repair DAG。

## Authority, ownership and evidence boundary

- 两份 `docs/goals/*.md` 上游 Goal 已全文读取，combined revision为 `sha256:fbe08bd8dd24224b873619fa48746778eeb4357ddb5cd917d6ee45e45134f86d`。
- `main@8aa2d2d` 是唯一正式工程事实。PR #137 保持 Draft；Issue #132 只是陈旧导航；无 review、无 unresolved thread、无 REQUEST_CHANGES。Draft merge-gate failure不是candidate验证证据。
- `ec97412 + quick + affected-tests` 永久为 FAIL，成功 sub-batches不能与本诊断组合为 PASS。该 head的 Risk从未运行且不得运行。
- GitNexus 对 `semantic-mutation-apply.test.ts` 文件级变化为 LOW（0 upstream / 0 process）；共享 `withTempWorkspace` helper仍是 CRITICAL forbidden owner，不能修改。
- 从 `ec97412` 开始，production、CI、contract与runtime blob全部冻结；诊断只拥有调用点 selector、控制面、manifest和最小evidence。
- 任何需要修改 child、orchestrator、runtime-plan、process、fixture、timeout或 artifact schema才能得到归因的路线都停止，不做推测性修复。

## Stop and reconciliation

A0 是唯一 `gate_owner`。新 diagnostic head 只运行一次 retained exact title。无论它如何结束，都不能修补 `ec97412` 的 affected Gate；取得或无法取得证据后都立即消费该诊断 identity。成功取得证据时，先写入并独立验证 path-free evidence，再删除唯一 literal retained workspace；随后把真实 failure owner、最小 blast radius、复用/失效 Gate和新 stop condition冻结为一个 replacement repair Work Package。

若结果意外 PASS、再次到达 test-owned 300 秒 timeout、workspace数量不是一、child outcome/progress不足以区分失败阶段、evidence与公开结果冲突或清理无法证明，则记录 UNKNOWN 并停止，不得通过第二次运行寻找偶然结果。
