# Workbench 与可视化规范

> 目标：定义 Review Workbench、Explain Graph 可视化、语义合约型 block 与 Engineering IR 的演进原则。本文是产品操作面与可视化实现权威；具体 schema 落地仍需同步 `05`、`06`、`08`。

## 1. 终局原则

当前开发必须以最终形态为目标：v0.x 可以先采用文件装载型 block，但架构边界必须保留到语义合约型 block、Engineering IR、generator strategy、Review Workbench。

禁止方向：
- 把具体业务 block 写入核心编译器，例如 `CustomerInstallStrategy`、`TicketInstallStrategy`。
- 只依赖复制文件表达长期能力，导致 registry 退化为模板市场。
- 让人类 review 继续依赖分散 JSON、CLI 文本和手动文件树跳转。
- 以生成后的 `project/**` 反向推断业务语义作为主要事实源。

正确方向：
- 核心编译器只理解协议：manifest、capability、pin、slot、contract、generator、acceptance、policy、provenance。
- block 从 `manifest + files + tests` 演进为 `manifest + contracts + generators + files + tests`。
- 工程语义先进入 Engineering IR，再降级为 project 文件、测试、视图和治理产物。
- Workbench 以 graph、provenance、review summary 为主数据源，让代码生成结果可审查、可解释、可导航。

## 2. Workbench 定位

Workbench 不是普通 IDE，也不是低代码运行时。它是工程编译器的 review 操作面，负责回答：

- 当前 app 使用了哪些 block？
- block 之间如何依赖？
- capability、pin、slot 如何连接？
- 哪些 entity、operation、policy、view 由哪些合约声明？
- 哪些文件由 block、slot、generator、override 产生？
- 哪些 acceptance 和 policy 覆盖了这些产物？
- review 时应该优先看哪些风险点？
- repair、upgrade、override 会影响哪些节点和文件？

Workbench 初期必须优先做只读 review 面；交互式编辑与 mutation 在只读视图稳定后再进入。

## 3. 标准视图

| 视图 | 路径 | 目标 |
| --- | --- | --- |
| Source view | `control/workbench/views/source-view.html` | 展示 source 层事实源 |
| Slot rule view | `control/workbench/views/slot-rule-view.html` | 展示 slot、writable zone、AI 写入规则 |
| Graph view | `control/workbench/views/graph-view.html` | 展示 app/block/capability/pin/slot/file/acceptance/policy/issue 关系 |
| Review view | `control/workbench/views/review-view.html` | 聚合 review summary、verification、provenance、policy、repair、upgrade 风险 |

## 4. 可视化导出

Explain Graph 的主数据源仍是：

```text
control/graph/explain-graph.json
```

可视化导出是衍生产物：

```text
control/graph/explain-graph.mmd
control/graph/explain-graph.dot
```

推荐优先级：
1. Mermaid：适合 Markdown、PR、快速 review。
2. DOT/Graphviz：适合复杂依赖布局。
3. HTML Workbench：适合长期浏览、导航和风险聚合。
4. 交互式图编辑：只在只读视图稳定后进入。

Mermaid/DOT 导出不得成为新的事实源，只能从 `explain-graph.json`、`review-summary.json`、`provenance.json` 派生。

## 5. Graph View 内容

Graph view 至少应展示：

- app 节点。
- block 节点与依赖边。
- capability provider/consumer。
- pin 与 slot 连接。
- file artifact 与来源。
- acceptance 覆盖关系。
- policy 作用范围与失败状态。
- issue、repair、upgrade 相关节点。

最终形态还应展示 Engineering IR 节点：

- entity
- operation
- view
- event
- permission
- generator

推荐边类型：

| 边 | 含义 |
| --- | --- |
| `depends_on` | 依赖 |
| `provides` | 提供 capability |
| `connects_to` | pin/slot/能力连接 |
| `originates_from` | 文件或产物来源 |
| `writes_to` | 写入目标 |
| `verified_by` | 被 acceptance/test 验证 |
| `declares` | 合约声明语义节点 |
| `lowers_to` | 语义节点降级为中间或文件产物 |
| `generates` | generator 生成产物 |
| `enforces` | policy 强制约束 |
| `renders` | view 渲染 entity/operation |

