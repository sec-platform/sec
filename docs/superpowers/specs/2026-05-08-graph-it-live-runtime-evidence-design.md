# Graph-It-Live Runtime Evidence 设计

## 目标

把 Graph-It-Live 用作 PJC 开发加速工具：在 AI 或开发者动手前提供代码上下文、在 review 前提示风险文件、在 Overview / Workbench 中提供只读导航线索。

第一版进入 `Context Packet` 的 `runtimeEvidence` 投影层，不进入 PJC canonical graph，不成为 stable artifact，不驱动 Workbench mutation。

## 明确不做

- 不从平台内部直接启动 Graph-It-Live MCP 或 CLI。
- 不把 Graph-It-Live raw graph 合并进 `control/graph/explain-graph.json`。
- 不把 runtime evidence 加入 contract freeze 必需清单。
- 不从 runtime evidence 推导新增可写路径。
- 不让 Graph-It-Live evidence 自动修复代码、判定验证失败或驱动 mutation。
- 不为 Graph-It-Live、GitNexus、Graphify 分别建立互不兼容的 provider schema。

## 当前工程约束

- `platform/shared/task-envelope-types.ts` 已定义 `TaskEnvelope`。
- `platform/compiler/synthesize/build-task-envelope.ts` 已生成 slot 级 task envelope。
- `docs/09-AI Runtime、任务信封与治理规范.md` 已规定 Context Packet 是只读投影，`runtimeEvidence` 不能扩大写权限。
- `docs/11-Workbench与可视化规范.md` 已规定 Graph-It-Live/MCP 只能作为 evidence / overlay，不得成为平台事实源。
- `platform/shared/tool-evidence-contract.ts` 的现有工具 evidence 均为 `stableArtifact: false`，可作为边界参考，但本设计不复用其 stable/draft report 路径作为 Context Packet 的主模型。

## 推荐方案

新增最小 Context Packet 投影层：

```text
TaskEnvelope
+ optional RuntimeEvidence[]
→ buildContextPacket(...)
→ ContextPacket { task, writeBounds, runtimeEvidence }
```

Graph-It-Live 查询仍由开发者或 AI 通过外部 MCP 获取；平台第一版只接收 raw result 并归一成通用 `RuntimeEvidence`。这样既能加速当前项目开发，又不会把外部工具升级为 PJC 的事实源。

## 核心数据结构

### RuntimeEvidence

`RuntimeEvidence` 是 provider 中立的只读开发证据，建议放在 `platform/shared/runtime-evidence-types.ts`。

字段语义：

- `provider`: 第一版支持 `'graph-it-live'`，后续可扩展 `'gitnexus'`、`'graphify'`。
- `kind`: `'code-context' | 'impact-hint' | 'review-risk' | 'navigation-hint'`。
- `stableArtifact`: 固定为 `false`。
- `confidence`: `'high' | 'medium' | 'low'`。
- `targetFiles`: 本次查询或任务直接关注的文件。
- `relatedFiles`: provider 发现的引用方、依赖方、风险文件或导航文件。
- `symbols`: 相关函数、类型、导出或调用提示。
- `diagnostics`: 给开发者和 reviewer 看的提示，不是 verification failure。
- `rawReportPaths` / `rawQueryIds`: 可选来源线索，用于回看原始查询结果。

### ContextPacket

`ContextPacket` 建议放在 `platform/shared/context-packet-types.ts`。

第一版只实现最小闭环：

```ts
interface ContextPacket {
  formatVersion: string;
  task: TaskEnvelope;
  writeBounds: {
    allowedPaths: string[];
    forbiddenOperations: string[];
    requiredSymbols: string[];
  };
  runtimeEvidence: RuntimeEvidence[];
}
```

`writeBounds` 只从 `TaskEnvelope` 原样复制。`runtimeEvidence.relatedFiles` 不能进入 `writeBounds.allowedPaths`。

## 组件设计

### 1. Context Packet builder

建议新增 `platform/compiler/synthesize/build-context-packet.ts`。

输入：

- `taskEnvelope: TaskEnvelope`
- `runtimeEvidence?: RuntimeEvidence[]`

输出：

- `ContextPacket`

职责：

- 复制 task envelope。
- 从 task envelope 派生 `writeBounds`。
- 对 runtime evidence 做去重和稳定排序。
- 缺省时输出 `runtimeEvidence: []`。
- 不读取或写入工作区 artifact。

### 2. Graph-It-Live runtime evidence adapter

建议新增 `platform/shared/graph-it-live-runtime-evidence.ts`。

输入是宽松 raw shape，而不是 MCP client：

- codemap-like result
- references-like result
- impact-like result
- provider diagnostic result

输出是 `RuntimeEvidence[]`。

用途映射：

| 开发场景 | RuntimeEvidence kind | 用途 |
| --- | --- | --- |
| 开发前定位上下文 | `code-context` | 提供 exports、imports、dependents、call hints、先读文件 |
| Review 前风险扫描 | `impact-hint` / `review-risk` | 提示风险文件和影响符号，不作为 hard failure |
| Workbench / Overview 辅助导航 | `navigation-hint` | 展示 provider 可用性、相关文件和原始查询线索 |

### 3. Summary / formatter

第一版必须提供 `inspectContextPacket` 或 `summarizeRuntimeEvidence`，作为 CLI、Overview、Workbench 的只读导航摘要入口。

摘要只包含：

- provider count
- evidence item count
- target file count
- related file count
- diagnostic count
- top related files

