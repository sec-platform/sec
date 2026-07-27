---
schema: codex-development-work-package-v1
id: docs-doctor-v5-semantic-superset-bootstrap-v1
tracking: issue-132
base: 4dbfc3fe0dcbae5c24ca6f80ac339ae065d1222e
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v10
tasks:
  - id: docs-doctor-semantic-superset-and-v10-bootstrap
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/00-文档索引与一致性规则.md
      - docs/scripts/docs-doctor.ts
      - docs/test-feedback-and-ci-lanes.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/docs-doctor-v5-semantic-superset-bootstrap-v1.md
      - platform/shared/ci-verification-plan.ts
      - platform/shared/contract-freeze-contract.ts
      - scripts/codex/document-control-plane-contract.ts
      - scripts/codex/document-control-plane.ts
      - scripts/codex/merge-gate.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/contract-freeze.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/document-control-plane-lifecycle.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
forbiddenPaths:
  - .agents/
  - .claude/
  - .githooks/
  - .shared-deps/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/01-用户能力模块化开发-主题整理稿.md
  - docs/02-工程编译器-MVP-PRD与架构稿.md
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/05-编译器核心实现规格.md
  - docs/06-Registry与Block协议规范.md
  - docs/07-Pass状态机、错误码与恢复机制.md
  - docs/08-Verification、Provenance与Graph规范.md
  - docs/09-AI Runtime、任务信封与治理规范.md
  - docs/10-升级迁移与Override规范.md
  - docs/11-Workbench与可视化规范.md
  - docs/12-编译管道与行为流图示.md
  - docs/13-独立工具分发与打包规划.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/architecture/
  - docs/archive/
  - docs/evidence/
  - docs/goals/
  - docs/governance/
  - docs/scripts/SEC_docs_v5_replacement/
  - docs/superpowers/
  - platform/compiler/
  - platform/dev-runner/
  - platform/orchestrator/
  - platform/policies/
  - platform/registry/
  - platform/upgrade/
  - control/
  - project/
  - source/
acceptance:
  - "The active scanner is a semantic superset of main@4dbfc3f: frontmatter/status, file URI, active repository path, and deprecated-token diagnostics remain executable and fixture-covered."
  - "Required canonical owners, exactly one H1 per active authority, retired V4 path/reference policy, NFC/U+FFFD path safety, Markdown links, hard-coded local repository paths, and three control-plane binding are checked with deterministic issue codes."
  - "The scanner distinguishes the pointer-selected active manifest from frozen historical Work Packages: historical/future inline code paths do not become false links, while explicit Markdown links remain checked. The eight previous warnings reach zero without deleting history, creating fake files, or adding a blanket directory exclusion."
  - "Current-state, active pointer, and rolling-plan parsing share the canonical document-control-plane implementation; tests no longer own a second rolling-window algorithm. The pointer binds this ordinary Git blob, and the rolling plan contains this single active package plus two to five dependency-ordered candidates."
  - "The shared parser, digest, binding, and selector live in an I/O-free contract leaf. docs-doctor and pure contract tests import that leaf directly; only the live control-plane adapter may execute Git/GitHub commands, so the docs verifier TCB has no process dispatcher."
  - "The docs-doctor positive/negative/differential contract is registered once as verification.docs-doctor in the indivisible Contract Freeze set and passes on Windows and a distinct POSIX runtime profile."
  - "V1 revision and verification artifact namespace advance exactly from v9 to v10; V2 composition remains v7. Draft PR #137 does not reserve an unmerged revision and must use a later revision if its trust-root changes survive reconciliation."
  - "Because this candidate changes verifier trust-root files, it never dispatches hosted Scope, Quick, Risk, Full, or release self-verification. Merge authority comes from one single-parent exact candidate, frozen local evidence, exact scope/diff review, two independent reviews, and manual bootstrap."
  - "No compiler/runtime/product/dependency/hook/Goal/replacement source, historical evidence, or user-root bytes enter the candidate."
tests:
  - "bun run test:contract-freeze"
  - "posix/docs-doctor-contract: bun test tests/contract/docs-doctor.test.ts --timeout 180000"
  - "bun test tests/unit/codex-work-package-contract.test.ts tests/unit/ci-verification-execution.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-evidence-reuse-contract.test.ts tests/contract/sec-merge-gate.test.ts --timeout 180000"
  - "bun test tests/contract/document-control-plane-lifecycle.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=4dbfc3fe0dcbae5c24ca6f80ac339ae065d1222e bun run imports:check"
  - "SEC_AFFECTED_TESTS_BASE=4dbfc3fe0dcbae5c24ca6f80ac339ae065d1222e bun run test:affected"
  - "bun run docs:doctor"
  - "bun scripts/codex/document-control-plane.ts status --json"
  - "docs-doctor-v10/manifest-scope: exact single-parent base/head/tree plus rename/copy-aware changed-record ownership, zero forbidden paths, manifest raw length/digest, and clean state"
  - "git diff --check 4dbfc3fe0dcbae5c24ca6f80ac339ae065d1222e HEAD --"
  - "GitNexus detect_changes compare against main after final freeze"
---

# Docs-doctor V5 Semantic Superset Bootstrap V1

## Architectural goal

V5 replacement中的scanner补充了required owner、H1、retired V4和Unicode/path意图，但含异常首行，并会删除当前`file:///`、广义repo path与deprecated-token诊断；它不能覆盖main。当前scanner又把frozen Work Package中的runtime相对路径、历史branch路径和计划生成的Evidence误当成当前repo链接，形成八个稳定假阳性。根因不是八份历史文档，而是scanner没有区分active authority、selected manifest、historical contract、explicit link与inline code identifier。

本包把scanner重构为唯一可复用policy engine，CLI与fixture消费同一入口。Canonical owner、Unicode/path、link与控制面规则均产生结构化稳定诊断；`current-state`、pointer、rolling window与manifest digest进入无I/O的`document-control-plane-contract.ts`，live adapter只保留Git/GitHub观察，docs-doctor不再拥有process dispatcher。Contract Freeze直接登记完整positive/negative/differential fixture，避免“当前树0 warning”替代失败语义。

## Revision and manual bootstrap

`origin/main@4dbfc3f`的current V1 authority是v9；Draft #137位于旧base、冲突且无可复用exact-head verification，其proposal V10不是main authority。因本包先执行且修改doctor、workflow namespace、merge evaluator和Contract Freeze trust root，它从v9推进到v10；#137后续必须在新main上重新冻结并按仍存活的实现选择下一revision。

Candidate不得dispatch hosted Scope/Quick/Risk/Full/release。A0只运行manifest列出的本地exact-head Gate各一次；Contract Freeze独占其全部成员，其他focused batch只覆盖未登记的V10 execution/evaluator tests。`manual-bootstrap-required`是预期trust-boundary结果，不是PASS或实现失败。

## Ownership and stop rule

所有changed record必须由唯一task拥有。任何product/runtime/dependency/hook、Goal/replacement source、V2 composition revision、Gate顺序/Evidence schema或未列路径变化都会停止本包并重算。`origin/main`、PR #137 state/head/base/Review/CI、Issue集合、Goal bytes或manifest bytes变化同样使相关证据失效。