## 6. Review View 内容

Review view 应优先回答人类 review 问题，而不是完整复刻所有 JSON。

必须包含：

- CI / verification 总状态。
- chain summary 与失败 stage。
- acceptance coverage 摘要。
- policy error/blocker 摘要。
- provenance 摘要：block、slot、generated、override 的产物数量和关键路径。
- 本次最需要 review 的文件列表。
- repair plan、upgrade plan、upgrade diagnostics 状态。
- artifact manifest 状态和缺失产物。

最终形态应增加：

- entity/operation 级别变更摘要。
- generator 产物 diff 摘要。
- contract → IR → file 的追踪链。
- 高风险节点排序。

## 7. 语义合约型 block

当前 block 可以是文件装载型：

```text
block = manifest + files + tests
```

最终 block 必须演进为语义合约型：

```text
block = manifest + contracts + generators + files + tests
```

其中：

- `manifest` 声明 id、version、kind、requires、provides、pins、slots、acceptance、policy、upgrade。
- `contracts` 声明 entity、operation、policy、view、event、permission 等工程语义。
- `generators` 声明如何按工程动作生成 service、API、DB schema、view、test、acceptance 等。
- `files` 保留为低级 escape hatch，用于兼容、不可抽象逻辑或特殊运行时代码。
- `tests` 验证 block 的合约和生成产物。

语义合约示意：

```yaml
contracts:
  entities:
    - id: Customer
      fields:
        - id: name
          type: string
          required: true
        - id: email
          type: email
          required: true
        - id: company
          type: string
          default: Unknown
      operations:
        - create
        - list
      policies:
        - tenant_scoped
      views:
        - form
        - table
```

该示意不是最终字段冻结，只表达方向：业务语义应通过合约进入系统，而不是通过核心编译器 hardcode。

## 8. Engineering IR

Engineering IR 是工程编译器的中间表示。它不是 LLVM IR 的复制，而是面向业务工程生成、验证和 review 的结构化图。

最小节点集合：

```text
app
block
capability
pin
slot
entity
operation
policy
view
event
permission
generator
file
acceptance
issue
repair
upgrade
```

IR 必须支持：

- 从 `source/app.yaml`、block manifest、contracts、slots、policy、acceptance 构建。
- 被 resolver/composer/generator/verify/repair/emit pass 读取或扩展。
- 降级为 `project/**` 文件。
- 生成 provenance、explain graph、review summary、workbench views。

IR 不应要求一开始覆盖所有语言或所有项目类型；优先覆盖标准业务后台、B2B SaaS、管理台、工单/CRM/ERP 子域。

## 9. Generator Strategy 原则

新增生成能力必须按工程动作扩展：

```text
generate-entity-service
generate-api-route
generate-prisma-model
generate-view
generate-acceptance-test
generate-policy-check
```

禁止按业务对象扩展：

```text
CustomerInstallStrategy
TicketInstallStrategy
generate-customer
generate-ticket
```

判断标准：如果新增一个 `Order`、`Invoice`、`Worklog` 需要改核心编译器分支，说明抽象错误；如果只需要新增 contract 或 block manifest，说明方向正确。

## 10. 工具证据层、L3 与双向操作层

### 10.1 工具分层

当前可视化与代码质量工具应按四层接入，不能混成单一事实源：

| 层 | 角色 | 当前候选 | 规则 |
| --- | --- | --- | --- |
| Evidence collection | 采集源码、依赖、重复、IDE 实时图、外部 repo/knowledge graph 证据 | `jscpd`、`dependency-cruiser`、`scripts/discover-all.ts`、Graph-It-Live/MCP、GitNexus、Graphify provider | 只产出 evidence，不直接决定平台 contract |
| Canonical graph | 归一为工程语义图 | Engineering IR、Explain Graph、Review Summary、Provenance | 平台主事实归一层 |
| Projection | 面向人和 AI 的投影视图 | Mermaid、DOT、HTML Workbench、IDE/VSCode adapter | 只能由 canonical graph 或 evidence overlay 派生 |
| Operation | 可审计操作层 | Workbench mutation、AI task envelope | 只通过结构化 mutation 回写 `source/**` |

