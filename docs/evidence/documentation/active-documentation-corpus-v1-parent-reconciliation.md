---
title: Active Documentation Corpus v1 父候选重对齐记录
status: evidence
last-reviewed: 2026-07-29
---

# Active Documentation Corpus v1 父候选重对齐记录

本文是 `active-documentation-corpus-v1` 迁移账本的 candidate identity 补充 Evidence，不是 authority。

## Identity

- original audit parent: `7b86bff6a1afb88c52b86e0f58af83d6a63f87b5`
- current parent PR #196 head: `2ad7227f0330d87c0e25eefa2f45ec26661c9799`
- current parent tree: `b73e4bab166983e7e218782afdc88d57fb9d983e`
- successor branch: `docs/active-corpus-deep-reconciliation-v1`

## Parent delta

父候选在原审计后只闭合 PR #196 的五个 review finding：

1. frozen Work Package Markdown 获得独立 Test Impact classification；
2. Nexus completion counters 先验证 finite non-negative safe integer；
3. rolling plan 补齐 `domain: current-control` 并更新过期措辞；
4. trust-root contract test 删除失效的 `bounded-baseline` 期望；
5. `docs/test-and-package-architecture.md` 原文归档并从 active root 删除。

这些修改不改变迁移账本对旧 00–14、architecture/governance/test corpus 和新领域正文的内容裁决；它们使账本中“由并行执行者处理的五个 review finding”成为已进入当前父 candidate 的历史待办。

## Successor replay

本 successor 的正文/Evidence 文件与上述父 delta 零路径重叠。最终 successor tree 应以 `b73e4bab166983e7e218782afdc88d57fb9d983e` 为 base tree，只重放本分支的文档内容和迁移 Evidence blobs，形成 current parent 的单父提交；不得 merge 旧父 ancestry。

父 PR 后续任何 head/base/manifest/profile 变化都会使本记录和 successor candidate identity 失效，必须重新比较 changed files、三方重放和验证。
