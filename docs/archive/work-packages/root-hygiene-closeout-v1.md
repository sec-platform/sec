---
schema: codex-development-work-package-v1
id: root-hygiene-closeout-v1
tracking: issue-132
base: aa2355a80041f0cfd41563f58ce0208837c19beb
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v11
tasks:
  - id: close-root-branch-and-worktree-hygiene
    owner: a0
    ownedPaths:
      - .claude/settings.json
      - docs/work-packages/root-hygiene-closeout-v1.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .github/
  - .gitattributes
  - .githooks/
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
  - "The repository no longer tracks the user-machine-specific .claude/settings.json permission allowlist."
  - "The SM-4A trusted authorization ingress replay is recorded only after PR #144, hosted Quick, sec/merge-gate, and main integration provide real completion evidence; it is not recorded as completion of the remaining P1 shared adapter and thin CLI/Workbench transports."
  - "The root AGENTS.md is byte-identical to the canonical main blob; generated GitNexus text is not committed as repository policy."
  - "Untracked Goal/V4 and SEC_docs_v5_replacement inputs are deleted only after their canonical mirror, migration audit, manifest digest, and governance provenance are revalidated from latest main."
  - "All completed local and remote task branches and all auxiliary worktrees are removed; the root worktree is clean main and exactly matches origin/main."
  - "The first candidate head 236485b3aca07b103698fb93a331437b50f1f755 remains a permanent hosted Quick preflight failure with changed-files-unresolved and zero executed Gates."
  - "The successor uses A0 manual bootstrap because adding a permanent CI ownership rule for deletion of one retired machine-specific file would preserve the wrong authority; docs doctor, control-plane lifecycle, manifest scope, patch hygiene, scope attestation, and Review must pass."
tests:
  - "docs-doctor: bun run docs:doctor"
  - "control-plane-lifecycle: bun test tests/contract/document-control-plane-lifecycle.test.ts --timeout 180000"
  - "manifest-scope: every base-to-head tracked path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check aa2355a80041f0cfd41563f58ce0208837c19beb HEAD --"
  - "manual-bootstrap: independent exact scope and Review after the permanent hosted Quick preflight failure"
  - "post-merge-local-hygiene: root clean, main...origin/main 0/0, local branches main only, remote heads main only, worktrees root only"
---

# Root Hygiene Closeout V1

本包移除机器专属的 Claude permission allowlist，更新 SM-4A trusted authorization ingress replay 的 `main` 完成事实（不等同于整个 P1 完成），并把最终本地/远端 branch、worktree 与未跟踪输入清理纳入一个有边界的 post-merge closeout。未跟踪输入不是候选内容；只有在 latest-main provenance 复核后才物理删除。首个 hosted Quick 因删除路径没有 test-impact owner 而在 preflight 永久失败；本包不为一次性退役文件增加永久 selector 特例，successor 由 A0 依据 exact scope、文档合同与 Review 做 manual bootstrap。
