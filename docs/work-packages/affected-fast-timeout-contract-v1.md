---
schema: codex-development-work-package-v1
id: affected-fast-timeout-contract-v1
tracking: issue-132
base: 5f70db3c76d23a04361ba7d2ed689a17e3e14e21
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v9
tasks:
  - id: affected-fast-timeout-v9-bootstrap
    owner: a0
    ownedPaths:
      - .gitattributes
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/03-MVP实施计划与路线图.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/affected-fast-timeout-contract-v1.md
      - platform/dev-runner/fast-test-policy.ts
      - platform/dev-runner/test-runner.ts
      - platform/shared/ci-verification-plan.ts
      - scripts/codex/merge-gate.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-evidence-reuse-contract.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tests/unit/test-runner.test.ts
forbiddenPaths:
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
  - platform/compiler/
  - platform/orchestrator/
  - platform/policies/
  - platform/registry/
  - platform/upgrade/
  - platform/shared/ci-verification-revision.ts
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - scripts/codex/work-package-contract.ts
  - source/
  - project/
  - control/
  - tests/e2e/
  - tests/integration/
acceptance:
  - "platform/dev-runner/fast-test-policy.ts is the single named owner of DEFAULT_FAST_TEST_TIMEOUT_MS = 180000; no individual test, selector, workflow, or package script duplicates the default."
  - "Every runFastTests invocation, including concurrent shards and process-isolated serial files, appends --timeout 180000 when and only when the caller supplied neither --timeout <value> nor --timeout=<value>."
  - "Explicit caller timeout options remain byte-for-byte in their original option order, are never duplicated, and continue to reach every concurrent and serial invocation."
  - "Fast-test inventory, selectors, shard size/order, serial ownership, fail-fast sequencing, dependency environment, slow-test notices, and broad-fallback policy remain unchanged; broad fallback proves the default on both concurrent and serial invocations."
  - "The V1 Work Package and Evidence V2 contract revision advances exactly from ci-verification-v8 to ci-verification-v9, while schema, required profiles, selector semantics, Gate IDs/order/argv, execution model, dispatch event, permissions, retention, trust-root inventory, evidence fields, and merge eligibility rules remain unchanged."
  - "All V1 verification artifact producers and base-side lookups advance exactly from sec-verification-v8-* to sec-verification-v9-*; v8 artifacts, manifests, attestations, evidence, and statuses cannot satisfy the current V1 gate."
  - "Work Package V2 evidence composition remains exactly ci-verification-v7 with the existing policy, Evidence V3, reuse, scope, and capabilityComplete:false semantics; no composition artifact or revision changes."
  - "Historical frozen manifests and evidence records remain byte-identical historical facts; only current authority, current fixtures, current artifact lookups, and explicit v8 invalidation tests advance."
  - "The immutable synthetic reusable-evidence fixture retains its existing LF Git blob and registered raw digest; the root .gitattributes pins that exact path to text eol=lf, its contract test asserts the pin, and no test, producer, or verifier normalizes away CRLF/LF byte differences."
  - "The prior SM-4A ingress candidate remains outside main and paused: its exact affected aggregate failed only through twelve Bun default-5000ms timeouts, while an exact 180000ms rerun of those twelve files passed 12/12 with 170 assertions."
  - "The roadmap and three control planes record IR-H1 as merged, this v9 bootstrap manifest as the sole active package, no open pull request, stale Issue 132 as navigation only, the paused ingress as non-main evidence, and exactly five bounded candidates."
  - "Because this package changes the verifier trust root and revision, it never dispatches hosted Scope, Quick, Risk, Full, or release to self-certify; merge authority comes only from frozen local exact-head evidence, independent architecture/evidence review, and manual bootstrap."
  - "The exact candidate diff contains only the twenty-four owned paths, has no temporary probe/generated artifact, and the bootstrap focused batch plus its isolated Windows EOL sentinel, canonical affected, typecheck, dependency architecture, changed-only imports, docs, manifest scope, patch whitespace, and GitNexus compare pass."
tests:
  - "v9-bootstrap/focused: bun test tests/unit/test-runner.test.ts tests/unit/codex-work-package-contract.test.ts tests/unit/ci-verification-execution.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-evidence-reuse-contract.test.ts tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/sec-merge-gate.test.ts --timeout 180000"
  - "affected-tests: SEC_AFFECTED_TESTS_BASE=5f70db3c76d23a04361ba7d2ed689a17e3e14e21 bun run test:affected"
  - "architecture/depcruise: bun run depcruise"
  - "typecheck: bun run typecheck"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=5f70db3c76d23a04361ba7d2ed689a17e3e14e21 bun run imports:check"
  - "docs-doctor: bun run docs:doctor"
  - "manifest-scope: verify the exact twenty-four owned paths, no forbidden paths, and both active manifest pointers"
  - "patch-whitespace: git diff --check 5f70db3c76d23a04361ba7d2ed689a17e3e14e21 HEAD --"
  - "gitnexus/compare: node .gitnexus/run.cjs detect-changes --repo D:/Project/sec/.worktrees/sm4a-planning-5f70db3 --scope compare --base-ref 5f70db3c76d23a04361ba7d2ed689a17e3e14e21"
---

# Affected Fast Timeout V9 Bootstrap V1

## Architectural goal

`main@5f70db3c76d23a04361ba7d2ed689a17e3e14e21` 的 fast runner 对 caller 未指定 timeout 的 concurrent shard 与 serial invocation 都省略 `--timeout`，统一落到 Bun 默认 `5000ms`。SM-4A ingress candidate 的 canonical `test:affected` 因此得到 198 PASS、12 FAIL、1 SKIP；十二项失败全部是 5 秒 timeout，没有 assertion或semantic failure。把相同十二个文件以 `--timeout 180000` 精确重跑后全部通过，共170 assertions，多项实际耗时稳定超过5秒，最高约21.6秒。

