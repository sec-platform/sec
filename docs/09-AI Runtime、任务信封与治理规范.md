# AI Runtime、任务信封与治理规范

> 目标：定义 AI 在工程编译器中的角色、任务输入输出、权限边界、预算、治理与审计，避免 AI 重新退化为“全仓自由编辑器”。

## 1. AI 角色边界

### `v0.1`

- 只启用 `Slot Synthesis Agent`

### `v0.2+`

- `Interface Alignment Agent`
- `Repair Agent`
- `Review / Explanation Agent`
- `Upgrade Planning Agent`

### 全局原则

- AI 不是系统主循环控制器
- AI 不能决定新增或移除 block
- AI 不能绕过 compile contract
- AI 不能修改未授权路径

## 2. Task Envelope 正式 schema

```yaml
taskId: fill_slot_customer_normalizer
taskKind: adapter-slot
phase: adapt
targetBlock: entity/customer-basic
targetFile: custom/customer_normalizer.ts
allowedPaths:
  - custom/customer_normalizer.ts
requiredSymbols:
  - normalizeCustomerInput
forbiddenOperations:
  - modify_other_files
  - add_dependencies
  - access_database
  - change_exports
inputContracts:
  inputType: CustomerInput
  outputType: NormalizedCustomerInput
testsToPass:
  - tests/customer_normalizer.spec.ts
  - tests/acceptance/customer-flow.spec.ts
budget:
  maxAttempts: 2
  timeoutSeconds: 90
  maxTokens: 16000
expectedOutput:
  type: source-file
  language: typescript
```

## 3. Envelope 字段规则

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `taskId` | 是 | 全局唯一 |
| `taskKind` | 是 | `adapter-slot` / `policy-slot` / `repair` / `alignment` |
| `phase` | 是 | 所属 pass |
| `targetBlock` | 否 | 相关 block |
| `targetFile` | 是 | 主要目标文件 |
| `allowedPaths[]` | 是 | 唯一允许写入路径 |
| `requiredSymbols[]` | 否 | 必须保留或导出的符号 |
| `forbiddenOperations[]` | 是 | 禁止操作集合 |
| `inputContracts` | 否 | 类型、schema、约束 |
| `testsToPass[]` | 否 | 必须通过的测试 |
| `budget` | 是 | 重试、超时、token 限制 |
| `expectedOutput` | 是 | 目标输出类型 |

## 4. 写入控制

### 强制检查

- 写回前必须校验目标文件路径在 `allowedPaths` 之内。
- 写回后必须重新解析导出符号，验证 `requiredSymbols` 仍存在。
- 若 diff 触及未授权路径，立即失败并标记 `SLOT-WRITE-001`。

### `v0.1` 默认允许路径

- `custom/customer_normalizer.ts`

### `v0.2+` 扩展允许路径

- `overrides/*`
- repair envelope 中列出的局部业务文件

## 5. Prompt / Context 组装

### 必须包含

- slot 或 repair 合同
- 目标文件骨架
- 必须通过的测试摘要
- 禁止操作
- 当前 block 和相关类型签名

### 不应包含

- 整个仓库全文
- 与任务无关的历史对话
- 不必要的大量实现文件

### 上下文优先级

1. task envelope
2. 相关类型与测试
3. 目标文件骨架
4. 相关 block manifest 摘要
5. 最小业务背景

## 6. 自检与后处理

### AI 返回后必须做

- 路径校验
- 符号校验
- 编译或语法校验
- 对应测试运行
- diff 最小化检查

### diff 最小化规则

- 只允许改 `allowedPaths`
- 只允许修改任务相关 symbol
- 不得引入无关格式化变更

## 7. Budget 与降级策略

### `v0.1` 默认 budget

- `maxAttempts=2`
- `timeoutSeconds=90`
- `maxTokens=16000`

### 降级策略

- 第一次失败
  - 返回错误摘要并重试一次
- 第二次失败
  - 标记 task failed
  - 不自动扩大上下文
  - 不自动放宽 allowedPaths

## 8. Governance

### 审计字段

每次 AI task 至少记录：

- `taskId`
- `phase`
- `modelId`
- `startedAt`
- `finishedAt`
- `allowedPaths`
- `result`
- `testsRun`
- `verificationStatus`

### 信任边界

- AI 生成内容默认“不可信但可验证”
- 只有通过合同检查与测试后，才可进入 `verified`

## 9. Human Override

### 允许的人类操作

- 手动编辑 `custom/`
- 在后续阶段编辑 `overrides/`
- 标记某个 slot 为人工接管

### 不允许的跳过

- 不得手工跳过 `verify`
- 不得手工篡改 lock 使未验证产物显示为已验证

## 10. 角色职责

### Interface Alignment Agent

- 检查 pin 兼容性
- 提示缺失 slot
- 生成 adapter 建议
- 不直接写业务主干代码

### Slot Synthesis Agent

- 只实现 declared slot
- 不新增 block
- 不改全局配置

### Repair Agent

- 只处理 verify 失败项的最小范围
- 不得改变 architecture-level 决策

### Review / Explanation Agent

- 生成人类可读摘要
- 解释 provenance 与覆盖范围

## 11. `v0.1` 最低实现要求

- 单一 task envelope
- 单一 writable path
- 单一 required symbol
- 测试后置验证
- 审计日志最小记录

## 12. 延期项

- 多模型路由
- 成本优化器
- 并行 slot 合成
- 自定义 tool calling 编排
