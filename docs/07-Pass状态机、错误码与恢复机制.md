# Pass 状态机、错误码与恢复机制

> 目标：定义编译器状态转移、失败处理、错误码与恢复边界。

## 1. Pass 列表与依赖关系

| Pass | 依赖 | 状态 | 说明 |
| --- | --- | --- | --- |
| `parse` | — | 已实现 | 解析 `source/app.yaml`、block manifest |
| `align` | `parse` | 已实现 | 校验 stack/Slot 兼容性、接口对齐 |
| `resolve` | `align` | 已实现 | 拓扑排序依赖图、生成 lock |
| `compose` | `resolve` | 已实现 | 安装 block 文件、生成骨架 |
| `adapt` | `compose` | 已实现 | AI 填充 slot、物化 runtime target |
| `verify` | `adapt` | 已实现 | typecheck + 单元测试 + 验收 + policy gate |
| `repair` | `verify` | 已实现 | 基于失败点生成修复计划 |
| `lock` | `adapt` | 已实现 | 固化最终 pass 状态 |
| `emit` | `lock` | 已实现 | 输出 governance artifacts、explain graph |

依赖关系由 orchestrator 调用顺序与 `assertPassStatus` 守卫保证（`platform/shared/lock-utils.ts`）；`shared/constants.ts` 仅保留 `PASS_SEQUENCE` 与 `PASS_STATUS_PENDING`，不再集中表达 pass 间依赖字典。

## 2. 状态机

### 通用状态

`pending` → `running` → `succeeded` | `failed` | `blocked`

- `failed` → 只能通过重新执行或 `repair` 回到 `pending`
- `blocked` → 前置条件缺失，不得自动跳过
- `skipped` → 本阶段未启用

### 正常路径

```text
parse → align → resolve → compose → adapt → verify → lock → emit
```

### 失败路径

- `parse` / `align` / `resolve` 失败 → 停止全链
- `compose` / `adapt` 失败 → 允许重试
- `verify` 失败 → 进入 `repair`
- `repair` 失败 → 停止全链并输出最小失败报告

## 3. 错误码命名

格式：`<DOMAIN>-<CATEGORY>-<NUMBER>`

错误码前缀映射（`ERROR_CODE_PREFIX_MAP`）：

| 前缀 | 对应 pass 模块 |
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

## 4. Issue 分层

| Issue 类型 | 典型错误域 | AI 可自主修复 |
| --- | --- | --- |
| Spec Issue | `PLAN` / `ALIGN` / `VERIFY` policy | 否，需人工确认 |
| Composition Issue | `MANIFEST` / `RESOLVE` / `COMPOSE` | 否，优先修编译器或 block 元数据 |
| Slot Issue | `SLOT` / `VERIFY` unit / acceptance | 是，但限于 task envelope |
| Kernel Issue | perf / correctness / external harness | 否，返回维护者 |

## 5. Slot task 状态机

`pending` → `generated` → `filled` → `verified`（可 `overridden`）
`filled` → `failed`（验收未通过）

## 6. 恢复策略

- **可重试**：临时 I/O 失败、可重放 slot task、非副作用 verify
- **不可重试**：schema 错误、依赖冲突、环依赖、非法写入路径
- **repair 前置条件**：`verify` 已失败，失败项可映射到有限文件集合
