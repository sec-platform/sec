---
schema: codex-development-work-package-v1
id: branch-ref-lifecycle-enforcement-v1
tracking: issue-313
base: bd54653bdcb60296b82b1f567de44823ca1a776b
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: branch-ref-lifecycle-enforcement
    owner: branch-lifecycle-maintainer
    ownedPaths:
      - docs/work-packages/implementation-resolution-architecture-convergence-v1.md
      - docs/work-packages/branch-ref-lifecycle-enforcement-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - scripts/codex/branch-lifecycle-audit.ts
      - scripts/codex/branch-lifecycle-contract.ts
      - scripts/codex/branch-lifecycle-health.ts
      - scripts/codex/branch-lifecycle-inventory.ts
      - scripts/codex/branch-lifecycle-parsers.ts
      - scripts/codex/branch-lifecycle-types.ts
      - scripts/codex/branch-closeout.ts
      - scripts/codex/branch-closeout-receipt.ts
      - scripts/codex/branch-lifecycle.ts
      - scripts/codex/sec-merge-bootstrap-runtime.ts
      - scripts/codex/repository-audit.ts
      - tests/contract/documentation-authority.test.ts
      - tests/contract/repository-audit.test.ts
      - tests/unit/branch-lifecycle-contract.test.ts
      - tests/unit/branch-closeout-receipt.test.ts
      - tests/unit/branch-lifecycle-temp-repo.test.ts
      - tests/unit/sec-merge-bootstrap.test.ts
forbiddenPaths:
  - .agents/
  - .github/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/authority.json
  - docs/archive/
  - docs/evidence/
  - docs/scripts/
  - platform/
acceptance:
  - "PR #308 is read back from main@38a5bf80 and its completed architecture manifest is retired from docs/work-packages/."
  - "The active pointer and rolling plan select only branch-ref-lifecycle-enforcement-v1 from main@38a5bf80."
  - "Remote branch absence alone cannot satisfy closeout; every post-enforcement merged, closed-superseded or completed-spike branch requires a durable machine-readable receipt."
  - "A supported merge or close path that cannot publish/read back its receipt returns blocked or residue and cannot report clean completion."
  - "Admin, web or connector bypass is detected by repository health and produces degraded/locked state rather than a clean projection."
  - "Receipt identity binds repository, PR where applicable, exact prepared head, disposition, durable goal, remote/local actions, readback and receipt digest."
  - "Legacy PRs whose base predates the enforcement marker are not retroactively claimed as compliant; they remain historical facts."
  - "Closed-unmerged, completed-spike and merged dispositions have positive, negative and failure tests."
  - "Squash tree absorption is distinguished from commit ancestry when authorizing closeout."
  - "Remote SHA drift between prepare and finalize fails CAS deletion."
  - "Dirty, unknown, locked or worktree-bound local branches remain protected-pending with an actionable owner."
  - "GitHub delete_branch_on_merge and clone prune settings remain explicit audited requirements."
  - "The documentation authority test validates pointer/rolling-plan relational consistency instead of hard-coding each active package name."
  - "The final candidate has exact-head Review, required physical verification, expected-head merge, new-main readback and self-closeout evidence."
tests:
  - tests/contract/documentation-authority.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/unit/branch-lifecycle-contract.test.ts
  - tests/unit/branch-closeout-receipt.test.ts
  - tests/unit/branch-lifecycle-temp-repo.test.ts
  - tests/unit/sec-merge-bootstrap.test.ts
---

# branch-ref-lifecycle-enforcement-v1

本包从 `main@38a5bf80c24ea8703e7ed9a7aff3b7a920d95aff` 接管当前唯一正式写入闭包。
前驱 `implementation-resolution-architecture-convergence-v1` 已通过 PR #308 进入 `main`；其稳定架构结果保留，
但旧 manifest、candidate identity、Review 和 Evidence 不授予本包任何 authority。

## 根问题

PR #270 已实现 branch inventory、durable recovery、exact-SHA CAS 删除、本地 exact ref 删除、prune、
readback 和 typed receipt。PR #308 后远程 heads 已只剩 `main`，但 GitHub 记录中没有可发现的逐 ref
prepare/finalize receipt，也没有 #308 durable closeout receipt。现有 audit 能发现残留 ref，却不能在 ref
已被旁路删除后证明 terminal protocol 曾执行。

因此当前成熟度是：

```text
implementation entered main
+ remote cleanup happened
- terminal receipt enforcement
- bypass detection
- self-closeout proof
```

## 最小实现闭环

```text
prepare exact branch / PR / recovery authority
→ merge or close disposition
→ exact main / PR readback
→ remote/local/prune finalize
→ publish durable receipt
→ repository health verifies receipt
→ completed | protected-pending | residue | blocked
```

受支持入口必须复用同一 receipt contract。无法物理禁止的 admin/web/connector 旁路由 repository health
检测；不能用“远程分支已经不存在”推断其曾经过安全 closeout。

## 迁移边界

- 仅对 enforcement marker 已存在于 PR base 的后继操作强制 receipt，避免伪造历史合规；
- #308 和此前操作保留为历史不合规/不可证明样本，不补写虚假 receipt；
- 本包自身合并后必须使用候选实现完成 self-closeout；
- #311 后续将把 receipt 纳入统一 Verification Session；本包不预建完整 V3；
- #282 的 47,287 行删除迁移 census 只读并行，本包不修改其信息生命周期领域。

## 非目标

- 不恢复历史分支；
- 不重写完整 Verification Control Plane；
- 不把 branch 当测试参数；
- 不把 GitHub comment、PR body 或人工文字单独当 receipt；
- 不修改产品架构、package/lock、workflow或产品源码；
- 不以扩大 timeout、重复运行或 admin merge绕过失败。
