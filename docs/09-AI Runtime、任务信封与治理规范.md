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
- AI 不能修改 deterministic outputs、acceptance、policy、migration order、lock、provenance 或 generated files，除非进入显式 spec / governance / compiler pass workflow
- AI 必须优先使用 `plan / graph / manifest / slot / acceptance / provenance / report` 定位任务，再读取有限源码上下文
- AI 不得把整仓搜索、整仓重写或自由聊天作为默认工程动作
- 更强模型应被封装为 alignment、slot synthesis、repair、critical review 或 upgrade planning pass，而不是获得整仓写权限
- 防止模型走捷径应依赖机器校验的 zone、allowed paths、diff budget、验收不可变性和 provenance，而不是只依赖提示词

### 与通用 Agent 工具的关系

- Claude Code、Managed Agents、Skills、MCP、hooks 和权限系统可以作为执行基座。
- 工程编译器必须在这些工具之上提供项目级 task envelope、写入边界、来源追踪、验收和回滚语义。
- 不允许把工具能力直接暴露为产品核心，否则会退化为“更强的自动改仓库工具”。

### Claude harness 到 SpecEngineer harness 的映射

| Claude 侧能力 | SpecEngineer 对应物 |
| --- | --- |
| session | compile session / upgrade session / repair session |
| sandbox | slot sandbox / override sandbox / repair sandbox |
| hooks | policy hooks / verification hooks / provenance hooks |
| Skills | Blocks / Strategy Packs / Governance Packs |
| permissions | semantic permissions / writable zones / allowed paths |
| subagents | compiler agents: alignment、synthesis、repair、review、upgrade |
| MCP tools | registry、verification、observability、deployment adapters |

- Claude 侧能力偏执行，SpecEngineer harness 偏工程语义；两者可以组合，但语义边界必须由工程编译器定义。

### Platform AI Runtime API

- 平台应先定义稳定 AI Runtime API，统一表达 task envelope、context pack、权限、写回、验证和 provenance。
- 外部入口优先级为 CLI first、MCP second、IDE plugin third；产品型 adapter 可在这些基础上扩展。
- CLI、MCP、VS Code / JetBrains 插件和后续工作台都只是 Runtime API 的 adapter，不得绕过 task envelope 直接写仓库。
- IDE 插件是 view-first 的控制台和导航层，不是封闭牢笼；源码可达，但写入仍必须回到平台权限和验证语义。

## 2. Task Envelope 正式 schema

