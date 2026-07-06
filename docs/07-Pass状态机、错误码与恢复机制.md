---
title: Pass 状态机、错误码与恢复机制
status: active
last-reviewed: 2026-07-06
---

# Pass 状态机、错误码与恢复机制

本文定义当前 Pass 状态、Pass Execution Kernel v1、失败处理、错误码与恢复边界。

## 1. 当前阶段判定

当前工程开始引入 **Pass Execution Kernel v1**，但尚未完成完整 Pipeline Coordinator。

已实现：

- `platform/shared/pass-kernel.ts`。
- `LockFile.passExecutions?` 兼容型执行账本。
- `beginPass / completePass / failPass / invalidateDownstreamPasses / runPassWithLock`。
- `composeWorkspace()` 与 `adaptWorkspace()` 通过 `runPassWithLock()` 执行。
- `resolveWorkspace()` 为 `parse / align / resolve` 记录 completed execution metadata。

尚未实现：

- 统一 `compileWorkspace()`。
- 所有入口统一通过 Pipeline Coordinator。
- Upgrade 内部重编译接入同一 pipeline。
- Semantic Link / Build IR / Plan Lowering 独立 pass。
- Project Baseline 与 compilation transaction绑定。
- Lock / Emit 完全拆分。
- Error Protocol 对 Semantic Core prefix 的完整映射。

因此本文不得把 Pipeline Kernel v1描述为完整 pass系统已经完成。

## 2. 当前 Pass 列表

| Pass | 当前依赖 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| `parse` | — | implemented | 解析 `source/app.yaml`、block manifest |
| `align` | `parse` | implemented | 校验 stack/Slot 兼容性、接口对齐 |
| `resolve` | `align` | implemented | 拓扑排序依赖图、生成 lock |
| `compose` | `resolve` | kernel v1 wrapped | 安装 block 文件、生成骨架 |
| `adapt` | `compose` | kernel v1 wrapped | 填充 slot、物化 runtime target |
| `verify` | `adapt` | implemented, not kernel wrapped | typecheck + 单元测试 + 验收 + policy gate |
| `repair` | `verify` | implemented, not kernel wrapped | 基于失败点生成修复计划 |
| `lock` | `verify/adapt` | implemented, not kernel wrapped | 固化最终 pass 状态 |
| `emit` | `lock` | implemented, not kernel wrapped | 输出 governance artifacts、explain graph |

目标新增 pass：

```text
normalize
link-semantics
build-ir
plan-lowering
lower
```

这些尚未进入 `PASS_SEQUENCE`。

## 3. 当前状态字段

旧字段继续保留：

```ts
interface LockFile {
  passStatus: PassStatus;
}
```

新增兼容账本：

```ts
interface LockFile {
  passExecutions?: Partial<Record<keyof PassStatus, PassExecutionState>>;
}

interface PassExecutionState {
  status: PassState;
  transactionId?: string;
  inputRevision?: string;
  outputRevision?: string;
  startedAt?: string;
  completedAt?: string;
  diagnosticIds: string[];
}
```

`passStatus` 仍服务旧代码和旧合同；`passExecutions` 记录 transaction 和诊断，作为后续完整 Pipeline Coordinator 的迁移垫片。

## 4. Pass Execution Kernel v1 规则

### beginPass

```text
beginPass(lock, pass)
  → invalidate downstream passStatus
  → create transactionId
  → set passStatus[pass] = running
  → write passExecutions[pass]
```

### completePass

```text
completePass(lock, pass)
  → preserve transactionId
  → set passStatus[pass] = succeeded
  → write completedAt / outputRevision?
```

### failPass

```text
failPass(lock, pass, diagnostic)
  → preserve transactionId
  → set passStatus[pass] = failed
  → write completedAt / diagnosticIds
```

### runPassWithLock

```text
beginPass
→ save lock
→ run mutating pass
→ completePass + save lock

catch
→ failPass + save lock
→ rethrow
```

当前仅 `compose` 和 `adapt` 使用该 wrapper。

## 5. Downstream invalidation

当前 `PASS_SEQUENCE`：

```text
parse → align → resolve → compose → adapt → verify → repair → lock → emit
```

当某 Pass开始执行，后续 Pass统一失效：

