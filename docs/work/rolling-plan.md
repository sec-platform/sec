---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-06
---

# SEC 滚动近期计划

本窗口从 `main@b1220ae333679ac6bf4a181b0242a31ad3d6975f` 和两次全仓审计重算。
`main` 已包含 #280 的产品修复与 post-merge provenance 记录；原 PR #281 的转移仍是
`repaired` 而非 `authorized`，平台防复发继续由 #279 拥有。旧 #282 和旧 PR #273
停留在此前 `repair-only` 事实，不能继续作为当前执行状态。

近期顺序遵循三条硬约束：

1. 先完成当前文档/信息物理收缩，消除重复 owner、原始聊天、历史正文和叙事 Evidence；
2. P0/P1 integrity 只做聚焦修复，不扩成新的治理平台；
3. integrity 闭合后立即回到 Physical Workspace、TypeScript Source Program、Responsibility、
   Workbench 单写路径和 IR-owned Backend 产品纵切片，禁止治理任务无限饥饿产品线。

## 当前唯一 Work Package

### active-documentation-corpus-convergence-v2

- Issue #235；latest-main 重建分支
  `docs/active-documentation-corpus-convergence-v2-rebuild`。
- 将两次审计的稳定结论路由到现有 canonical owners，不提交审计全文，也不新建第二架构总纲。
- 复用旧 #273 的删除、registry v2 和 fixture 迁移作为实现来源；旧 identity、Review 和 Evidence
  全部失效。
- 物理删除 `docs/archive/**`、原始 ChatGPT 对话、叙事性 Evidence/superpowers，保留必要
  fixture 与 byte-exact generated navigation。
- 完成后关闭 #235 和被取代的旧 #273，从新 `main` 激活 #282。

## 条件化候选（最多五项）

### 1. repository-information-lifecycle-v1

- Issue #282；对 exact tracked tree 建立唯一信息生命周期分类和 `unknown = 0` 门禁。
- 扩展现有 repository audit，不创建第二审计系统；报告进入 CI Artifact，默认不 tracked。
- 检测 raw chat、private URL、占位 Evidence、本机路径、stale provider profile、archive current
  consumer、重复 instruction owner、临时输出和未知 retention。

### 2. repository-integrity-closeout-sequence

按独立聚焦包串行执行，不合并成巨型治理 PR：

1. #247 `public-publisher-network-removal-v1`：删除 live-worktree copy 与 force-push 网络入口；
2. #244 `external-input-security-boundary-v1`：GitHub 外部自然语言只作 untrusted data；
3. #248 `ci-git-and-ai-provenance-hygiene-v1`：immutable Action、commit/staged-tree、AI assistance
   provenance 与 no-bypass readback。

每个 child package 都必须删除真实旁路，不能只新增 schema 或说明文档。

### 3. verification-single-truth-and-tcb-bootstrap-v1

- 由 #279、#178、#237、#239 的既有 owner 拆成最小迁移包。
- Physical execution 直接产生 canonical Gate/Claim result；CI、tracked report、GitHub status 和
  CLI 只投影同一结果。
- 删除零 revision/digest、1970 时间、空 argv、自报 health 和 legacy writer 推断。
- TCB builder、schema、frozen lock 与 trusted-base verifier 分层；候选不能用自身 verifier 自证。

### 4. physical-workspace-and-typescript-source-program-v1

- 建立只读 exact repository/workspace/package/file/config/test/workflow/resource/unknown inventory
  和 deterministic snapshot revision。
- 在真实 SEC TypeScript 子系统上产生 module/symbol/type/span/control/data/state/effect candidates，
  保留 unknown/opaque；不把 AST 或 Provider 私有 ID 直接升格为 Engineering authority。
- 与 #224 Responsibility reconstruction 连接，形成首个 Self-Observation / Self-Impact 纵切片。

### 5. product-self-bootstrap-sequence

仍拆成独立 successor，不形成一个大包：

1. `task-envelope-de-specialization-v1`：删除 Customer/Ticket 和固定测试路径特化；
2. `workbench-operation-unification-v1`：Workbench/CLI/HTTP/AI 只提交 Engineering Operation，
   退役直接 `source/app.yaml` writer；
3. `first-ir-owned-backend-v1`：选择一个真实 artifact，经最小 Application/Behavior/Target Program
   IR 和 Backend 生成，并在同一迁移删除旧 template/writer。

## 并行与自动化恢复条件

Issue #207 不再自动排在产品纵切片之前。只有以下事实全部成立后，才激活
`parallel-resolver-correctness-v1-1`：

- ordinary candidate 的 exact-head Review/Gate/merge/readback 路径已连续稳定；
- default branch 无 direct-push/admin bypass；
- Verification 单真值和 TCB bootstrap 已闭合；
- package/lock、docs/work、workflow、Skill registry 和 mutable resources 有唯一 writer；
- 至少一个 Source Program/Responsibility 产品纵切片进入 `main`，证明并行不会继续饥饿产品线。

`unresolved` 永不授权并行。并行开发不等于同时写入 `main`；任一 candidate 先合并后，
剩余 epoch 因 base 变化失效并从新主干重算。

## 可并行只读工作

- #192 Node/Bun × Windows/Linux 物理 capability Evidence；
- #193 latest dependency/provider consumer census；
- #194 compiler cold/warm benchmark 与 pass/artifact census；
- 13K dev-runner authority proof 的独立 oracle、重复 substrate 和 mutation-detection 只读审计。

上述工作不得修改当前 manifest owned paths、package/lock、workflow、control plane 或产品代码；
结果只进入各自 Issue/Evidence owner，不自动取得合并资格。
