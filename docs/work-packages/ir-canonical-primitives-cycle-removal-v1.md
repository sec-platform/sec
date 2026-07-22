---
schema: codex-development-work-package-v1
id: ir-canonical-primitives-cycle-removal-v1
tracking: issue-132
base: 313e2391d7017c23a510d56d28eaa82bba6614dd
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v8
tasks:
  - id: ir-canonical-primitives-leaf-extraction
    owner: a0
    ownedPaths:
      - docs/03-MVP实施计划与路线图.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/ir-canonical-primitives-cycle-removal-v1.md
      - platform/compiler/ir/ir-canonical-primitives.ts
      - platform/compiler/ir/ir-identity.ts
      - platform/compiler/ir/ir-revision.ts
      - tests/unit/canonical-ir-identity-revision.test.ts
forbiddenPaths:
  - .github/
  - .githooks/
  - AGENTS.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - scripts/
  - platform/compiler/index.ts
  - platform/compiler/semantic-impact/
  - platform/compiler/semantic-mutation/
  - platform/compiler/verify/
  - platform/orchestrator/
  - platform/shared/
  - tests/contract/
  - tests/e2e/
  - tests/integration/
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
acceptance:
  - "The only production change extracts digest(value) and normalizedArtifactTarget(target) into platform/compiler/ir/ir-canonical-primitives.ts, a pure internal leaf that imports only node:crypto and node:path and imports no IR builder, identity, revision, facade, or business type."
  - "ir-identity.ts and ir-revision.ts both consume the leaf directly, the identity↔revision dependency cycle is absent, and dependency-cruiser reports no circular dependency or new violation."
  - "ir-identity.ts still exports normalizedArtifactTarget and ir-revision.ts still exports digest as no-logic re-exports of the same leaf bindings; no existing external consumer import is migrated and platform/compiler/index.ts is unchanged."
  - "SHA-256 lowercase hexadecimal bytes, POSIX target normalization, Artifact IDs, namespace-owner identity, inputRevision, semanticRevision, Fact/Assertion identity, payload ordering, diagnostics, schemas, and canonical serialized Engineering IR bytes remain byte-identical to base 313e2391d7017c23a510d56d28eaa82bba6614dd."
  - "tests/unit/canonical-ir-identity-revision.test.ts contains fixed base-derived known-answer vectors for digest, Windows-to-POSIX target normalization, Artifact ID, inputRevision, semanticRevision, and the complete canonical Engineering IR serialization without importing the new internal leaf or duplicating a production algorithm."
  - "The semantic-ir affected owner and the existing complete Contract Freeze pass; no new Contract Freeze target, test owner, slow suite, public facade, CI selector, verifier trust root, schema, or runtime consumer is introduced."
  - "The roadmap and three control planes record Phase 0 as merged, main at 313e2391d7017c23a510d56d28eaa82bba6614dd, this manifest as the sole active package, no open pull request, Issue 132 as navigation only, and SM-4A plus three bounded candidates without treating this plan as completion evidence."
  - "The exact candidate diff contains only the nine owned paths, has no temporary probe or generated artifact, and changed-only imports, typecheck, documentation health, patch whitespace, manifest scope, and GitNexus compare checks pass."
tests:
  - "ir-cycle/byte-parity: bun test tests/unit/canonical-ir-identity-revision.test.ts --timeout 180000"
  - "architecture/depcruise: bun run depcruise"
  - "affected-tests: SEC_AFFECTED_TESTS_BASE=313e2391d7017c23a510d56d28eaa82bba6614dd bun run test:affected"
  - "contract-freeze: bun run test:contract-freeze"
  - "typecheck: bun run typecheck"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=313e2391d7017c23a510d56d28eaa82bba6614dd bun run imports:check"
  - "docs-doctor: bun run docs:doctor"
  - "patch-whitespace: git diff --check 313e2391d7017c23a510d56d28eaa82bba6614dd HEAD --"
  - "gitnexus/compare: node .gitnexus/run.cjs detect-changes --repo . --scope compare --base-ref 313e2391d7017c23a510d56d28eaa82bba6614dd"
---

# IR Canonical Primitives Cycle Removal V1

## Architectural goal

`main@313e2391d7017c23a510d56d28eaa82bba6614dd` 上唯一 dependency-cruiser violation 是 `ir-identity.ts → ir-revision.ts → ir-identity.ts`。根因不是产品能力缺失，而是两个 canonical primitive 的 owner 放反：identity 为 semantic contract owner identity 调用 revision 模块中的 `digest()`，revision 又为 generator payload 调用 identity 模块中的 `normalizedArtifactTarget()`。本包把两段纯逻辑下沉到一个无业务依赖的内部 leaf，使 identity 与 revision 只朝低层依赖，同时保持旧 import surface 与全部 canonical bytes 不变。