```text
compose running
  → adapt pending
  → verify pending
  → repair skipped
  → lock pending
  → emit pending
```

```text
adapt running
  → verify pending
  → repair skipped
  → lock pending
  → emit pending
```

这是第一步修复“上游重跑但下游仍显示 succeeded”的问题。

## 6. 当前限制

### resolve 仍是组合 pass

`resolveWorkspace()` 当前仍在一个函数内完成：

```text
load plan
load manifest
align
resolveGraph
validateResolvedTemplates
save lock
```

由于 resolve 前不一定存在可写 Lock，本阶段只在生成 Lock后补写 `parse/align/resolve` 的 completed metadata。后续 Pipeline Coordinator 需要在 parse之前创建 transaction journal。

### compiler pass函数仍会直接写状态

`composeProject()` 与 `adaptProject()` 内部仍会写 `lock.passStatus.compose/adapt = succeeded`。当前 wrapper 会在其外层再补 `passExecutions` 与 downstream invalidation。下一阶段应把状态写入权迁移到 Pass Kernel。

### Lock / Emit 尚未分离

现有 `lockProject()` 仍承担 provenance / emit相关副作用。后续必须拆分为：

```text
lock pass
emit pass
```

## 7. 错误码命名

格式：

```text
<DOMAIN>-<CATEGORY>-<NUMBER>
```

当前 Error Protocol仍主要覆盖 legacy compiler域：

| 前缀 | 对应模块 |
| --- | --- |
| `PARSE` / `MANIFEST` | `parse/` |
| `ALIGN` | `align/` |
| `RESOLVE` | `resolve/` |
| `COMPOSE` / `OVERRIDE` | `compose/` |
| `SLOT` / `ADAPT` | `synthesize/` |
| `VERIFY` | `verify/` |
| `REPAIR` | `repair/` |
| `UPGRADE` | `upgrade/` |
| `LOCK` / `EMIT` | `emit/` |
| `WORKBENCH` | `workbench/` |
| `EXPLAIN` | `emit/` |

目标新增：

```text
CONTRACT-SEMANTIC
IR-IDENTITY
IR-FACT
IR-AUTHORITY
GENERATOR-PLAN
GENERATOR-LOWER
VIEW-PROJECTION
VIEW-INSPECTOR
```

未接入前，这些错误不能被误描述为已有完整恢复协议。

## 8. Issue 分层

| Issue 类型 | 典型错误域 | AI 可自主修复 |
| --- | --- | --- |
| Spec Issue | `PLAN` / `ALIGN` / `VERIFY` policy | 否，需人工确认 |
| Composition Issue | `MANIFEST` / `RESOLVE` / `COMPOSE` | 否，优先修编译器或 block 元数据 |
| Slot Issue | `SLOT` / `VERIFY` unit / acceptance | 是，但限于 task envelope |
| Kernel Issue | perf / correctness / external harness | 否，返回维护者 |

Semantic Core 接入后应细分 `semantic-frontend / ir-validator / generator-planner / projector` ownership。

## 9. Slot task 状态机

```text
pending → generated → filled → verified
filled  → failed
```

当前 Slot Task仍是 Adapt阶段局部状态，不等同 Pass状态。

## 10. 恢复策略

当前可重试：

- 临时 I/O失败。
- 可重放 slot task。
- 非副作用 verify。
- compose/adapt wrapper记录 failed后重跑。

当前不可自动重试：

- schema错误。
- 依赖冲突。
- 环依赖。
- 非法写入路径。
- Project drift。

目标恢复：

```text
open compilation transaction
→ mark running
→ execute with bounded write set
→ commit output revision
→ mark succeeded
```

如果进程中断，下次运行应识别未完成 transaction，而不是把 compiler自身半完成输出直接判为用户 drift。该能力尚未实现。

## 11. 下一步

严格顺序：

1. 建立 `compileWorkspace()` / Pipeline Coordinator。
2. 将 CLI、Workbench、Reference Refresh接入 Coordinator。
3. 将 Upgrade重编译迁入 Coordinator。
4. 状态写入权从 compiler pass函数迁移到 Pass Kernel。
5. Project Baseline绑定 transaction。
6. 增加 Semantic Link / Build IR / Plan Lowering pass。
