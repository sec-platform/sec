---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-04
---

# SEC 滚动近期计划

本窗口从 `main@44f40125` 的 canonical architecture convergence、完成的旧 PR/branch 人工收口和当前 `branch-ref-lifecycle-v1` 候选重算。当前先把 branch/ref/PR/worktree/recovery closeout 机器化；其后不直接扩大并行，而是先完成 active documentation corpus 的物理收缩，避免多个 Agent 在重复、历史和非权威文档上并行产生分叉。

## 当前唯一 Work Package

### branch-ref-lifecycle-v1

- Issue #269 / PR #270；唯一 owner 同时观察 local/remote refs、PR、active resolver、全部 worktree、GitHub auto-delete setting 与 clone prune config，并提供 clone-local prune 配置与 readback 入口。
- 删除前冻结 exact branch/PR identity，并在仓库及所有 worktree 之外创建、校验、摘要和持久写入 recovery bundle。
- remote 使用 expected-SHA force-with-lease CAS；local 使用 old-SHA `update-ref` CAS；任何 worktree binding、local/remote 分叉或准备后新出现/变化的 local ref 都保护或阻塞，绝不强删。
- merge bootstrap 删除旧 post-merge pointer patch 和 best-effort cleanup；先 recovery，再 exact-head merge，再 new-main/readback/receipt。
- 真实临时仓库必须证明：remote branch 删除成功，同时 dirty user-owned worktree 与 local branch 原样保留。

## 候选 Work Package

### 1. active-documentation-corpus-convergence-v2

- Issue #235；对全部 Markdown/YAML/JSON 文档执行唯一 lifecycle/disposition census，要求 `unclassified = 0`。
- 区分 canonical authority、generated navigation、current control、machine ledger、corpus、Evidence、research、proposal、historical/archive 与 delete；没有独立责任、真实 consumer 和保留理由的内容合并或删除。
- 净删除重复 owner、失效路线、动态事实、长期 active proposal 和 AI 式过程文字；archive/Evidence 不进入默认 orientation、selector、test-impact 或 current authority。
- 收敛三条唯一入口：产品理解、领域实现、当前任务；`docs/README.md` 继续由 `docs/authority.json` 生成并 byte-readback。
- 本包不提前设计 R3–R16 的完整字段宇宙，也不成为无限文档前置。完整执行裁决记录在 Issue #235。

### 2. parallel-resolver-correctness-v1.1

- Issue #207；修正 `requires`、`orderedAfter`、`conflictsWith`、authority/path/resource/global-writer 语义并建立 exact-base Integration Epoch Registry。
- `unresolved` 永不授权并行；本包在自身进入 `main` 前保持唯一 formal Work Package，不能使用旧 resolver 给自己授权。
- 进入新 `main` 并 readback 后，才允许两个以上正式 Work Package 通过完整 pairwise matrix 获得并行资格。

### 3. public-publisher-network-removal-v1

- 删除 `scripts/publish-public.ts` 与 `package.json` 的危险网络写入口；禁止 live-worktree copy、替代历史和 force-push publication，保留未来 exact-tree 只读 readiness preflight。

### 4. task-envelope-de-specialization-v1

- 删除 Customer/Ticket 特化 selector；由 Acceptance、Impact、ownership 与 capability binding 派生测试闭包，并以三个无关领域证明 Core 无业务名称分支。

### 5. physical-workspace-observation-v1

- 建立只读 exact repository/workspace/package/file/config/test/workflow/resource/unknown inventory 与 deterministic snapshot revision；不执行不受信 install/build/test，不提前取得 mutation authority。

## 首个 Integration Epoch

#207 进入 `main` 后，对以下三个候选重新冻结 exact-base manifests 并逐对解析：

```text
public-publisher-network-removal-v1
task-envelope-de-specialization-v1
physical-workspace-observation-v1
```

只有 authority、paths、global writers、mutable resources、worktrees 和 Evidence keys 全部为 `parallel-safe` 时才同时激活。并行开发不等于同时写入 `main`；任一候选先合并后，剩余 epoch 因 base 变化失效并从新主干重算。

## 后继与条件边界

- `external-input-security-boundary-v1` 继续由 Issue #244 拥有；默认在首个 Integration Epoch 后激活，若出现现实外部输入 P1 或公开协作前置则提升优先级。
- `typescript-source-program-model-skeleton-v1` ordered-after `physical-workspace-observation-v1` 的新-main readback；不能与自己的 R3 前置并行。
- Issue #186 继续拥有 worktree registry 与物理目录清理；branch lifecycle 只消费其 completed receipt 或保留 `protected-pending`。
- Issue #248、#256、#216 等仓库卫生、排版和 release 修复按真实风险/consumer 交错进入，不组成自动治理队列。
- canonical-architecture-convergence-v1 已进入 `main@44f40125`，当前候选原子接管 pointer 后将其 manifest 归档。
