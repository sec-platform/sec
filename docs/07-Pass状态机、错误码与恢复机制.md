# Pass 状态机、错误码与恢复机制

> 目标：定义编译器状态转移、失败处理、错误码与恢复边界，避免 Agent 在失败时擅自扩大修改范围。

## 1. Pass 列表

- `parse`
- `align`
- `resolve`
- `compose`
- `adapt`
- `verify`
- `repair`
- `lock`
- `emit`

## 2. Pass 状态

### 通用状态

- `pending`
- `running`
- `succeeded`
- `failed`
- `blocked`
- `skipped`

### 状态机规则

- 所有 pass 初始状态为 `pending`
- `running -> succeeded | failed | blocked`
- `failed` 只能通过重新执行该 pass 或进入 `repair` 后回到 `pending`
- `blocked` 表示前置条件缺失，不得自动跳过
- `skipped` 仅用于本阶段未启用的 pass

## 3. 全链状态转移

### 正常路径

```text
parse -> align -> resolve -> compose -> adapt -> verify -> lock -> emit
```

### 失败路径

- `parse` 失败
  - 停止全链
- `align` 失败
  - 停止全链
- `resolve` 失败
  - 停止全链
- `compose` 失败
  - 允许重试 `compose`
- `adapt` 失败
  - 标记 slot 为 `failed`
  - 允许重试 `adapt`
- `verify` 失败
  - 进入 `repair`
- `repair` 失败
  - 停止全链并输出最小失败报告

## 4. Slot task 状态机

- `pending`
- `generated`
- `filled`
- `verified`
- `failed`
- `blocked`
- `overridden`

### 规则

- `pending -> generated`
  - 骨架已创建
- `generated -> filled`
  - AI 已写回目标文件
- `filled -> verified`
  - 通过 slot tests 和主验收
- `filled -> failed`
  - 验收未通过
- `verified -> overridden`
  - 人工或 override 机制接管

## 5. 错误码命名

格式：

```text
<DOMAIN>-<CATEGORY>-<NUMBER>
```

示例：

- `PLAN-VALIDATION-001`
- `RESOLVE-CONFLICT-003`
- `COMPOSE-PATH-004`
- `SLOT-WRITE-002`
- `VERIFY-ACCEPTANCE-005`

## 6. 错误域

### Issue 分层

| Issue 类型 | 典型错误域 | 是否默认允许 AI 修复 |
| --- | --- | --- |
| Spec Issue | PLAN / ALIGN / VERIFY policy | 否，需人工确认规格变更 |
| Composition Issue | MANIFEST / RESOLVE / COMPOSE | 否，优先修编译器或 block 元数据 |
| Slot Issue | SLOT / VERIFY unit / VERIFY acceptance | 是，但只能在 task envelope 范围内 |
| Kernel Issue | VERIFY perf / VERIFY correctness / external harness | 否，默认返回 kernel 维护者 |

- 错误报告必须尽量带上 issue 类型，帮助 Agent 避免把架构问题误当成 slot 修复。
- `repair` 默认只处理 Slot Issue；Composition Issue 和 Kernel Issue 需要显式授权。

### PLAN

- 输入 plan 结构、必填项、引用错误

### MANIFEST

- manifest schema、字段冲突、非法安装路径

### ALIGN

- pin 不兼容、slot 缺口、接口不对齐

### RESOLVE

- 依赖缺失、冲突、循环、排序失败

### COMPOSE

- 文件写入失败、路径冲突、合并失败

### SLOT

- 非法写入、符号缺失、输出格式错误

### VERIFY

- build 失败、单测失败、验收失败、policy gate 失败

### REPAIR

- 修复任务生成失败、修复超出修改范围

### UPGRADE

- 版本不兼容、migration 缺失、override 冲突

## 7. `v0.1` 最低错误码清单

| 错误码 | 含义 | 默认处理 |
| --- | --- | --- |
| `PLAN-VALIDATION-001` | 缺失 `app.name` | 终止 |
| `PLAN-REFERENCE-002` | slot 指向不存在 block | 终止 |
| `MANIFEST-SCHEMA-001` | manifest 非法 | 终止 |
| `RESOLVE-MISSING-001` | 缺失依赖 | 终止 |
| `RESOLVE-CONFLICT-002` | block 冲突 | 终止 |
| `RESOLVE-CYCLE-003` | 依赖成环 | 终止 |
| `COMPOSE-PATH-001` | 非法目标路径 | 终止 |
| `COMPOSE-MERGE-002` | 依赖合并冲突 | 终止 |
| `SLOT-WRITE-001` | 写出允许路径 | 终止当前 task |
| `SLOT-SYMBOL-002` | 未导出要求符号 | 终止当前 task |
| `VERIFY-BUILD-001` | 构建失败 | 进入 repair |
| `VERIFY-UNIT-002` | 单测失败 | 进入 repair |
| `VERIFY-ACCEPTANCE-003` | 验收失败 | 进入 repair |

## 8. 恢复策略

### 可自动重试

- 临时文件写入失败
- 可重放的 slot task
- 非副作用型 verify 命令

### 不可自动重试

- schema 错误
- 依赖冲突
- 环依赖
- 非法写入路径
- manifest 不兼容

### repair 前置条件

- `verify` 已失败
- 失败项能映射到有限文件集合
- repair task 有明确 writable paths

## 9. 幂等检查点

### 检查点文件

- `graph.lock.json`
- `install-manifest.json`
- `verification-report.json`
- `provenance.json`

### 规则

- 每个 pass 结束时必须更新检查点
- 每次重入必须优先读检查点，而不是猜测当前状态

## 10. 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 输入非法 |
| `3` | 依赖或冲突失败 |
| `4` | 安装失败 |
| `5` | slot 综合失败 |
| `6` | 验收失败 |
| `7` | repair 失败 |
| `8` | upgrade 失败 |

## 11. `repair` 合同

- `repair` 只能处理失败项最小闭包范围。
- `repair` 不得改动 plan、manifest 和 lock。
- `repair` 默认只允许写：
  - `custom/`
  - 显式授权的 `overrides/`
  - 明确列入 repair envelope 的业务文件

## 12. 人工干预点

以下情况必须返回人工决策，而不是继续自动推进：

- 需要变更 `app.plan.yaml`
- 需要替换或移除 block
- 需要跨多个 zone 改写
- 需要接受 breaking upgrade

## 13. 延期项

- 分布式编译状态同步
- 多 agent 并行 repair 合并
- 复杂回滚事务