摘要不得暗示 `relatedFiles` 是可写路径。

## 数据流

```text
开发者 / AI 选择目标文件或符号
→ 外部 Graph-It-Live MCP 查询 codemap / references / impact
→ raw result 传给 adapter
→ adapter 归一为 RuntimeEvidence[]
→ buildContextPacket(taskEnvelope, runtimeEvidence)
→ AI / developer 用 Context Packet 决定阅读顺序、review 重点、验证计划
→ 实际写入仍只由 TaskEnvelope.allowedPaths 控制
```

## 失败语义与降级

### provider unavailable

MCP/CLI 不可用、索引未启动、parser 缺失时，Context Packet 仍有效：

- `runtimeEvidence: []`；或
- 一条低风险 provider diagnostic evidence。

该状态不阻塞 `adapt`、`repair`、`preflight`、typecheck 或测试。

### partial evidence

codemap 可用但 call graph / impact 查询失败时，保留可用 evidence，并用 diagnostic 标记 partial。

### stale evidence

raw result 可带 `generatedAt`、`workspaceRoot`、`commit`。第一版如果发现不一致，只降级为 warning，不把 stale evidence 当事实源。

## Workbench / Overview 边界

第一版必须让 Overview / Workbench 能消费 Context Packet summary 或 runtime evidence summary，但只能做只读导航：

- 显示 evidence 是否存在。
- 显示 provider、target files、related files、diagnostic count。
- 显示 review priority hints。

不得：

- 修改 Explain Graph。
- 修改 Review Summary 的 verification 结论。
- 生成 mutation apply 输入。
- 把外部 provider 的节点边渲染为 canonical graph 节点边。

## 测试策略

### 单元测试

1. `buildContextPacket` 缺省 evidence：
   - 未传 runtime evidence 时输出 `runtimeEvidence: []`。
   - `task` 和 `writeBounds` 完整。

2. 写权限不扩张：
   - Task envelope 只允许 `source/code/slots/customer_normalizer.ts`。
   - Graph-It-Live evidence 包含 `relatedFiles: ['platform/shared/tool-evidence-contract.ts']`。
   - 断言 `writeBounds.allowedPaths` 没有新增 related file。

3. Graph-It-Live adapter 归一：
   - raw codemap/reference/impact fixture 转成 `RuntimeEvidence[]`。
   - 断言 `provider === 'graph-it-live'`。
   - 断言 `stableArtifact === false`。
   - 断言文件、symbol、diagnostic 去重排序。

4. 不污染 canonical graph：
   - Context Packet builder 不接收 `ExplainGraph` 写入参数。
   - runtime evidence 不生成 graph nodes/edges artifact。

5. Summary / formatter：
   - 输出 provider count、evidence count、target/related file count、diagnostic count。
   - 输出文案区分 related files 与 allowed paths。

### 推荐验证命令

第一版最小验证：

```bash
bun test tests/unit/context-packet.test.ts tests/unit/graph-it-live-runtime-evidence.test.ts
bun run typecheck
```

如果接入 Overview / Workbench 展示，再升级：

```bash
bun run test:fast
bun run check:fast
```

## 影响范围

必改文件：

- `platform/shared/runtime-evidence-types.ts`
- `platform/shared/context-packet-types.ts`
- `platform/shared/graph-it-live-runtime-evidence.ts`
- `platform/compiler/synthesize/build-context-packet.ts`
- `tests/unit/context-packet.test.ts`
- `tests/unit/graph-it-live-runtime-evidence.test.ts`

可能改文件：

- `platform/shared/types.ts`：如需统一 re-export 新类型。
- `platform/cli/formatters.ts`：如需给 Context Packet summary 预留格式化入口。
- `platform/shared/project-overview.ts` 或 Workbench templates：仅当本切口同时接入只读摘要展示时修改。
- `docs/09-AI Runtime、任务信封与治理规范.md` 与 `docs/11-Workbench与可视化规范.md`：同步实现边界。

明确不碰：

- `control/graph/explain-graph.json` 生成逻辑。
- Workbench mutation apply / dry-run 语义。
- contract freeze 必需 artifact 清单。
- dependency-cruiser / jscpd / discover 默认 preflight 链路。
- GitNexus MCP 默认依赖。

## 风险与控制

| 风险 | 控制 |
| --- | --- |
| 第二事实源 | Runtime evidence 只读、非 stable、不写 Explain Graph |
| 写权限泄漏 | `writeBounds` 只复制 TaskEnvelope，不从 evidence 推导 |
| provider schema 漂移 | adapter 输入宽松，输出统一 RuntimeEvidence |
| 范围膨胀 | 第一版不调用 MCP、不做 mutation、不做 graph overlay |
| 可见性不足 | 第一版提供 summary/formatter 与 Overview/Workbench 可消费入口，页面展示保持只读和最小化 |

## 回滚方式

本切口新增的是独立投影层和 adapter。回滚时可以删除新增类型、builder、adapter 和测试；现有 `TaskEnvelope`、adapt、repair、preflight、Explain Graph、Workbench mutation 不需要迁移。

## 成功标准

- PJC 能构造带 Graph-It-Live runtime evidence 的 Context Packet。
- Runtime evidence 能覆盖开发前定位、review 风险扫描、Workbench/Overview 辅助导航三种用途。
- 测试证明 Graph-It-Live related files 不会扩大 allowed paths。
- 测试证明 runtime evidence 保持 `stableArtifact: false`。
- 现有 task envelope、adapt、repair 和 canonical graph 行为不变。