Graph-It-Live 这类 VSCode/MCP 工具适合作为 IDE 实时探索和 AI 上下文工具，但不能成为平台事实源。它的 file graph、symbol view、call graph、MCP 工具结果只能作为可选 evidence/overlay 接入；CI、contract freeze、Workbench 主图仍以平台治理产物为准。

GitNexus provider 的定位是 repo query graph：call chain、execution flow、impact、dependency cluster 等只读索引结果；当前以 npm devDependency `gitnexus@1.6.3` 安装，许可证为 PolyForm-Noncommercial-1.0.0，因此只能作为开发期 evidence provider 使用，`gitnexus:analyze` 必须保持 `--skip-agents-md --no-stats`，不得让外部工具改写 agent 指令文件或输出 volatile stats；`gitnexus:mcp` 只作为 `.mcp.json` 暴露的只读 MCP 查询入口。Graphify provider 的定位是 code/docs/diagram knowledge graph：`graph.json`、`graph.html`、report 类输出只能作为外部知识图 evidence；当前以 PyPI `graphifyy==0.7.10` 通过 `uvx` 固定版本执行，不能误用 npm 上的随机图包 `graphify`。两者都必须经 provider adapter 归一为 draft evidence 或 overlay；不得直接覆盖 Explain Graph，不得驱动 Workbench mutation，也不得把 MCP/agent 查询结果升级为 authoring truth。

### 10.2 L1/L2/L3 质量图层

代码质量和工程可视化应区分三层：

| 层 | 当前覆盖 | 目标 |
| --- | --- | --- |
| L1 文本/token 重复 | `jscpd` | 发现复制粘贴、版本 overlay、模板重复 |
| L2 结构重复 | `scripts/discover-all.ts` 基于 AST 归一化哈希 | 发现变量名不同但函数结构相同的重复 |
| L3 语义/意图重复 | 预留 Engineering Pattern Graph | 识别“读取→校验→转换→输出”、“查询→判空→映射→返回”、“build→write artifact”等工程模式 |

L3 不应只做“语义 clone 分数”。它应输出可审查的工程模式候选：是否应该抽成 helper、formatter、contract builder、generator strategy、block primitive 或 acceptance/policy 规则。早期 L3 finding 只能作为 review suggestion，不得自动重构。

### 10.3 Evidence 与 overlay 路径原则

外部工具报告可以进入 `control/evidence/**` 或 `control/graph/*-overlay.json`，但必须标记来源、时间、工具版本和置信度。推荐预留类型：

```text
control/evidence/code-quality-report.json
control/evidence/architecture-boundary-report.json
control/evidence/semantic-pattern-report.json
control/graph/code-quality-overlay.json
control/graph/architecture-overlay.json
control/graph/semantic-pattern-overlay.json
```

这些路径在实现前不得加入 stable artifact 清单；当前只在 `platform/shared/tool-evidence-contract.ts` 中以 `stableArtifact: false` 的 draft report contract 固定 kind、summary 与 inspect 输出。升级为 stable artifact 时必须同步 `08` 的治理产物说明、`05` 的 CLI/工具入口和 contract freeze 范围。

### 10.4 图上操作与双向同步

Workbench 图可以成为操作层，但所有写入必须经过结构化 mutation：

```text
graph operation
  -> source/views/mutations/*.json
  -> platform workbench mutations apply
  -> source/app.yaml / source/model/** / source/views/**
  -> resolve / compose / adapt / verify / explain
  -> regenerated graph/workbench views
```

禁止图层直接写 `source/app.yaml`、`project/**` 或 `control/**`。第一批低风险 mutation 应限制在：add block、set block version、add/update slot description、add acceptance、connect capability/pin、create private block draft、promote lab/override 到受治理输入。每个 mutation 应声明 precondition、expected graph delta、risk level、需要重跑的 pass 和回滚/拒绝原因。

