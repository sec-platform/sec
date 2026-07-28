---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-28
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@9b1111441a92b64888323c79f359b52cd039994a`、PR #174/#185、Issue #167/#173/#175/#176、Review/CI 和 exact tree 重新计算。Fast Runner Resource Isolation 已通过受信 base manual bootstrap 进入当前 main；旧 candidate、Review 与 Gate 只作为原 identity Evidence，不重复执行。Portable lease 现在独占 active 控制面，active documentation corpus 只能在其进入 main 后重算，禁止并行双写。

```text
Fast Runner Resource Isolation
→ Portable Atomic Workspace Lease
→ Active Documentation Corpus
→ Verification Result Truth
→ Remaining Runtime / Toolchain Seams
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if` 与最终 reconciliation 更新本文件。

## 当前唯一 Work Package

### workspace-write-lease-portability-v1

- 工程结果：common write authority 使用 Node 标准 `fs.link`发布 append-only generation ledger；完整 immutable owner 与terminal均 no-replace，active owner只由最高未terminalized generation决定。
- 崩溃收敛：immutable publication 显式区分未发布、已发布和durability unknown；一旦目标可能已发布就保留完整holder，由重启从ledger恢复，禁止不确定删除。
- 唯一消费：protected Gate 只消费 shared read-only v2 inspector，不再维护v1 `owner.json`、token或identity的第二套parser。
- 恢复不变量：heartbeat只属于exact owner holder；仅同host、stale且PID proven-dead的最高generation可追加recovery terminal。release/recovery都不删除或复用active/successor generation，延迟actor不能撤销后继writer。
- 迁移边界：v1 active directory只在graceful release后自然消失；发现legacy `owner.json` residue必须typed fail closed，不自动猜测旧进程死亡。v2永久protocol root使旧v1进程也无法并行取得同一路径。
- 当前 Bun 合法边界：只从`platform/shared/workspace-write-lease.ts`移除`bun:ffi`；Bun 1.3.14 repository Toolchain、显式 Bun/native adapter、Bun Target与development/verification Gate保持合法。
- Node 边界：本包只证明lease primitive在Windows Node 24与WSL2/ext4 Node 22上的真实跨进程竞争和crash recovery；公共CLI静态图、Bun Toolchain executable、clean package smoke与Node支持声明仍属于后续包。
- 退出：source/contracts/focused/typecheck/docs/audit/affected/imports、真实双平台 sentinel、独立 exact-head Review 与 required trust-root bootstrap 满足；merge/readback 后重算 Issue #167 剩余 DAG。

## 候选 Work Package

### 1. active-documentation-corpus-v1

- 工程结果：机器 registry 取代历史编号、路径 catch-all 和人工 authority 表；active prose 按自然领域原子迁移，旧正文 byte-for-byte 归档。
- 依赖：portable lease 产品结果与控制面先进入 main，PR #185 随后重算 authority、链接、manifest 与 trust-root bootstrap。
- 退出：在新 base 单提交重冻；独立 Review 与 required `full` Evidence 只运行一次；merge 后 readback 并返回 `TASK_RESTART_REQUIRED`。

### 2. verification-result-truth-v1

- 工程结果：完成 Issue #176 剩余的 Gate result、platform/runtime execution ledger、skip 与 affected 空选择真值模型。
- 依赖：portable lease 已进入 `main`，live resolver 不存在其他 active product Work Package。
- 退出：未在 owning environment 物理执行的声明不能投影为 PASS，result ledger 成为 CLI、artifact 与 Checks 的唯一事实。

### 3. remaining-runtime-and-toolchain-seams-v1

- 工程结果：按 `common-node-host-and-toolchain-separation → generated-node-bun-target-profiles → optional-native-capability-adapters → cross-host-determinism-and-release-matrix` 严格串行闭合剩余 runtime/toolchain seam。
- 依赖：portable lease 与 verification result truth 均进入 `main`；spike 与 local-dirty snapshot 不进入正式事实。
- 退出：全部剩余 heads 都有进入 main、被吸收、明确禁止合并或带准确 blocker 四类之一的持久证明；只有最终 release matrix 允许声明 public Node baseline fully supported。

## Gate、单写者与重算

- A0 是本窗口全部 Gate owner；相同 `gate_key + tested head + profile` 的未失效结果复用。
- 上述顺序严格串行；任何时刻最多一个正式 active manifest 与一个 candidate epoch。同一 exact Gate identity 只执行一次，确定性失败在输入变化前直接复用。
- SEC main、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership 反证、实现 supersede 或全仓审计新决定性 finding 触发 live resolver 与全窗口重算。
