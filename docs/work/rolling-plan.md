---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-28
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@a490a42f5bc8c1b834aad6560360888411cb45c9`、全部本地/远端 branch census、PR/Issue/Review/CI 和 exact tree 重新计算。PR #184 已完成 development feedback trust epoch；PR #174 的同一 production SM-3 apply sentinel 单独通过、在 affected 并发 wave 中失败，证明 runner resource classification 是产品候选之前必须独立进入 `main` 的 trust-root prerequisite。

```text
Fast Runner Resource Isolation
→ Portable Atomic Workspace Lease
→ Active Documentation Corpus
→ Verification Result Truth
→ Remaining Runtime / Toolchain Seams
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if` 与最终 reconciliation 更新本文件。

## 当前唯一 Work Package

### verification-fast-runner-resource-isolation-v1

- 工程结果：fast process registry 只声明资源类别，`bounded-parallel` / `exclusive` 从类别唯一推导，禁止原因与调度形成竞争事实。
- 直接闭包：运行 production host/browser/runtime lifecycle 的 SM-3 apply suite 必须 exclusive；完全绑定 run-owned mutable state 的 recovery 和其他 suites 继续有界并行。
- 范围边界：本包只解除 PR #174 暴露的 runner prerequisite，不实现 Issue #176 的 result/platform ledger、skip 或 affected 空选择语义。
- 退出：single-parent candidate、focused/typecheck/docs/audit/imports、独立 exact-head Review 和受信 base bootstrap 全部闭合；本包改变 dev-runner trust root，进入 main 后返回 `TASK_RESTART_REQUIRED`。

## 候选 Work Package

### 1. workspace-write-lease-portability-v1

- 工程结果：以 Node 标准能力实现单一 portable lease protocol，保持 no-replace 原子性、完整 owner publication、heartbeat、stale recovery、commit fence 与 deterministic errors。
- 依赖：fast runner resource isolation trust epoch 进入 main；PR #174 已闭合 protocol alias、publication durability、shared inspector、fixture ownership与isolated scan consumer，只需基于新 main 重冻并执行唯一最终 affected。
- 退出：Windows、Linux ext4/WSL2 真实跨进程竞争与崩溃恢复、独立 Review、required Evidence 与 merge readback全部通过。

### 2. active-documentation-corpus-v1

- 工程结果：机器 registry 取代历史编号、路径 catch-all 和人工 authority 表；active prose 按自然领域原子迁移，旧正文 byte-for-byte 归档。
- 依赖：portable lease 进入 main 后从新事实重算，吸收 runtime 与 runner trust epoch，禁止旧 docs candidate 覆盖新事实。
- 已知根治项：`main@a490a42` 的 `document-control-plane-lifecycle.test.ts` 仍要求蓝图复制 resolver 命令，与 #184 已进入 main 的 `sec-repository-orientation` 唯一入口 authority 冲突；本包必须把合同绑定到唯一 Skill owner，禁止把命令重新复制回蓝图制造第二事实源。
- 退出：在新 base 单提交重冻；独立 Review 与 required `full` Evidence只运行一次；merge 后readback并返回 `TASK_RESTART_REQUIRED`。

### 3. verification-result-truth-v1

- 工程结果：完成 Issue #176 剩余的 Gate result、platform/runtime execution ledger、skip 与 affected 空选择真值模型。
- 依赖：PR #174 已进入 main，live resolver不存在其他 active product Work Package；本轮 runner prerequisite不冒充该完整闭包。
- 退出：未在 owning environment 物理执行的声明不能投影为 PASS，result ledger 成为 CLI、artifact与Checks的唯一事实。

### 4. remaining-runtime-and-toolchain-seams-v1

- 工程结果：已证明未被前述候选吸收的 runtime/toolchain 能力按 authority DAG 继续闭合；spike 与 local-dirty snapshot 不进入 main。
- 依赖：portable lease 与全部待合正式分支完成或被准确阻塞。
- 退出：全部剩余 heads 都有进入 main、被吸收、明确禁止合并或带准确 blocker 四类之一的持久证明。

## Gate、单写者与重算

- A0 是本窗口全部 Gate owner；相同 `gate_key + tested head + profile` 的未失效结果复用。
- 上述顺序严格串行；任何时刻最多一个正式 active manifest 与一个 candidate epoch。同一 exact Gate identity 只执行一次，确定性失败在输入变化前直接复用。
- SEC main、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership 反证、实现 supersede 或全仓审计新决定性 finding 触发 live resolver 与全窗口重算。