当前 Graph mutation dry-run 只输出内存中的 `source/views/mutations/*.json` 预览和 `control/workflow/graph-mutation-dry-run-report.json` 草案结构，`stableArtifact: false`，不得由 graph 层直接落盘；真正写入必须仍由受控 mutation 文件和 `platform workbench mutations apply` 完成。

### 10.5 对全业务 block 与流程架构的指导

图层不应只展示文件关系，还应反向指导 block、pin、flow 的设计。全业务 block 的管脚应逐步从简单 input/output 升级为 typed semantic port：

```yaml
id: ticket_created
direction: output
kind: event # event | data | command | query | policy | view | lifecycle
type: TicketRecord
scope: tenant
producer: ticket/basic
consumers: [worklog/basic, reporting/ticket-summary, notify/email-basic]
verifiedBy: [ticket_can_be_created]
policies: [tenant_scope_required]
```

流程架构应优先表达 entity、operation、event、state machine、policy、permission、view、acceptance 与 generator 的关系，再降级到文件和测试。判断标准：新增 `Order`、`Invoice`、`Ticket`、`Worklog` 时，应主要新增 contract/block manifest，而不是修改核心编译器分支。

### 10.6 实施计划与详细切口

当前详细实现计划以本文为权威，`03` 只维护阶段顺序。每个切口必须形成可验证闭环并独立提交。

| 顺序 | 切口 | 主要实现点 | 预期产物 | 验证 |
| --- | --- | --- | --- | --- |
| 1 | 原生图导出 | 从 `ExplainGraph` 纯函数生成 Mermaid/DOT；注册 paths、artifact contract、lock generated paths | `control/graph/explain-graph.mmd`、`control/graph/explain-graph.dot` | 定向单测 + `platform explain --json --compact` + contract freeze |
| 2 | 只读 Graph View | 在 `write-local-views` 增加 graph template；通用抽取 `ExplainGraph` 节点/边/类型明细，并用覆盖矩阵显式覆盖 app/block/capability/pin/slot/file/acceptance/policy/repair/upgrade；`issue` 作为 review overlay 展示 policy violation、failure point、repair blocker、upgrade diagnostic | `control/workbench/views/graph-view.html` | local view 内容断言 + coverage matrix + issue overlay + reference refresh |
| 3 | 只读 Review View | 聚合 review summary、verification chain、acceptance coverage、policy violation、provenance priority files、repair readiness、upgrade readiness、artifact missing diagnostics | `control/workbench/views/review-view.html` | review summary fixture + view 内容断言 + artifact/view contract + reference refresh |
| 4 | 工具 evidence contract 草案 | 定义 code-quality / architecture-boundary / semantic-pattern report 类型，但不加入 stable artifact | shared types + inspect/build 纯函数 | 类型检查 + schema/contract 单测 |
| 5 | L1/L2 evidence 接入 | 将 jscpd/discover/depcruise 输出归一为 evidence；保留工具原始报告路径；GitNexus/Graphify 先作为 optional provider adapter 入口，不进入 stable artifact | `control/evidence/*-report.json`（实现后再稳定） | fixture 转换测试 + preflight 文档化 |
| 6 | L3 Engineering Pattern Graph | 识别 read/validate/build/write、query/guard/map/return、build/write artifact 等 SEC 工程模式 | `semantic-pattern-report.json` + overlay | 低置信 suggestion 测试，不自动重构 |
| 7 | Graph mutation dry-run | 图操作先生成 mutation 和 expected graph delta，不直接写 source | `source/views/mutations/*.json` + dry-run report | apply 前后 graph delta 测试 |
| 8 | Typed semantic port | 扩展 pin/flow 的 kind、scope、producer/consumer、verifiedBy、policy 语义 | manifest/contract schema 更新 | resolve/graph/acceptance coverage 测试 |