这是 CRITICAL/HIGH 风险的 plumbing closure，不是 revision redesign。`digest` 的 production 图影响为 CRITICAL（96 upstream symbols、11 direct dependants、11 execution flows），`normalizedArtifactTarget` 为 HIGH（8 upstream symbols、4 direct dependants、1 execution flow）；含测试审查分别扩大到 151/17/11 与 39/4/1。因此只能由 A0 串行单写者执行，禁止借机统一其他 SHA-256/path helper、迁移外部 consumer、修改 payload/order/schema/diagnostic，或把内部 leaf 暴露到 Compiler facade。

## Prerequisite and inputs

- Phase 0 / PR #133 已 squash merge；最新 `main`、`origin/main` 与本包 base 均为 `313e2391d7017c23a510d56d28eaa82bba6614dd`，tree 为 `1528d8ea9ec2a4cfd194b2e7eb15e9a703f4fc26`；当前没有开放 PR，Issue #132 仍开放且只作 roadmap navigation。
- Phase 0 exact tree 的 Scope `29928582219`、Quick `29928585607`、base-side merge gate `29928682415` 和 merge 后 main push gate `29928917790` 均成功；这些结果证明 Phase 0 tree，不是本包 candidate evidence。
- exact-base `bun run depcruise` 失败且只报告上述一个 `no-circular` violation：535 modules、1,526 dependencies、1 error、0 warning。
- 两份上游 Goal Markdown raw digest及 combined Goal revision `sha256:fbe08bd8dd24224b873619fa48746778eeb4357ddb5cd917d6ee45e45134f86d` 未变化；Nexus baseline也未提供会改变本包前置关系的新 Census 事实。
- 旧 app/revision、Fact Delta、Impact 与 Mutation focused/affected/Contract Freeze digest evidence因本包修改 revision primitive producer而失效；legacy full-fast、25/25 slow、benchmark/deps、ordered workspace/reference和SM-3 runtime evidence继续复用，因为本包不迁移 consumer且 canonical selector不选择 slow。

## Frozen seam and invariants

唯一 leaf `ir-canonical-primitives.ts` 只拥有现有 `digest(value)` 与 `normalizedArtifactTarget(target)` 函数体。`ir-identity.ts` 从 leaf 导入两者、继续从原路径 re-export normalization，并只在本模块逻辑中使用；`ir-revision.ts` 同样直接导入两者中所需项并从原路径 re-export digest。旧模块不保留 wrapper或复制函数体，任何现有 caller都不改 import path。

Known-answer vector必须由 base实现先生成独立常量，再在 candidate上复核；测试只能通过旧 surface消费 primitive，不把 leaf变成第二公共入口。完整 IR bytes以独立固定 expected值冻结，不能调用 production sort、payload或digest helper计算 expected。若任一 vector drift，本包立即停止，不通过更新 expected接受新语义。

## Gate ownership and evidence

A0 是全部 Gate 的唯一 `gate_owner`。本地顺序固定为一次 byte-parity sentinel、一次完整 dependency-cruiser、一次 canonical affected、一次完整 Contract Freeze、changed-only imports、typecheck、docs/scope/patch hygiene和exact GitNexus compare；不先拆跑 Fact/Impact/Mutation contracts，不运行 full-fast、slow、workspace或reference。hosted只在 frozen exact head/base/manifest/v8 identity上执行一次 Quick；其与本地 imports/typecheck/affected的重叠是跨 profile trust evidence，不计重复执行。

每项 evidence绑定 candidate head/tree、base、profile、manifest raw digest、命令、结果、duration、clean state与失效规则。旧 Phase 0和历史 revision evidence不能冒充 candidate exact-head结果。

## Reconciliation, stop, and reload

每次 stop返回 tested head/base、changed paths/symbols、public/authority delta、acceptance delta、focused results、reusable/invalidated evidence、new blocker、next ready seam，以及 `inspect_ms`、`implement_ms`、`focused_validation_ms`、`wait_ms`、`reconcile_ms`、`context_reload_count`、`duplicate_gate_count`。

任一 fixed vector mismatch、public export/payload/order/schema/diagnostic变化、第二依赖环、外部 consumer迁移、selector/Contract Freeze/CI revision变化、base/head/manifest变化、Goal或Nexus新前置、或任何非 owned path漂移都会停止实现并从最新事实重算。满足 exact evidence、Review与merge gate后立即合并；merge后重新读取 `main` 并切换到 SM-4A，不以本 manifest或branch声称完成。
