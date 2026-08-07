---
schema: codex-development-work-package-v1
id: repository-information-lifecycle-v1
tracking: issue-282
base: f6ddbfe441bdafe3f22e12b1fb08e4899242a7e7
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: repository-information-lifecycle
    owner: repository-information-lifecycle-maintainer
    ownedPaths:
      - docs/work-packages/repository-information-lifecycle-v1.md
      - docs/work-packages/verification-control-plane-foundation-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - scripts/codex/repository-audit.ts
      - scripts/codex/verification-session.ts
      - docs/governance/nexus-absorption-ledger.yaml
      - tests/contract/repository-audit.test.ts
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
  - "Every removed or renamed blob in the exact `2d7187f4... → 6cbe65d8...` delta has a machine-readable disposition (code/test-owned, migrated, historical-git-only, extract-required or unresolved); no claim is left without an owner."
  - "The 47,287 deleted lines are not restored as an old archive; dispositions reference the exact Git history instead."
  - "The Nexus absorption ledger `bound: 0 / expected: 29` gap is either bound per entry or explicitly blocked with evidence for each unbound entry."
  - "The existing repository audit is extended; no second audit system is created."
  - "Positive and negative contract tests cover disposition classification, ledger binding and unknown fail-closed behavior."
  - "The final candidate has exact-head Review, required physical verification, expected-head merge, new-main readback and self-closeout evidence through the merged mechanism."
tests:
  - tests/contract/repository-audit.test.ts
  - tests/contract/documentation-authority.test.ts
---

# repository-information-lifecycle-v1

本包从 `main@f6ddbfe441bdafe3f22e12b1fb08e4899242a7e7` 激活。前驱
`verification-control-plane-foundation-v1`（#311）已闭合（PR #322/#323 进入
`main`，terminal closeout receipt 已发布）。#311 的 Verification Session
registry/FreezeSession/Candidate Tree 作为本包审计的机器事实来源。

## 根问题

PR #284 删除 47,287 行后，removed/renamed blobs 没有逐 claim 的 disposition；
Nexus 吸收 ledger 的 29 个 EPR 中 `bound: 0`。信息生命周期没有机器可验证的
closure，任何对话或历史文本都不能替代。

## 最小实现闭环

```text
exact current tree + 2d7187f4→6cbe65d8 removed/renamed blobs
→ 逐 claim disposition（code/test-owned | migrated | historical-git-only | extract-required | unresolved）
→ Nexus ledger 逐项绑定或显式阻塞
→ 扩展现有 repository audit（不建第二系统）
→ 机器契约测试闭包
```

## 非目标

- 不恢复 47,287 行旧 archive；
- 不建立第二审计系统；
- 不把旧对话或历史文本恢复为 authority；
- 不重写 Verification Control Plane。

## 迁移边界

- `2d7187f4... → 6cbe65d8...` 的 blob 身份以 exact Git 历史为准；
- #317（受限递归 Engineering Composition）与 #318（Semantic Engineering
  Benchmark）是审计识别出的后继 owner，不在本包实现；
- 本包自身合并后必须使用合并后的机制完成 self-closeout。