Graph View 的通用抽取不能降低信息覆盖：页面必须包含 coverage matrix，逐项列出所有 canonical `ExplainGraph` node type（app/block/capability/pin/slot/file/acceptance/policy/override/repair/upgrade）的来源、展示位置和计数；原计划里的 `issue` 不作为伪造 node type，而作为 review overlay 汇总 policy violation、failure point、repair blocker 和 upgrade diagnostic。任何后续删减都必须先更新本 coverage contract 和对应测试。

Review View 不能成为第二套 review schema：它只从 `review-summary.json` 及现有 verification、coverage、policy、provenance、repair、upgrade、artifact evidence 派生人类 review 优先级，必须展示 dashboard、Engineering Semantic Diff、verification chain、coverage、policy violation、priority files、repair/upgrade readiness 和 missing artifact diagnostics。

L3 Engineering Pattern Graph 当前只输出 `stableArtifact: false` 的低置信 suggestion 和 file overlay edge；`autoRefactor` 必须保持 `false`，直到 CLI、Workbench、contract freeze 与回滚协议全部稳定后才能进入自动 mutation。

实现纪律：新增产物先保持 optional；只有 CLI inspect、contract freeze、artifact manifest、reference refresh、Workbench view、测试全部对齐后，才能升级为 stable artifact。Graph-It-Live/MCP、GitNexus、Graphify、CodeQL/CPG、SonarQube/Fallow 等外部能力只能先接入 evidence/overlay，不得绕过平台 graph builder 或 mutation apply。

## 11. 阶段路线

### v0.2

- 保持文件装载型 block 闭环稳定。
- 输出 `explain-graph.json`、`review-summary.json`、`provenance.json`。
- 增加 Mermaid/DOT 导出。
- 增加只读 `graph-view.html` 与 `review-view.html`。
- 将 `jscpd`、`dependency-cruiser`、`discover-all.ts`、Graph-It-Live/MCP、GitNexus、Graphify provider 定位为 evidence provider，先文档化边界，不直接扩展 stable artifact。

### v0.3

- 引入最小语义合约闭环。
- 支持 entity/operation/policy/view 节点进入 Engineering IR。
- 引入至少一个 generator strategy，从合约生成 service/API/DB/view/test 中的一条完整链路。

### v1.x

- 私有 registry 支持语义合约分发。
- Workbench 支持 review dashboard、风险排序、artifact 导航。
- acceptance graph 与 policy graph 深度集成。

### v2.x+

- 多目标栈生成。
- 远程 registry / marketplace。
- 托管验证与观测。
- 交互式 Workbench 和受控 mutation。

## 12. 与参考文档关系

`代码库可视化流程图工具与编译原理综合指南.md` 是调研和方法论参考，不是实现级权威。本文负责把其中与本项目相关的结论落为项目规范：

- 优先从已有治理 JSON 生成 Mermaid/DOT/HTML，而不是从源码反推架构。
- 可视化是 review 操作面，不是装饰性图表。
- LLVM/IR 思想的借鉴点是“中间表示与 pass 管线”，不是复制 LLVM 的通用机器码编译架构。
- 当前开发必须避免短期模板拼装把长期架构锁死。

## 13. 只读视图高级渲染升级实现记录 (v0.2 - 2026-05)

在 v0.2 版本开发中，完成了对只读 Graph View 和 Review View 的高保真可视化增强：

### 13.1 Graph View 增强
1. **图形化 Coverage Matrix（覆盖率图表矩阵）**：
   - 摒弃了单一的静态文本表格，引入了基于 CSS Grid 和线性渐变进度条（Progress Bars）的仪表盘式覆盖矩阵。
   - 显式计算并直观展示了 Blocks 覆盖率（`coveredBlockCount / blockCount`）与 Slots 覆盖率（`coveredSlotCount / slotCount`）的百分比指标，配合动态状态颜色（100% 绿色、非 100% 黄橙色）。
   - 聚合展示了 Acceptance 测试和 Policy 约束的数量概览。
2. **Manual Override 警告与注册表**：
   - 在 Graph Nodes 列表与 Node Type Detail 列表中，为被手动覆盖的节点与文件自动追加 `[Manual Override ⚠️]` 醒目标签。
   - 新增 **Manual Override Registry** 专用卡片，集中罗列所有被 Manual Override 的文件目标、来源 Type 及对应的业务块，方便审查人员快速定位受开发人员直接干预的代码区。

