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
| Evidence collection | 采集源码、依赖、重复、IDE 实时图证据 | `jscpd`、`dependency-cruiser`、`scripts/discover-all.ts`、Graph-It-Live/MCP | 只产出 evidence，不直接决定平台 contract |
| Canonical graph | 归一为工程语义图 | Engineering IR、Explain Graph、Review Summary、Provenance | 平台主事实归一层 |
| Projection | 面向人和 AI 的投影视图 | Mermaid、DOT、HTML Workbench、IDE/VSCode adapter | 只能由 canonical graph 或 evidence overlay 派生 |
| Operation | 可审计操作层 | Workbench mutation、AI task envelope | 只通过结构化 mutation 回写 `source/**` |

Graph-It-Live 这类 VSCode/MCP 工具适合作为 IDE 实时探索和 AI 上下文工具，但不能成为平台事实源。它的 file graph、symbol view、call graph、MCP 工具结果只能作为可选 evidence/overlay 接入；CI、contract freeze、Workbench 主图仍以平台治理产物为准。

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
| 5 | L1/L2 evidence 接入 | 将 jscpd/discover/depcruise 输出归一为 evidence；保留工具原始报告路径 | `control/evidence/*-report.json`（实现后再稳定） | fixture 转换测试 + preflight 文档化 |
| 6 | L3 Engineering Pattern Graph | 识别 read/validate/build/write、query/guard/map/return、build/write artifact 等 PJC 工程模式 | `semantic-pattern-report.json` + overlay | 低置信 suggestion 测试，不自动重构 |
| 7 | Graph mutation dry-run | 图操作先生成 mutation 和 expected graph delta，不直接写 source | `source/views/mutations/*.json` + dry-run report | apply 前后 graph delta 测试 |
| 8 | Typed semantic port | 扩展 pin/flow 的 kind、scope、producer/consumer、verifiedBy、policy 语义 | manifest/contract schema 更新 | resolve/graph/acceptance coverage 测试 |

Graph View 的通用抽取不能降低信息覆盖：页面必须包含 coverage matrix，逐项列出所有 canonical `ExplainGraph` node type（app/block/capability/pin/slot/file/acceptance/policy/override/repair/upgrade）的来源、展示位置和计数；原计划里的 `issue` 不作为伪造 node type，而作为 review overlay 汇总 policy violation、failure point、repair blocker 和 upgrade diagnostic。任何后续删减都必须先更新本 coverage contract 和对应测试。

Review View 不能成为第二套 review schema：它只从 `review-summary.json` 及现有 verification、coverage、policy、provenance、repair、upgrade、artifact evidence 派生人类 review 优先级，必须展示 dashboard、verification chain、coverage、policy violation、priority files、repair/upgrade readiness 和 missing artifact diagnostics。

L3 Engineering Pattern Graph 当前只输出 `stableArtifact: false` 的低置信 suggestion 和 file overlay edge；`autoRefactor` 必须保持 `false`，直到 CLI、Workbench、contract freeze 与回滚协议全部稳定后才能进入自动 mutation。

实现纪律：新增产物先保持 optional；只有 CLI inspect、contract freeze、artifact manifest、reference refresh、Workbench view、测试全部对齐后，才能升级为 stable artifact。Graph-It-Live/MCP、CodeQL/CPG、SonarQube/Fallow 等外部能力只能先接入 evidence/overlay，不得绕过平台 graph builder 或 mutation apply。

## 11. 阶段路线

### v0.2

- 保持文件装载型 block 闭环稳定。
- 输出 `explain-graph.json`、`review-summary.json`、`provenance.json`。
- 增加 Mermaid/DOT 导出。
- 增加只读 `graph-view.html` 与 `review-view.html`。
- 将 `jscpd`、`dependency-cruiser`、`discover-all.ts`、Graph-It-Live/MCP 等工具定位为 evidence provider，先文档化边界，不直接扩展 stable artifact。

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
