---
schema: codex-development-work-package-v1
id: verification-control-plane-foundation-v1
tracking: issue-311
base: ba5b5c1560604b42725c686062e13fa44a0c6795
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: verification-control-plane-foundation
    owner: verification-control-plane-maintainer
    ownedPaths:
      - docs/work-packages/verification-control-plane-foundation-v1.md
      - docs/work-packages/branch-ref-lifecycle-enforcement-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - scripts/codex/verification-session-contract.ts
      - scripts/codex/verification-session.ts
      - scripts/codex/verification-freeze-session.ts
      - scripts/codex/verification-candidate-tree.ts
      - tests/unit/verification-session-contract.test.ts
      - tests/unit/verification-freeze-session.test.ts
      - tests/unit/verification-candidate-tree.test.ts
      - tests/contract/documentation-authority.test.ts
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
  - "A machine Work Package registry projection lists every frozen manifest on the default branch and in open PRs from the exact resolved base/head, with no hand-maintained duplicate list."
  - "A stable Manifest identity and FreezeSession are separated: a frozen candidate binds base, head, manifest digest and tree digest; the session records one exact candidate tree and one exact verification plan."
  - "A Candidate Tree contract proves the merged tree equals the verified candidate tree for the single session slice."
  - "At least one vertical slice drives the new session path end-to-end from freeze through verification readback, and the branch/ref closeout receipt mechanism from #313 is consumed as an input fact rather than duplicated."
  - "Positive and negative contract tests cover manifest projection identity, freeze session exactness, candidate tree parity and drift rejection."
  - "The final candidate has exact-head Review, required physical verification, expected-head merge, new-main readback and self-closeout evidence through the merged mechanism."
tests:
  - tests/unit/verification-session-contract.test.ts
  - tests/unit/verification-freeze-session.test.ts
  - tests/unit/verification-candidate-tree.test.ts
---

# verification-control-plane-foundation-v1

本包从 `main@d04b2e4c4a3986c82dbe717d6a72d0d397cc8a74` 激活。前驱
`branch-ref-lifecycle-enforcement-v1`（#313）已完全闭合：其 published receipt
机制（prepare/finalize/readback/发布）是本包 Session 的输入事实，不重复建立
第二套发布/readback。

## 根问题

当前 merge/close 路径的证明依赖 PR body locator、single-parent 检查与多 Check
时序拼接（#308/#313 期间已多次出现 exact-head 证据失效）。#311 Phase 0 建立
最小 Verification Session：machine registry projection、稳定 Manifest 与
FreezeSession 分离、Candidate Tree 与单一 Session 纵切片。

## 最小实现闭环

```text
exact base/head + frozen manifest
→ machine registry projection（不手工维护列表）
→ FreezeSession（base/head/manifest/tree 精确绑定）
→ Candidate Tree 契约（merged tree == verified candidate tree）
→ 单一 Session 纵切片端到端
→ 消费 #313 receipt 机制作为输入事实
```

## 非目标

- 不实现完整 Evidence DAG、Queue、Hermetic Runtime 或 Bootstrap 平台；
- 不重写 merge-gate 或 branch lifecycle；
- 不把 PR body、人工文字或旧 Check 拼接当作 Session 证据。

## 迁移边界

- #313 的 published receipt 作为历史输入事实引用，不补写、不重放；
- 新 Session 代码若进入 trust-root（scripts/codex/**），合并需按
  trusted-base manual bootstrap 协议执行并 `TASK_RESTART_REQUIRED`；
- 本包自身合并后必须使用合并后的机制完成 self-closeout。