### 13.2 Review View 增强
1. **CI 链摘要**：
   - 直观地将 CI 运行状态与阶段详情整合展示，对 `passed`、`attention`、`failed` 提供色彩友好的卡片标签反馈。
2. **Engineering Semantic Diff 聚合**：
   - 新增 **Engineering Semantic Diff Aggregation** 模块，完整罗列了本次提交中涉及的所有语义变更源文件、Origin Type（如 generated, block, override 等）、Origin ID、以及其关联的能力块、受影响的垂直切片和运行时路由。
   - 配合展示潜在的回归风险（Regression Risks）与冲突对齐提示（Conflict & Alignment Hints）。
3. **缺失产物诊断 (Missing Artifact Diagnostics)**：
   - 在 Missing Artifacts 列表下方物理植入了 **Missing Artifact Remediation Guide** 智能诊断引导。
   - 当检测到有任何 stable 治理产物（如 `review-summary.json`, `graph.lock.json` 等）缺失时，提供针对性的 CLI 编译和验证修复步骤引导。


## 14. 契约驱动的可视化组装界面 (Visual Spec Builder) 架构与 IR 转换

为了解决低代码平台“黑盒不可控、代码难维护、强行绑定私有运行时”的行业死穴，本项目为用户规划了 **“契约驱动的可视化组装界面 (Visual Spec Builder)”**。该界面比常规低代码平台更加细致、高级，旨在提供 100% 受控的代码编译闭环。

### 14.1 核心设计哲学

1. **AI 开发无管脚，用户开发图形化**：
   - 对于 **AI 自动开发**，直接在后台通过纯 L3 语义契约（IR 级别）与 `app.yaml` 进行逻辑组装，无需任何图形界面。
   - 对于 **人类用户开发**，提供极具视觉冲击力与直观度的 **图形拓扑 Spec 连接器**，方便用户理解庞大系统的依赖与拼缝关系。
2. **纯粹的“契约编辑器”，拒绝生成黑盒脏代码**：
   - **低代码的通病**：前端拖拽后，在后台直接生成海量、充满 hardcode 细节的页面和数据库查询代码，变成无法维护的黑坑。
   - **本平台的方案**：Visual Spec Builder **不直接生成任何底层应用代码**。它只是一个**“声明式工程契约 the 图形渲染与编辑器”**。它将用户的拖拉拽操作归一化为结构性的 `mutations`，然后触发平台编译器在 10s 内重新 Stitch/Compose 出 100% 纯净、无任何硬编码的工业级 TypeScript/Next.js 全套源码！

### 14.2 可视化拓扑映射模型与 IR 转换

Visual Spec Builder 采用 **“Node-Link” 拓扑映射模型**，在前端将 `explain-graph.json` 渲染为高度可交互的工程图谱，支持以下 4 类核心图形操作，并在后端实时物化为 L3 Engineering IR 与契约文件：

```text
 用户在 UI 图形拖拽/连线
   │
   ├──► 1. 拖入 Block 卡片 ──────► 产生 add-block 动作
   ├──► 2. Slot 管脚连线 ────────► 映射 Custom Slot 契约
   ├──► 3. 数据模型连线 ──────────► 缝合 Prisma Relation
   └──► 4. 挂载 Acceptance ──────► 建立 100% 验收覆盖边
   │
   ▼
 产生结构化 Mutation (source/views/mutations/*.json)
   │
   ▼
 运行 `sec workbench mutations apply` 写入 `source/app.yaml`
   │
   ▼
 触发编译管道 `sec compose && sec adapt` ──────► 生成 100% 纯净代码 (project/)
```

