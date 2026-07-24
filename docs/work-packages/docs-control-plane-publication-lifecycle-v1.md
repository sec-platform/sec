---
schema: codex-development-work-package-v1
id: docs-control-plane-publication-lifecycle-v1
tracking: none
base: 014abb32e88aa34b789116779d7e07ed1748c91e
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v9
tasks:
  - id: control-plane-publication-lifecycle
    owner: a0
    ownedPaths:
      - AGENTS.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/docs-control-plane-publication-lifecycle-v1.md
      - scripts/codex/document-control-plane.ts
      - tests/contract/document-control-plane-lifecycle.test.ts
forbiddenPaths:
  - .github/
  - .githooks/
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/00-文档索引与一致性规则.md
  - docs/01-用户能力模块化开发-主题整理稿.md
  - docs/02-工程编译器-MVP-PRD与架构稿.md
  - docs/03-MVP实施计划与路线图.md
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
  - docs/superpowers/
  - platform/
  - source/
  - project/
  - control/
acceptance:
  - "The live control-plane resolver reads exact local and remote default heads, Git blob bytes, open GitHub PR/Issue/CI/Review facts, stable current-state facts, and the conditional active pointer without writing repository state."
  - "The persistent current-state spec no longer depends on its own future commit, pull request, review, CI, or squash identity; its resolved view obtains volatile facts at runtime and fails closed when the local default ref is missing or does not match the live remote."
  - "The active pointer uses the SHA-256 of the tested-head Git blob bytes, not checkout bytes, and the shared production resolver returns none when the same path and digest are present on the live default branch."
  - "The current candidate pull request lifecycle is absent from persistent current-state; exact head, Review, CI, and merge evidence remain external exact-head facts."
  - "PR #139 is recorded as merged and is not selected as active; the original replacement package remains an audited unsafe input superseded by selective reconciliation."
  - "The rolling window contains this one bounded package and five dependency-ordered candidates without copying the stable roadmap or creating a permanent backlog."
  - "The lifecycle contract imports the shared resolver and covers real base-to-candidate-to-published Git transitions, a subsequent main change, stale/unavailable default refs, malformed pointers, disabled remote matching, option-shaped Git config, candidate/default-ref binding drift, non-canonical manifest paths, candidate-digest drift, and CRLF-versus-Git-blob identity."
  - "AGENTS and docs/04 direct A0 to the same executable resolver; tests and documentation do not copy a second selector implementation."
  - "The resolver remains under its canonical scripts/codex governance owner; because that directory is part of the V9 verifier trust root, the candidate is integrated only through frozen local evidence, exact diff review, exact-head Scope attestation, and manual bootstrap rather than candidate self-verification."
  - "The exact candidate changes only the eight owned paths and contains no compiler/runtime product, verifier implementation, replacement-source, historical evidence, generated, probe, or artifact drift."
tests:
  - "control-plane-lifecycle: bun test tests/contract/document-control-plane-lifecycle.test.ts --timeout 180000"
  - "active-documentation-focused: bun test tests/unit/active-documentation-contract.test.ts tests/contract/test-impact.test.ts tests/integration/project-runtime.test.ts --timeout 180000"
  - "docs-doctor: bun run docs:doctor"
  - "manifest-contract: parse this frozen manifest with scripts/codex/work-package-contract.ts and attest full base-to-candidate changed records have exactly one owner and no forbidden path"
  - "live-control-plane: bun scripts/codex/document-control-plane.ts status --json"
  - "yaml-parse: parse the exact current-state live spec and both Markdown frontmatter blocks with the repository YAML dependency"
  - "patch-whitespace: git diff --check 014abb32e88aa34b789116779d7e07ed1748c91e --"
  - "gitnexus-compare: detect_changes compare against main after the final candidate is frozen"
  - "hosted-bootstrap: one exact-head Scope attestation; the already-observed Quick trust-root sentinel is manual-bootstrap-required and must not be rerun as candidate self-verification"
---

# Docs Control-plane Publication Lifecycle V1

## Architectural goal

消除三个 versioned控制面对自身未来 publication identity的依赖。#138 合并后需要 #139修正旧 SHA；#139 合并后又立即留下同类 stale状态，证明“再做一个 post-merge文档包”不是闭包，而是无限递归。

