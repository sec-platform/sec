---
schema: codex-development-work-package-v1
id: active-documentation-corpus-convergence-v2
tracking: issue-235
base: 4b27555bfcaa146e466227beca9f6c7069f68eaf
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: documentation-corpus-lifecycle-closure
    owner: documentation-maintainer
    ownedPaths:
      - docs/README.md
      - docs/archive/
      - docs/authority.json
      - docs/evidence/
      - docs/scripts/docs-doctor.ts
      - docs/superpowers/
      - docs/work/README.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/active-documentation-corpus-convergence-v2.md
      - docs/work-packages/branch-ref-lifecycle-v1.md
      - platform/shared/documentation-authority-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - tests/contract/docs-doctor-byte-exact.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/documentation-authority.test.ts
      - tests/contract/documentation-corpus-census.test.ts
      - tests/contract/documentation-ownership-closure.test.ts
      - tests/contract/test-impact.test.ts
      - tests/fixtures/documentation-history/
      - tests/fixtures/work-package-gate-manifests/
      - tests/unit/active-documentation-contract.test.ts
      - tests/unit/documentation-authority-registry-v2.test.ts
      - tests/unit/work-package-gate-contract.test.ts
forbiddenPaths:
  - .agents/
  - .github/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - platform/compiler/
  - platform/runtime/
  - scripts/codex/
  - tests/e2e/
  - tsconfig.json
acceptance:
  - "Registry v2 assigns one lifecycle and one canonical owner to every active document; active proposals have explicit disposition, canonical targets, Evidence, activation or reversal conditions and unique non-materialized retirement tombstones."
  - "Every tracked Markdown, YAML and JSON document that looks active is registered or belongs to an explicit machine-only lifecycle; unclassified documents and authority claims under excluded roots fail closed."
  - "Canonical ownership, project, generation and proposal dependencies, case-insensitive paths and retirement tombstones are unique, resolvable and acyclic."
  - "The production registry contains no terminal retire proposal record; completed proposal metadata and source files leave the current tree after consumer migration and main readback."
  - "docs/README.md is a byte-exact generated projection of docs/authority.json; CRLF drift, hand edits and stale proposal rows fail closed."
  - "The tracked docs/archive tree is absent; docs/evidence and docs/superpowers contain no narrative Markdown; reintroduction selects the corpus tests and fails."
  - "Live conformance consumers of retired bytes read exact Git blobs from tests/fixtures, and every fixture path has explicit test-impact ownership."
  - "Git commits, PRs, Issues and Actions artifacts own history and recovery; the current documentation tree contains no second-copy history museum."
  - "All ordering and identity checks introduced by this package consume the shared canonical primitives from main@4b27555b rather than reintroducing locale-dependent comparators or duplicate helpers."
  - "All still-valid task families retain a canonical roadmap or owning Issue; Linux remains a required future owning environment and missing execution remains not-run/unresolved."
  - "The registry parser, docs-doctor and test-impact trust-root migration is not self-authorized; exact-head scope, validation, Review and manual bootstrap are followed by new-main readback and an ordinary successor proof."
tests:
  - tests/contract/docs-doctor-byte-exact.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/documentation-corpus-census.test.ts
  - tests/contract/documentation-ownership-closure.test.ts
  - tests/contract/test-impact.test.ts
  - tests/unit/active-documentation-contract.test.ts
  - tests/unit/ci-pr-risk-selection.test.ts
  - tests/unit/documentation-authority-registry-v2.test.ts
  - tests/unit/work-package-gate-contract.test.ts
---

# active-documentation-corpus-convergence-v2

Issue #235：在 `main@4b27555b` 上再次重建文档语料生命周期。旧候选
`a8602a263a92e6197e5877453277f939f7f4d090` 因未经 PR/CI 的直接主干提交
`4b27555bfcaa146e466227beca9f6c7069f68eaf` 而整体失效；其删除裁决和已核验
blob 只作为设计与数据来源，不复用旧 base、Review 或 CI。

## 状态机

```text
inventory tracked documents and consumers
→ classify canonical / proposal / machine evidence / current control / fixture / delete
→ bind one owner and one lifecycle
→ migrate still-live bytes into explicit fixtures
→ delete archive, completed manifests and narrative evidence/planning copies
→ reject reintroduced history, duplicate owners, stale proposals and unresolved dependencies
→ generate byte-exact navigation
→ freeze exact candidate and independently verify
```

当前树不再使用 `docs/archive/` 保存历史，也不允许 `docs/evidence/` 或
`docs/superpowers/` 堆积叙事性 Markdown。Git commit、PR、Issue 和 Actions artifact
承担历史与恢复；合同测试需要的冻结字节进入 `tests/fixtures/` 并保持原 blob identity。

## 主干变化与治理事故

PR #278 与直接提交 `4b27555b` 的代码结果已经是 `main` 的正式事实，本包保留它们的
shared canonical primitives 与去冗余结果，并用 `compareCodeUnits` / `isPlainObject`
重建 registry parser 与新测试。两次 default-branch transition 缺少完整 Work Package、
Review 和 successful merge gate 的来源问题由 Issue #279 独立拥有；本包不越权修改
`.github/`、ruleset 或 merge workflow。

## Trust-root bootstrap

本包修改 documentation registry parser、docs-doctor 和 test-impact ownership。候选
不能用自己新增的规则给自己授权；必须由 trusted-base scope、candidate-as-SUT
validation、独立 exact-head Review 和适用的 manual bootstrap 完成闭包。

## Linux 与轮子边界

本包不执行 Linux 或第三方轮子物理矩阵。Linux 仍是正式目标环境；未执行 cell 保持
`not-run/unresolved`。#192、#193、#194 的物理矩阵、依赖采用和效率基线继续由各自
owner 维护，不因文档删除而宣称完成。