1. **Block 卡片拓扑组件 (Block Card Nodes)**：
   - 每一个 Block（如 `tenant/basic-workspace`, `auth/basic-session`）以高保真的逻辑卡片展示，清晰标识其 **Requires（输入引脚）** 和 **Provides（输出引脚）**。
   - 用户拖入新 Block，或用线连接两个引脚，在后端生成 `add-block` 或 `connect-dependency` 契约，自动写入 `source/app.yaml` 的 `blocks` 列表。
2. **Slots（管脚）物理对齐连接 (Slots Alignment Link)**：
   - 在 Block 卡片上，会将声明的所有 `slots` 物理暴露为“插头”。
   - 用户可以点击插头拖出一条连接线，指向开发者的物理源码路径（如 `source/code/slots/ticket_resolver.ts`）。
   - 图形上会实时对齐 Slot 声明的 `inputType` / `outputType` 类型，一旦类型不匹配，连接线变红并报错。映射关系自动写入 `source/app.yaml` 的 `slots` 段落。
3. **数据模型缝合图示 (Schema Stitching View)**：
   - 展示缝合后的 `schema.prisma` 实体模型图，并清晰用虚线高亮显示跨 Block 自动注入的关系（例如租户 ID 如何自动行级缝合到工单实体）。
   - 用户可以在 UI 上配置缝合字段的审计 Policy 策略，自动关联到 Policy Gate。
4. **验收用例 (Acceptance) 挂载拦截**：
   - 所有的 Acceptance 验收测试用例在图上作为绿色“盾牌”节点展示。
   - 用户可以将盾牌拖动连接到具体的 Block 卡片或 Slot 插头上，表示“必须跑通此测试才允许将此 Block/Slot 判定为可信”。后端自动在 `acceptance` 数组里增加覆盖边，在 `verify` 阶段强行拦截。

### 14.3 双向同步与安全回写

1. **Mutation 缓冲回写机制**：
   - 用户的任何图形操作 **严禁直接写 `project/` 下的运行源码，也严禁直接写 `control/` 下的治理哈希**。
   - 所有操作先在浏览器内存中生成一份可被撤销与重做的标准 `source/views/mutations/change_xxxx.json` 片段。
   - 当用户点击“应用变更并重新编译”时，调用 `platform workbench mutations apply` 命令将修改回写进核心事实源 `source/app.yaml`。
2. **编译器极速重缝合 (Compiler Stitching Loop)**：
   - 回写成功后，平台自动并行触发 `compose` 与 `adapt` Pass，在 10s 内重新装配出完整的 Next.js 页面与 Prisma 模型。
   - 接着触发 affected verify，只对发生变动的 Slot 或 Block 跑 Playwright 验收。全部通过后，利用 `sec lock` 重新锁定哈希，生成全新的只读 `explain-graph.json`，并将最新图谱状态实时推送回前端界面渲染。
   - 这一“双向闭环”确保了图形化开发和契约编译 of 绝对纯净与高度一致！

### 14.4 本地 HTTP 双向热编译服务 (Dynamic API Server)

为了彻底打通双向实时同步编辑的闭环，在 `sec workbench --serve` 命令中内置启动一个 Bun 原生的轻量级 Web 服务器：

1. **静态资源路由**：
   - 直接伺服 `control/workbench/views/` 目录下的 HTML 文件。
   - 当请求 `/` 时，默认重定向或服务 `overview-view.html`。
2. **数据交互 API**：
   - `GET /api/graph`：直接读取并返回最新的 `control/graph/explain-graph.json`。
   - `GET /api/review`：直接读取并返回最新的 `control/graph/review-summary.json`。
   - `POST /api/mutations`：接收前端发送的 Mutations 列表，写入工作区 `source/views/mutations/graph-action.json`。
   - `POST /api/compile`：依次触发以下编译管道 Pass：`resolve` -> `compose` -> `adapt` -> `verify` -> `lock` -> `explain`。支持将编译日志以 SSE (Server-Sent Events) 的形式实时流式传回前端。
   - `POST /api/run-node`：接收前端对特定 block/slot 的单节点调试请求，自动在 `tests/` 目录下匹配其专属的 `.test.ts` 单元测试跑局部验证，或执行 Slot 静态 AST 安全审计，并以 SSE 流的形式实时返回流式日志，在流关闭时自动物理清理子进程句柄。

