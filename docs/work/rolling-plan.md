---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-04
---

# SEC 滚动近期计划

本窗口从 `main@44f40125`、远端仅 `main`、开放 PR 为零、formal active Work Package 为 none 的物理归一状态重算。人工清理已经完成，但 merge bootstrap 的宽松删除、缺失 exact-SHA CAS、缺失 durable recovery/readback/typed receipt 和 dirty worktree 正式分类，使同类 stale refs 仍可再次积累。Issue #269 因用户明确要求与现实误删风险，从条件 P2 提升为当前聚焦治理包。

## 当前唯一 Work Package

### branch-ref-lifecycle-v1

- Issue #269；唯一 owner 同时观察 local/remote refs、PR、active resolver、全部 worktree、GitHub auto-delete setting 与 clone prune config，并提供 clone-local prune 配置与 readback 入口。
- 删除前冻结 exact branch/PR identity，并在仓库及所有 worktree 之外创建、校验、摘要和持久写入 recovery bundle。
- remote 使用 expected-SHA force-with-lease CAS；local 使用 old-SHA `update-ref` CAS；任何 worktree binding、local/remote 分叉或准备后新出现/变化的 local ref 都保护或阻塞，绝不强删。
- merge bootstrap 删除旧 post-merge pointer patch 和 best-effort cleanup；先 recovery，再 exact-head merge，再 new-main/readback/receipt。
- 真实临时仓库必须证明：remote branch 删除成功，同时 dirty user-owned worktree 与 local branch 原样保留。

## 候选 Work Package

### 1. public-publisher-network-removal-v1

- 删除 `scripts/publish-public.ts` 与 `package.json` 的危险网络写入口；保留未来只读 readiness preflight。

### 2. external-input-security-boundary-v1

- 最小化 GitHub 外部文本进入 Agent current state 的边界；只允许 bounded metadata 和显式 maintainer adoption。

### 3. task-envelope-de-specialization-v1

- 删除 Customer/Ticket 特化 selector；由 Acceptance、Impact、ownership 与 capability binding 派生测试闭包。

### 4. physical-workspace-observation-v1

- 建立只读 exact workspace/file/config/test/workflow/resource/unknown inventory 与 deterministic snapshot revision。

### 5. typescript-source-program-model-skeleton-v1

- 建立 file/module/symbol/declaration/span/import/export/definition/reference 的首个真实 TypeScript 纵切片。

## 条件与边界

- Issue #186 继续拥有 worktree registry 与物理目录清理；本包只消费其 completed receipt 或保留 `protected-pending`。
- Issue #191 继续拥有多包并行与 Integration Queue；本包不借 branch lifecycle 自授权并行。
- Issue #248 的通用 repository hygiene 继续保留，但不复制 branch/ref closeout 状态机。
- canonical-architecture-convergence-v1 已进入 `main@44f40125`，本候选原子接管 pointer 后将其 manifest 归档。