```yaml
taskId: fill_slot_customer_normalizer
taskKind: adapter-slot
phase: adapt
targetBlock: entity/customer-basic
targetFile: source/slots/customer_normalizer.ts
sourceSlot:
  id: customer_normalizer
  status: filled
  runtimeTarget: custom/customer_normalizer.ts
  sourcePath: source/slots/customer_normalizer.ts
  writableZones:
    - source/slots/customer_normalizer.ts
    - custom/
  provenanceHints:
    generator: mock-local-synthesizer
    verifiedBy: []
allowedPaths:
  - source/slots/customer_normalizer.ts
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
| `targetFile` | 是 | 主要写入文件；声明 `sourcePath` 的 slot 默认指向 `source/slots/**` |
| `sourceSlot` | 是 | 来自 `graph.lock.json` 的 slot 状态、`sourcePath`、`runtimeTarget`、writable zones 与 provenance hints |
| `allowedPaths[]` | 是 | 从 `targetFile` 收窄出的实际允许写入文件；源码层 slot 默认只允许写 `sourcePath`，runtime target 由 compiler 物化 |
| `requiredSymbols[]` | 否 | 必须保留或导出的符号 |
| `forbiddenOperations[]` | 是 | 禁止操作集合 |
| `inputContracts` | 否 | 类型、schema、约束 |
| `testsToPass[]` | 否 | 必须通过的测试 |
| `budget` | 是 | 重试、超时、token 限制 |
| `expectedOutput` | 是 | 目标输出类型 |

## 4. 写入控制

### 强制检查

- 写回前必须校验目标文件路径在 `allowedPaths` 之内。
- `allowedPaths` 必须收窄到具体 `targetFile`，且目标必须落在 `sourceSlot.writableZones` 内；repair review 也必须回显同一写入边界和 provenance hints。
- 当 `sourceSlot.sourcePath` 存在时，AI/repair 只写 `sourcePath`，`sourceSlot.runtimeTarget` 由 adapt/repair pass 物化并重写相对 import。
- 写回后必须重新解析导出符号，验证 `requiredSymbols` 仍存在。
- 若 diff 触及未授权路径，立即失败并标记 `SLOT-WRITE-001`。

### 语义权限

- 文件路径权限只是最低层检查；AI 还必须满足 task kind、phase、zone、artifact ownership 和 forbidden operations 组成的语义权限。
- `acceptance`、policy、`testsToPass`、verification report 和 explain graph 在普通 slot / repair task 中是约束输入，不是可被 AI 修改的输出。
- `project/generated/**`、`project/src/installed/**`、`graph.lock.json`、`provenance.json` 和迁移顺序只能由对应 compiler pass 或显式治理 workflow 更新。
- 如果修复需要改变规格、验收、policy 或 block 选择，应返回 Spec Issue / Composition Issue，而不是扩大当前 envelope。

### `v0.1` 默认允许路径

- `source/slots/customer_normalizer.ts`：默认开发者源码 slot。
- `custom/customer_normalizer.ts`：无 `sourcePath` 时的兼容写入目标；声明 `sourcePath` 后仅由 compiler 物化。

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
2. `graph.lock.json` 中的相关 slot / block / pass 状态
3. 相关 block manifest 摘要
4. acceptance、verification report、provenance / explain graph 摘要
5. 相关类型与测试
6. 目标文件骨架
7. 最小业务背景

### Context Packet 最小字段

- `task`：task id、task kind、phase、target block、target file；源码层 slot 还必须带 `runtimeTarget`。
- `affectedGraph`：与任务相关的 block、pin、slot、file、acceptance、policy、issue 节点与边。
- `blocks` / `pins`：相关 block manifest 摘要、输入输出 pin、连接关系和兼容性约束。
- `policies`：适用 policy、severity、目标和已知 violation。
- `writableAnchors`：从 envelope 派生的 `allowedPaths`、目标 symbol、slot writable zone、`sourcePath`、`runtimeTarget` 和 provenance hints。
- `readonlyAnchors`：必须读取但不得修改的类型、测试、generated artifact、lock、provenance 和 report 摘要。
- `cannotModify`：acceptance、policy、migration order、generated files、lock、provenance、未授权源码路径等不可改对象。
- `mustPreserve`：required symbols、公开 contract、验收语义、policy gate、现有 provenance 和 runtime 行为约束。
- `verification`：必须通过的 tests、verify lane、相关报告路径和失败摘要。
- `issueClassification`：Spec Issue、Composition Issue、Slot Issue 或 Kernel Issue 初判。
- `runtimeEvidence`：仅在 repair / review 需要时包含日志、runtime report、observability 摘要和复现步骤。

### 源码下钻规则

- 只有当上面的结构化上下文不足以完成任务时，才读取源码。
- 源码读取范围应从 `targetFile`、`requiredSymbols`、`testsToPass`、`verifiedBy` 和 graph edge 推导。
- 禁止为了“更保险”自动扩大到整仓上下文。

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

### diff budget

- 每个 task kind 应从 envelope 和 issue classification 派生允许变更的文件数、符号数和代码范围。
- 超出 diff budget 时必须失败或转人工 review；测试通过、模型置信度或“顺手清理”都不能抵消越界写入。
- diff budget 不替代 `allowedPaths`，只能在已授权路径内继续收窄。

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
- 检查是否存在绕过 compile contract、修改验收或扩大 envelope 的行为

### Upgrade Planning Agent

- 生成迁移计划、影响面和回滚建议
- 不直接执行 migration、override 或 schema 改写
- 必须把破坏性变更交给 upgrade workflow 和人工确认

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
