---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-04
---

# SEC 滚动近期计划

本窗口从已包含 PR #270 的 `main@c9d03ba7` 与当前 ignored `.tmp` 物理状态重算。branch/ref/PR/worktree/recovery closeout 已进入主干；当前唯一正式包以该新主干为 exact base，建立 repository-generated state lifecycle，并 byte-identical 归档前驱 manifest。

## 当前唯一 Work Package

### generated-state-lifecycle-v1

- Issue #271；建立 `.tmp/**` 的 closed registry，逐项绑定 owner、class、reconstruction、cleanup profile 和 settlement effect；unknown、recovery 与 identity-bound control 默认 fail closed。
- test-run namespace 在 fixture 创建前发布 `sec-generated-state-owner-v1`；automatic 只回收可证明 owner 已死亡的运行实例，不再依赖历史 `activeCount > 500` 阈值。
- Cleanup 冻结 root identity 与 descendant physical snapshot，同盘 quarantine 后 no-follow 删除，并以 ENOENT/readback、before/after blocker sets 与 typed receipt闭合；interrupted transaction 只在 quarantine identity/snapshot仍匹配时恢复。
- `safe` 只再清理超过宽限的 legacy workspace 和过期 diagnostic；`all-rebuildable` 才删除已登记 cache/toolchain state。Active、cross-host、malformed owner、reparse、changed-after-plan、recovery、control 和 unknown 都不进入普通删除集。
- `environment:settle` 联合 tracked Git materialization 与 ignored generated-state inventory；`--fix` 只有在 tracked worktree 已安全 settled 后才执行 safe cleanup。
- 当前候选直接基于 `main@c9d03ba7`；只有 exact-head hosted Evidence、独立 Review 与 merge readback闭合后才可进入主干。

## 已排序前驱

### branch-ref-lifecycle-v1

- Issue #269 / PR #270 已进入 `main@c9d03ba7`；继续拥有 branch/ref/PR/worktree binding、durable recovery 和 exact-SHA closeout transaction。
- 本包不复制其 recovery owner；仓库内 `.tmp/recovery` 只报告 `invalid-location`，由 #269/#270 迁移到全部 repository/common-dir/worktree root 之外。
- 前驱 active manifest byte-identical 归档；本 successor不复制其状态机，只消费已经进入主干的 durable recovery边界。

## 候选 Work Package

### 1. active-documentation-corpus-convergence-v2

- Issue #235；对全部 Markdown/YAML/JSON 文档执行唯一 lifecycle/disposition census，要求 `unclassified = 0`。
- 区分 canonical authority、generated navigation、current control、machine ledger、corpus、Evidence、research、proposal、historical/archive 与 delete；没有独立责任、真实 consumer 和保留理由的内容合并或删除。
- 净删除重复 owner、失效路线、动态事实、长期 active proposal 和 AI 式过程文字；archive/Evidence 不进入默认 orientation、selector、test-impact 或 current authority。
- 收敛三条唯一入口：产品理解、领域实现、当前任务；`docs/README.md` 继续由 `docs/authority.json` 生成并 byte-readback。

### 2. parallel-resolver-correctness-v1-1

- Issue #207；修正 `requires`、`orderedAfter`、`conflictsWith`、authority/path/resource/global-writer 语义并建立 exact-base Integration Epoch Registry。
- `unresolved` 永不授权并行；本包在自身进入 `main` 前保持唯一 formal Work Package，不能使用旧 resolver 给自己授权。
- 进入新 `main` 并 readback 后，才允许两个以上正式 Work Package 通过完整 pairwise matrix 获得并行资格。

### 3. public-publisher-network-removal-v1

- 删除 `scripts/publish-public.ts` 与 `package.json` 的危险网络写入口；禁止 live-worktree copy、替代历史和 force-push publication，保留未来 exact-tree 只读 readiness preflight。

### 4. task-envelope-de-specialization-v1

- 删除 Customer/Ticket 特化 selector；由 Acceptance、Impact、ownership 与 capability binding 派生测试闭包，并以三个无关领域证明 Core 无业务名称分支。

### 5. physical-workspace-observation-v1

- 建立只读 exact repository/workspace/package/file/config/test/workflow/resource/unknown inventory 与 deterministic snapshot revision；不执行不受信 install/build/test，不提前取得 mutation authority。
- 它消费 generated-state inventory 作为 repository-local ignored-state projection，不复制 cleanup owner或把 R3 全量 observation塞回本包。

## 首个 Integration Epoch

#207 进入 `main` 后，对以下三个候选重新冻结 exact-base manifests并逐对解析：

```text
public-publisher-network-removal-v1
task-envelope-de-specialization-v1
physical-workspace-observation-v1
```

只有 authority、paths、global writers、mutable resources、worktrees 和 Evidence keys 全部为 `parallel-safe` 时才同时激活。并行开发不等于同时写入 `main`；任一候选先合并后，剩余 epoch 因 base 变化失效并从新主干重算。

## 后继与条件边界

- `external-input-security-boundary-v1` 继续由 Issue #244 拥有；默认在首个 Integration Epoch 后激活，若出现现实外部输入 P1 或公开协作前置则提升优先级。
- `typescript-source-program-model-skeleton-v1` ordered-after `physical-workspace-observation-v1` 的 new-main readback；不能与自己的 R3 前置并行。
- Issue #190 继续拥有测试进程、端口、浏览器和 runtime cleanup receipt；generated-state只拥有 repository-local path lifecycle与其 owner facts投影。
- Issue #186 继续拥有 Git worktree registry 与物理目录清理；generated-state不得扫描或删除 repository worktree root。
- Issue #248、#256、#216 等仓库卫生、排版和 release 修复按真实风险/consumer交错进入，不组成自动治理队列。
