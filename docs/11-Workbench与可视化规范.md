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

## 10. 阶段路线

### v0.2

- 保持文件装载型 block 闭环稳定。
- 输出 `explain-graph.json`、`review-summary.json`、`provenance.json`。
- 增加 Mermaid/DOT 导出。
- 增加只读 `graph-view.html` 与 `review-view.html`。

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

## 11. 与参考文档关系

`代码库可视化流程图工具与编译原理综合指南.md` 是调研和方法论参考，不是实现级权威。本文负责把其中与本项目相关的结论落为项目规范：

- 优先从已有治理 JSON 生成 Mermaid/DOT/HTML，而不是从源码反推架构。
- 可视化是 review 操作面，不是装饰性图表。
- LLVM/IR 思想的借鉴点是“中间表示与 pass 管线”，不是复制 LLVM 的通用机器码编译架构。
- 当前开发必须避免短期模板拼装把长期架构锁死。
