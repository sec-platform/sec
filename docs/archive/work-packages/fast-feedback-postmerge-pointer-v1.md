---
schema: codex-development-work-package-v1
id: fast-feedback-postmerge-pointer-v1
tracking: issue-132
base: a370236e92518abb83c10afbe955010c589e3e2f
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v16
tasks:
  - id: reconcile-fast-feedback-active-pointer
    owner: a0
    ownedPaths:
      - docs/work-packages/fast-feedback-postmerge-pointer-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .github/
  - .githooks/
  - AGENTS.md
  - README.md
  - docs/00-文档索引与一致性规则.md
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/architecture/
  - docs/archive/
  - docs/evidence/
  - docs/goals/
  - docs/governance/
  - docs/scripts/
  - package.json
  - platform/
  - scripts/
  - source/
  - tests/
  - tsconfig.json
acceptance:
  - "The active pointer binds the exact Git blob digest of this frozen postmerge manifest instead of the pre-sampling fast-feedback manifest digest."
  - "The candidate resolver selects this manifest, and the published default-branch resolver returns none with matching-default-blob."
  - "The rolling plan selects this postmerge reconciliation package without changing the next-ready product seam."
  - "No product, test, verifier, workflow, architecture, stable roadmap, evidence, or generated output changes."
tests:
  - "docs-doctor: bun run docs:doctor"
  - "control-plane-lifecycle: bun test tests/contract/document-control-plane-lifecycle.test.ts --timeout 180000"
  - "manifest-scope: both base-to-head paths have one owner and no forbidden path changes"
  - "patch-whitespace: git diff --check a370236e92518abb83c10afbe955010c589e3e2f HEAD --"
  - "post-publication-resolver: matching default manifest blob resolves active Work Package to none"
---

# Fast Feedback Postmerge Pointer V1

本包只修复 PR #152 合并 readback 暴露的 active pointer digest 漂移。性能样本进入 frozen manifest 后，旧 pointer 仍绑定采样前 digest，导致控制面 fail closed 为 `candidate-digest-mismatch`；本包把 pointer 和 rolling plan 改绑到这个独立、冻结的 postmerge manifest。候选分支解析为唯一 active manifest，完全相同的 blob 进入 default branch 后解析为 `matching-default-blob`，不会形成自追尾任务。