本包把 active selection定义为 exact manifest Git blob是否尚未进入 live default branch。候选无需知道未来 commit或 PR；同一 blob进入`main`后选择器确定性解析为`none`。current-state只保存 live resolver配置与不依赖本次 publication identity的稳定事实；共享治理入口运行时读取最新 main/tree、PR/Issue、CI/Review与 active resolution，不把 versioned snapshot伪装为新 head事实。

## Context Capsule

- Base/branch：`origin/main@014abb32e88aa34b789116779d7e07ed1748c91e` / `codex/docs-control-plane-lifecycle-v1`；candidate head与 PR尚未冻结，只能由外部 exact-head evidence绑定。
- Goal：九份用户 V4 Markdown combined revision `sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676`；仓库 mirror为`docs/goals/SEC-Engineering-Workspace-Compiler.md`。
- Replacement：132/132 manifest entries byte/hash自洽，但 installer会删除自身 source、包含损坏脚本与异常 Unicode path，结论仍为 NO-GO；PR #138/#139已选择性吸收有效内容。
- GitHub：唯一开放 PR #137为 Draft/conflicting，remote head `cf0183d495fbc8223fb8e216393f7f20867e653a`，无 Review/thread/`REQUEST_CHANGES`，无 current-main hosted closure；唯一开放 Issue #132为 stale navigation surface。
- Local：dirty root、runtime reconciliation candidate与 legacy roadmap worktree均保留，禁止复制、reset、checkout或清理。
- `gate_owner`：A0 独占本包全部 Gate。`main@014abb3`产品/full/slow/workspace/reference evidence在无 blob交集时仅作 baseline；本包 documentation/test与 Scope evidence必须绑定最终 exact head。`scripts/codex/`是 V9 verifier trust root，run `30056256095` 已在 superseded head确定性返回`manual-bootstrap-required`；不得为了制造 PASS 重发 Quick，最终候选使用冻结本地证据、exact diff/Review、Scope与人工 bootstrap。

## Ownership, state and determinism

八个 owned paths构成一个闭包：`04`拥有 lifecycle语义；`AGENTS.md`只投影统一入口；current-state拥有 live resolver spec与稳定事实；rolling-plan只拥有近期选择；pointer只拥有 selector数据；共享 resolver唯一实现 default-ref freshness、Git blob identity与状态转换；manifest冻结范围；contract test只消费共享 resolver并冻结跨平台和失败语义。

Digest只对 tested-head Git blob bytes计算。Windows checkout的 CRLF工作树 bytes不是 identity；候选必须先进入 index/commit再计算 digest。治理入口通过`git ls-remote`核对 live remote head与本地 default ref；`requireRemoteMatch`只能为`true`，remote/branch/ref必须是 option-safe canonical binding，pointer ref必须与 current-state ref相同，manifest只能选择 canonical Work Package path。外部 Git/GitHub读取禁用交互并设置30秒上限；ref不可解析或不匹配不是“manifest尚未合并”，而是`unresolved`。GitHub开放 PR/Issue 与各 PR 的 Review thread读取均为有界 fail-closed，分页截断不得伪装成完整事实。ref存在但 path缺失才是 active候选。candidate blob与 pointer digest不一致是 invalid candidate，必须重新冻结。

## Stop, reload and reconciliation

以下任一条件触发停止并从最新 resolved facts重算：live/default main不一致；Goal九文件集合或 revision变化；PR #137 state/head/base/Review/CI变化；新的开放 PR/Issue出现；任何 owned path需要扩大到 stable roadmap、compiler/runtime product、verifier implementation、既有 resolver 以外的`scripts/codex/`文件或其他 CI trust root；changed records不再恰好由本 manifest唯一拥有；GitNexus发现新的 consumer或前置条件。

完成前必须返回 tested base/head、changed paths/symbols、authority与acceptance delta、focused/hosted results、可复用与失效 evidence、blocker、next ready seam，以及 `inspect_ms`、`implement_ms`、`focused_validation_ms`、`wait_ms`、`reconcile_ms`、`context_reload_count` 与 `duplicate_gate_count`。只有 merge后的新`main`、测试、CI、Review和真实 artifact能证明本包完成。