根因属于共享执行合同，不属于十二个测试。中央timeout修复必然修改 `platform/dev-runner/`，而当前 canonical authority把整个目录列为 verifier trust root并要求任何变化升级V1 revision。因此本包把timeout修复与最小v9 revision/artifact fan-out合成一次manual bootstrap，避免先合并无效v8 candidate或连续消费两次bootstrap。它不改变selector、Gate plan、Evidence schema、trust-root集合或V2 composition。

## Prerequisite and inputs

- IR-H1 / PR #135 已 squash merge为 `5f70db3c76d23a04361ba7d2ed689a17e3e14e21`，tree `9cc7f2d19e36cd8c0ac3ac150bdf1754186207cf`；Scope `29932931686`、Quick `29933306857`、Ready merge gate `29933703051`、main push gate `29933867770` 与 PR close gate `29933870235` 均成功。
- 当前开放PR为0；Issue #132仍开放但内容停留在Phase 0 / PR #133，只作roadmap navigation。
- 两份上游Goal Markdown已全文读取，combined revision为 `sha256:fbe08bd8dd24224b873619fa48746778eeb4357ddb5cd917d6ee45e45134f86d`；没有新的Nexus Census事实改变本包前置关系。
- ingress candidate `b753b5578e24ef96d03c051c81e25bf81ffcd8c1` / tree `90e036ad299bfd5d43ea9a4cb0c746991272582f` 仍只存在于本地branch，无push或PR。其focused 15/15、118 assertions及静态Gates不能覆盖失败aggregate，也不能证明能力进入main。
- GitNexus对 `fastTestArgs` 为LOW（5 affected、1 direct、1 process），对 `fastTestInvocations` 为LOW（4 affected、2 direct、1 process），对revision常量和merge-gate evaluator也为LOW；独立architecture review仍判定当前v8 envelope为BLOCKER，因为图影响不能覆盖trust-root authority。
- 独立审查确认当前文档、PR/release workflows、base-side merge gate及其contract tests都把 `platform/dev-runner/` 视为trust root。历史manual-bootstrap-without-bump是旧precedent，不能覆盖当前canonical rule。
- v9 focused bootstrap首轮共104项，其中103项通过；唯一失败是Windows `core.autocrlf=true` 把 immutable synthetic PASS fixture从index LF物化为working-tree CRLF。Canonical Git blob、registered digest与源码常量仍完全一致，因此该失败新增的是exact checkout EOL前置，而不是V2 composition或evidence parser语义变化；本包把根 `.gitattributes` 纳入owned seam后只复跑该sentinel，不重复完整batch。

## Frozen seam and invariants

`DEFAULT_FAST_TEST_TIMEOUT_MS` 只属于 `fast-test-policy.ts`。唯一fast argv builder保留 `test`、可选 `--concurrent`、文件顺序和caller options；只有options既无独立 `--timeout` 也无 `--timeout=...` 时，才追加decimal default。Concurrent shard与serial file调用同一builder，禁止第二套判定。

V1 revision唯一owner仍是 `CI_VERIFICATION_CONTRACT_REVISION`，只从v8改为v9。Artifact namespace只在三个workflow producer/lookup与base-side merge evaluator的现有literal owner中同步到v9。Evidence V2读取revision常量，因此不新增字段、schema或adapter。当前V1 fixtures更新到v9，并增加v8不可满足current gate的证明；历史manifest文本不重写。

`CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION`、Work Package V2、Evidence V3、policy registry、reuse binding、scope inventory、selector、Gate plan、workflows的event/permissions/action pins/retention，以及merge-gate trust-root registry全部保持不变。若实现需要触碰这些owner、改变Gate argv或扩大trust root，立即停止并重算。

`tests/fixtures/ci-evidence-reuse/synthetic-pass.json` 的canonical blob与digest保持不变；根 `.gitattributes` 只拥有该exact path的LF checkout materialization。测试同时断言attribute与working-tree raw bytes，禁止通过EOL normalization弱化immutable binding。

## Gate ownership and evidence

A0是全部Gate的唯一 `gate_owner`。先执行一次包含runner、V1 revision/evidence、workflow与merge-gate contracts的focused bootstrap batch；通过后，在单一candidate commit上运行一次canonical affected aggregate。随后只运行typecheck、dependency architecture、changed-only imports、docs/scope/patch与exact GitNexus compare。未被blob交集失效的PR #135产品/IR、full-fast、slow、workspace/reference与release evidence继续复用。

Candidate不dispatch hosted Scope、Quick、Risk、Full或release。任何 `manual-bootstrap-required` 都是预期信任边界，不是PASS或实现失败。合并只依据exact local head/base/tree/manifest evidence、独立architecture review、独立verification-evidence review与人工diff integration。

## Reconciliation, stop, and reload

每次stop返回tested head/base、changed paths/symbols、public/authority delta、acceptance delta、focused results、reusable/invalidated evidence、new blocker、next ready seam，以及 `inspect_ms`、`implement_ms`、`focused_validation_ms`、`wait_ms`、`reconcile_ms`、`context_reload_count` 与 `duplicate_gate_count`。

Manifest/head/base、timeout policy、V1 revision/artifact identity、V2 composition、selector/Gate/schema/trust-root集合、Goal、Nexus prerequisite或任何非owned path变化都会使相关evidence失效并触发重算。满足local exact-head evidence与双审查后立即人工集成；merge后重新读取 `main`，把ingress commit重放到新base、重冻manifest/控制面并只重跑失效Gates。