### 14.5 低代码与 n8n 画布完美交互演进记录 (v0.2.2 - 2026-05)

在 v0.2.2 版本中，完成了工作台画布交互的高保真大升级，综合低代码与 n8n 核心交互规范：
1. **Node Sidebar 常驻组件目录**：在画布左侧设计了常驻的 Catalog 栏，划分 Blocks 与 Slots，用户可以双击列表项或用鼠标拖拽组件卡片进入画布，在指定坐标自动映射生成节点并追加 `add-block` mutation。
2. **图形化连线绑定与键盘解绑**：开启 Vis.js 网络的编辑模式，鼠标画线在 Block 和 Slot 节点之间直接绑定管脚（Stitch Slots），触发快捷属性配置弹窗；选中连线/节点点击 Delete/Backspace 键直接物理抹除，回写 `unbind-slot` / `remove-block` mutations。
3. **单节点流式验证调试器 (Single Node Runner)**：在 Drawer 属性检查面板下方集成 Runner Console 终端，通过 `POST /api/run-node` 发起流式验证，在后台对 slot 运行 AST 静态安全分析，或对 block 自动匹配 `tests/` 文件夹下的专属单元测试（模糊匹配），或增量执行 verify 快轨，实时把调试日志写回抽屉中。
4. **霓虹状态感知特效 (Status Aura & Glows)**：融合 review 及 violations 数据判定节点状态（❌ Failed / ⚠️ Warning / ✅ Passed），并利用霓虹微光发光圈和徽章进行物理着色，未应用 mutations 节点亮警示黄，已通过验证节点亮青翠绿，出现违规或错误节点亮深红霓虹，提供极佳的图形直观度。


## 15. 可组合前端的“视觉美学隔离与设计系统 Token 桥”

当来自 16+ 个不同 Block（包括官方与私有）的 UI 组件（如 `LoginForm`、`CustomerAttachmentForm`、`AIAgentClassifierBadge`）通过 `uiHooks` 被拼缝注入到同一个页面 Portal 时，为了防止样式冲突、坍塌或视觉风格破裂，平台在前端实施严苛的**视觉隔离与设计 Token 桥接约束**：

### 15.1 语义设计 Token 桥 (Design Token Bridge)

1. **封禁 ad-hoc 样式**：
   - 任何 Block 携带的前端组件，严禁在 JSX/CSS 中手写硬编码的颜色、间距或字体大小（如 `style={{ color: '#FF0000', margin: '15px' }}`）。
2. **强制语义 Token 绑定**：
   - 所有的视觉属性必须强制绑定平台定义的主题语义变量（Design Tokens），如：
     - 背景色：`bg-primary`（主板卡背景）、`bg-secondary`（灰底卡片背景）
     - 前景色：`text-main`（主文本）、`text-muted`（灰体文本）
     - 间距：`gap-card`（卡片间距）、`p-card`（内边距）
   - 这确保了不管由哪个 Block 注入何种组件，其最终的视觉饱和度、圆角和暗黑模式支持与主系统 100% 保持极致契合与高端美感。

### 15.2 前端 CSS 样式隔离沙盒 (Prefix Sandboxing)

1. **CSS Scope 局部样式化**：
   - 注入的 React 组件必须使用 **CSS Modules**（即 `styles.module.css`）或者是 CSS-in-JS 的 Scope 属性，限制其所编写的所有 class 样式仅作用于组件本尊。
2. **Tailwind 前缀隔离沙盒 (Prefix Sandboxing)**：
   - 如果 Block 使用 TailwindCSS 编写，为了防止其类名污染全局或与主生成项目冲突，编译器在 Compose 时，会自动对该 Block 注入的组件样式进行正则预处理，强制为其所有的 Tailwind utility 类名加上 **Block 专属前缀**（如将 `className="flex items-center"` 重写为 `className="block-attachment-flex block-attachment-items-center"`）。
   - 该样式沙盒机制在物理层彻底掐死了前端样式大混战与 UI 退化风险！


