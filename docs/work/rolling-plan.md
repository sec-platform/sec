---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-06
---

# SEC 滚动近期计划

本窗口从 `main@44f40125` 的 canonical architecture convergence、完成的旧 PR/branch 人工收口和当前 `branch-ref-lifecycle-v1` 候选重算。当前先把 branch/ref/PR/worktree/recovery closeout 机器化；其后不直接扩大并行，而是先完成 active documentation corpus 的物理收缩，避免多个 Agent 在重复、历史和非权威文档上并行产生分叉。

## 当前唯一 Work Package

### default-branch-health-repair-v2

- exact base: `main@b1220ae333679ac6bf4a181b0242a31ad3d6975f`；tracking: Issue #280；PR #289 保持 Draft。
- imports：三个最初报告文件与全树追加发现的 11 个文件均为真实 import-organization defect；本包修复完整 14 文件，不存在 `pre-existing/non-blocking` 排除。
- control plane：canonical resolver 允许 selected manifest 在 default branch 保留到 successor 原子接管；唯一错误 owner 是 repository-audit 的 `control-plane-selected-manifest-already-on-default` 分支，正向 retained-manifest 与负向 digest-drift/missing-manifest 均须执行验证。
- revision health：源码只保留 external physical-Evidence schema、严格验证与 exact-subject projection；命令结果、UTC、workspace、artifact digest、producer/recorder identity 必须由执行器从真实 artifact 生成。
- trust-root delta 共五个路径：三个 evidence contract 文件仅 import organization；`repository-audit.ts` 修错误 owner；新增 revision-health physical Evidence producer。bootstrap 方式必须由最终 exact-head trusted-main 合同与 Gate 实际裁决，不预写成功结论。
- 完成门：fresh COMMENT Review、exact scope、frozen verification、适用 trust bootstrap、successful `sec/merge-gate`、expected-head squash、new-main readback 与 control-plane/Issue closeout。任何能力缺失时 #280 保持 open。
- 边界：不修改或启动 #273/#274/#276，不使用 admin merge。

## 已完成 Work Package

### default-branch-health-repair-v1 (PR #281 + PR #283)

- 已合并至 `main@b2e538ae`（PR #281 admin-squash），receipt 追加于 `main@b1220ae3`（PR #283）。manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：Issue #280 v1 — 修复 unauthorized commit `0c9cf1e4` 引入 `canonical-primitives.ts` 导致的 TCB closure 从 60 扩展到 61 但 `sec-merge-gate.test.ts` 仍断言 `toBe(60)` 的 test drift。建立 generated exact TCB closure lock 绑定 61 个模块身份/digest/blob/edge；测试改为断言 lock identity 而非硬编码计数；CRLF→LF 行尾归一化确保跨 worktree 一致。
- post-merge closure 审计失败：receipt 不合规（headRevision 过时、时间戳为未来、自声明 trusted、缺少执行元数据）、audit 产生 false positive finding、14 个 imports:check 失败未修复。由 v2 接管根因闭包。

## 候选 Work Package

### 1. active-documentation-corpus-convergence-v2

- Issue #235；对全部 Markdown/YAML/JSON 文档执行唯一 lifecycle/disposition census，要求 `unclassified = 0`。
- 区分 canonical authority、generated navigation、current control、machine ledger、corpus、Evidence、research、proposal、historical/archive 与 delete；没有独立责任、真实 consumer 和保留理由的内容合并或删除。
- 净删除重复 owner、失效路线、动态事实、长期 active proposal 和 AI 式过程文字；archive/Evidence 不进入默认 orientation、selector、test-impact 或 current authority。
- 收敛三条唯一入口：产品理解、领域实现、当前任务；`docs/README.md` 继续由 `docs/authority.json` 生成并 byte-readback。
- 本包不提前设计 R3–R16 的完整字段宇宙，也不成为无限文档前置。完整执行裁决记录在 Issue #235。

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
