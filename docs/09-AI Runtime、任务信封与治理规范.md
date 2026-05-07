# AI Runtime、任务信封与治理规范

> 目标：定义 AI 角色边界、task envelope schema、写入控制、上下文组装规则。

## 1. AI 角色边界

### 当前阶段

- `v0.1`：只启用 `Slot Synthesis Agent`（已实现）
- `v0.2+`（部分已实现）：`Interface Alignment Agent`、`Repair Agent`、`Review/Explanation Agent`

### 全局原则

- AI 不是系统主循环控制器，是编译链中的受限 pass。
- AI 不能决定新增/移除 block，不能绕过 compile contract。
- AI 必须优先使用结构化对象（plan/graph/manifest/slot/acceptance/provenance/report）定位任务。
- 整仓搜索、整仓重写或自由聊天不是默认工程动作。

### 外部入口优先级

CLI first → MCP second → IDE plugin third。所有入口都是 Runtime API 的 adapter，不得绕过 task envelope。

## 2. Task Envelope Schema

```yaml
taskId: fill_slot_customer_normalizer
taskKind: adapter-slot
phase: adapt
targetBlock: entity/customer-basic
targetFile: source/code/slots/customer_normalizer.ts
sourceSlot:
  id: customer_normalizer
  status: filled
  runtimeTarget: custom/customer_normalizer.ts
  sourcePath: source/code/slots/customer_normalizer.ts
  writableZones: [source/code/slots/customer_normalizer.ts, custom/]
  provenanceHints:
    generator: mock-local-synthesizer
    verifiedBy: []
allowedPaths: [source/code/slots/customer_normalizer.ts]
requiredSymbols: [normalizeCustomerInput]
forbiddenOperations: [modify_other_files, add_dependencies, access_database, change_exports]
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

## 3. Envelope 字段表

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `taskId` | 是 | 全局唯一 |
| `taskKind` | 是 | adapter-slot / policy-slot / repair / alignment |
| `phase` | 是 | 所属 pass |
| `targetFile` | 是 | 主要写入文件 |
| `sourceSlot` | 是 | 来自 lock 的 slot 状态、writable zones、provenance hints |
| `allowedPaths` | 是 | 实际允许写入的文件（收窄自 writableZones） |
| `requiredSymbols` | 否 | 必须保留或导出的符号 |
| `forbiddenOperations` | 是 | 禁止操作集合 |
| `inputContracts` | 否 | 类型/schema 约束 |
| `testsToPass` | 否 | 必须通过的测试 |
| `budget` | 是 | maxAttempts / timeout / maxTokens |
| `expectedOutput` | 是 | 目标输出类型 |

## 4. 写入控制

- 写回前校验目标路径在 `allowedPaths` 内。
- 若 diff 触及未授权路径 → `SLOT-WRITE-001`。
- 语义权限 = 文件路径 + task kind + phase + zone + artifact ownership + forbidden operations。
- `acceptance`、policy、`testsToPass`、verification report 是约束输入，不是 AI 可修改的输出。
- Workbench/IDE 变更 `source/app.yaml` 必须先写 `source/views/mutations/*.json`。

## 5. 上下文组装

### 优先级

1. Task envelope
2. `graph.lock.json` 中的相关 slot/block/pass 状态
3. 相关 block manifest 摘要
4. acceptance / verification report / provenance / explain graph 摘要
5. 相关类型签名与测试
6. 目标文件骨架

### Context Packet 投影

Context Packet 是 task envelope 在执行时的只读上下文投影，不是新的事实源、持久化 artifact 或独立状态机。它由 task envelope、lock、manifest、acceptance、verification、provenance、explain graph、runtime evidence 和必要源码骨架组装。

允许暴露的投影字段包括：`task`、`affectedGraph`、`blocks`、`pins`、`policies`、`writableAnchors`、`readonlyAnchors`、`cannotModify`、`mustPreserve`、`verification`、`provenance`、`issueClassification`、`runtimeEvidence`。

权限仍只由 `allowedPaths`、`forbiddenOperations`、task kind、phase 和 zone 决定；Context Packet 不能扩大写入范围，也不能把外部 provider evidence 提升为 authoring truth。Graph-It-Live/MCP、trace、IDE graph 或其他工具结果只能作为 `runtimeEvidence` / evidence reference 进入投影。

### 源码下钻规则

只有结构化上下文不足时才下钻源码。范围从 `targetFile`、`requiredSymbols`、`testsToPass` 推导，禁止扩大到整仓。

## 6. Budget 与降级

默认 budget：`maxAttempts=2`、`timeoutSeconds=90`、`maxTokens=16000`。

- 第一次失败 → 返回错误摘要并重试一次
- 第二次失败 → 标记 task failed，不自动扩大上下文/放宽路径

## 7. Governance 审计

每次 AI task 记录：`taskId`、`phase`、`modelId`、`startedAt`、`finishedAt`、`allowedPaths`、`result`、`testsRun`、`verificationStatus`。
