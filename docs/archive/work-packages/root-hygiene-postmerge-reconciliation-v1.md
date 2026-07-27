---
schema: codex-development-work-package-v1
id: root-hygiene-postmerge-reconciliation-v1
tracking: issue-132
base: f1df074b8080b97882ff2afd3b1a110ce42512c4
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v11
tasks:
  - id: publish-postmerge-control-plane-facts
    owner: a0
    ownedPaths:
      - docs/work-packages/root-hygiene-postmerge-reconciliation-v1.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .github/
  - .gitattributes
  - .githooks/
  - .claude/
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/00-文档索引与一致性规则.md
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
  - docs/scripts/
  - platform/
  - scripts/
  - source/
  - tests/
acceptance:
  - "current-state records PR #145 and main f1df074b8080b97882ff2afd3b1a110ce42512c4 as the completed root-hygiene integration, while preserving the permanent failed Quick boundary."
  - "current-state distinguishes the in-main trusted authorization ingress from the unfinished P1 shared adapter and thin CLI/Workbench transports."
  - "rolling-plan is recomputed from latest main and keeps the remaining P1 closure before P2."
  - "The active pointer selects this manifest only on the candidate branch and resolves to none after the identical manifest blob is published on the live default branch."
  - "No product, verifier, Goal, architecture, canonical governance, test, workflow, package, or repository policy path changes."
tests:
  - "docs-doctor: bun run docs:doctor"
  - "control-plane-lifecycle: bun test tests/contract/document-control-plane-lifecycle.test.ts --timeout 180000"
  - "manifest-scope: every base-to-head tracked path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check f1df074b8080b97882ff2afd3b1a110ce42512c4 HEAD --"
  - "post-publication-resolver: matching default manifest blob resolves active Work Package to none"
---

# Root Hygiene Postmerge Reconciliation V1

本包只发布已经发生的合并与物理清理事实，并把滚动窗口恢复到长期路线图规定的 P1 剩余闭包。它不启动产品实现；manifest 进入 default branch 后，共享 resolver 因 `matching-default-blob` 返回 `none`，不会形成自追尾控制面任务。
