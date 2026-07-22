schema: codex-development-work-package-v1
id: test-runtime-isolated-failure-attribution-v1
tracking: issue-132
base: de5f84e693d2cae2ad502185dc86353813d62e4e
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v10
tasks:
  - id: retain-and-classify-valid-failed-isolated-artifacts
    owner: a0
    ownedPaths:
      - docs/03-MVP实施计划与路线图.md
      - docs/evidence/test-runtime-isolated-failure-attribution-2026-07-23.json
      - docs/test-feedback-and-ci-lanes.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/test-runtime-isolated-failure-attribution-v1.md
      - tests/integration/semantic-mutation-apply.test.ts
forbiddenPaths:
  - .github/
  - .gitattributes
  - .githooks/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/goals/
  - docs/04-AI自主实现执行蓝图.md
  - docs/05-编译器核心实现规格.md
  - docs/14-Engineering IR与语义事实规范.md
  - platform/
  - scripts/
  - tests/contract/
  - tests/e2e/
  - tests/fixtures/
  - tests/setup/
  - tests/testkit/
  - tests/unit/
acceptance:
  - "The unique affected-tests execution on de5f84e remains an immutable FAIL: the snapshot-cache batch passed, while the SM-3 dry-run/apply title returned a valid failed isolated artifact set after 287236ms with public SEMANTIC-MUTATION-010. No exact-title result can rename or compose that aggregate into PASS, and Risk remains forbidden on that head."
  - "Only the existing withTempWorkspace retainOnCallbackFailure option is selected at the single failing SM-3 test call site, and only when SEC_RETAIN_SM3_FAILED_WORKSPACE=1. The shared CRITICAL testkit helper, production orchestration, runtime plan, child, process lifecycle, timeout, selector, fixtures, and default cleanup behavior remain byte-identical."
  - "One exact-title diagnostic runs on the frozen diagnostic head with retention enabled. Its expected nonzero result is diagnostic evidence only; it is not affected, Quick, Risk, or completion evidence and is never repeated on the same head."
  - "The retained workspace is read without executing the child again. Evidence records only logical artifact roles without path strings, canonical status/failed-lane fields, phase durations, child outcome/progress classifications, byte lengths and SHA-256 digests; absolute or repository-relative paths, raw logs, source bytes, environment values, and mutable workspace contents are excluded."
  - "A path-safe census proves exactly one retained sm3 workspace under the canonical .tmp/test-workspaces root. After the evidence file is atomically written and independently checked, that exact retained directory is removed and Test-Path proves it absent; no other workspace or cache is deleted."
  - "The package stops after classifying the first failed canonical lane and updating the three control planes. It does not implement the repair, change timeout, rerun canonical affected, run Risk, dispatch hosted verification, or open a PR. A separately frozen repair package owns only the proven failed seam."
tests:
  - "retained-exact-title-diagnostic: SEC_RETAIN_SM3_FAILED_WORKSPACE=1 bun test tests/integration/semantic-mutation-apply.test.ts -t 'SM-3 dry-run/apply share one plan revision, publish atomically, rebuild live derivatives, and replay exactly once' --timeout 300000"
  - "diagnostic-evidence-validation: parse the retained verification/runtime/policy/coverage, phase telemetry and child outcome/progress artifacts without executing product code; validate docs/evidence/test-runtime-isolated-failure-attribution-2026-07-23.json exact keys and SHA-256 digests"
  - "cleanup-proof: resolve the single retained path beneath .tmp/test-workspaces, remove only that literal path, and prove Test-Path is false"
  - "typecheck: bun run typecheck"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=de5f84e693d2cae2ad502185dc86353813d62e4e bun run imports:check"
  - "docs-doctor: bun run docs:doctor"
  - "manifest-scope: verify exact owned paths, forbidden paths, and both active manifest pointers"
  - "patch-whitespace: git diff --check de5f84e693d2cae2ad502185dc86353813d62e4e HEAD --"
  - "gitnexus/compare: detect_changes scope compare against de5f84e693d2cae2ad502185dc86353813d62e4e"
---

# TEST-H3 Isolated Verification Failed-Lane Attribution V1

## Architectural goal

`test-runtime-browser-cache-v10-bootstrap-v2` 已在 `de5f84e693d2cae2ad502185dc86353813d62e4e` 完成结构化snapshot cache与parallel-safe synthetic oracle，但其唯一canonical affected仍以FAIL终结。失败不是旧的snapshot counter oracle：同一aggregate内snapshot-cache batch为113 pass / 2 skip / 0 fail / 845 assertions；真正失败的是SM-3 dry-run/apply title，它在287236ms返回`SEMANTIC-MUTATION-010`。

原始公开结果没有`details.isolatedVerification`，且verification status为`failed`而不是`blocked`。按现有host实现，这证明materialize、launch、supervisor、child-control、四个artifact读取/解析、semantic rebuild与artifact-set classification均已完成并形成合法failed artifacts；未知只剩canonical fast/runtime具体lane。当前testkit在callback failure后默认删除workspace，使该已有报告不可恢复。本包只使用现成的test-only retention option保留一次失败workspace并读取报告，不修改任何production seam。

## Evidence and authority boundary

- observed main仍为`8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2`；open PR为零，Issue #132仍是陈旧导航，main最新Actions仅是`sec-merge-gate` lifecycle success。
- `de5f84e` affected identity永久为FAIL；其成功sub-batches只作局部baseline，不能与后续diagnostic或exact-title结果组合成aggregate PASS。
- 本包的base是失败candidate `de5f84e`，因为它只归因该exact tree上的valid failed artifact set；这是不可合入的diagnostic-only基线，不宣称该base进入`main`，也不得成为PR或merge candidate。
- `withTempWorkspace`的共享helper为GitNexus CRITICAL（69 direct / 74 upstream），所以helper与cleanup algorithm都列为forbidden。唯一修改是失败title调用点按显式环境变量选择已存在的retention option。
- diagnostic必须保留原始canonical报告供只读提取；任何需要修改child、orchestrator、runtime-plan、process、fixture或timeout才能取得结果的路线都停止本包并重新冻结。

## Gate ownership and stop

A0是唯一`gate_owner`。本包恰好运行一次retained exact-title diagnostic，预期仍可能nonzero；它只回答哪个canonical lane失败及其path-free状态/耗时/digest。取得报告后立即清理唯一retained workspace并写入tracked evidence。随后从该lane owner重新计算repair DAG；本包本身不运行canonical affected、Risk、full/slow、hosted Scope/Quick/Full/release，也不创建PR。

若diagnostic意外PASS、未保留workspace、出现多个retained workspace、报告缺失/无法解析、artifact与公开failed result矛盾、或证据只能靠暴露raw log/absolute path建立，立即停止并记录UNKNOWN，不进行第二次诊断。
