# Verification、Provenance 与 Graph 规范

> 目标：定义验收、Policy、来源追踪和可解释图谱。

## 1. Verification 层级

仓库测试架构的开发者入口固定为 affected / fast / slow / full 四类，具体口径见 `docs/test-architecture.md`。

| 入口 | 组件 | 说明 |
| --- | --- | --- |
| affected | typecheck + affected fast tests | 本地与 PR quick 的变更反馈入口 |
| fast | typecheck + full fast tests | 不含 slow e2e / Playwright 的快速回归入口 |
| slow | impact-selected slow suites / slow files | PR risk 与人工风险验证入口 |
| full | release preflight + slow-suite matrix + workspace correctness backstop | schedule/manual/full label 的完整循环 |

生成项目 verification 仍由平台命令 `verify --lane fast|runtime|all --json [--compact]` 输出 `control/evidence/verification-report.json`；其中 Playwright 只属于 runtime full / all 边界，不进入 affected 或 fast 入口。

### 1.1 Playwright 混合运行时验收机制

在无头浏览器中运行 Playwright 验收测试时，为了在大规模测试中兼顾调试效率与 SCM 存储开销，系统执行混合验收方案：
1. **像素级视觉防退化 (Visual Regression)**：测试成功通过时，Playwright 只保留特定页面或组件的关键 Baseline 像素截图，通过 `expect(page).toHaveScreenshot()` 自动检测 UI 样式破损和折行冲突。
2. **故障 Trace ZIP 诊断**：测试失败时，Playwright 不生成大体积视频，而是保存 HTML Trace ZIP 归档并解压到本地临时目录。本地 Review 工作台在 iframe 中内嵌官方的 Trace UI，供开发者和 AI 交互式审查 DOM、控制台报错和网络请求。
3. **录像演示仅用于终审**：仅在终审评审阶段（Review Sign-off）为通过的用例生成 WebM 录制视频，方便架构师和人类审核员进行体感走通，避免在大规模测试中生成视频并污染 Git 仓库。
4. **调试会话挂载**：在 AI 修复沙盒或本地验证中，支持配置 `--interactive-debugger` 或 `--head` 参数，通过 CDP 端口允许开发者在真浏览器中实时监控并操纵执行流。
5. **Block 级独立容差**：允许在 `block.manifest.yaml` 中通过 `visualVerification` 自定义配置私有的像素容差阈值（如 `maxDiffPixels` 或 `maxDiffPixelRatio`），兼顾高动态组件与强业务界面的差异。

CI 质量门禁由 `platform/shared/ci-contract.ts` 统一声明；PR quick 与 release preflight 通过 `imports:organize` 收敛 TypeScript import baseline。本地可按需运行 `imports:check` 审计漂移，但 affected/fast 验证不以前者为前置条件。

## 2. Acceptance

### `source/app.yaml`

```yaml
acceptance:
  - id: user_can_login
  - id: user_can_create_customer
  - id: user_can_list_customers
  - id: tenant_only_sees_own_customers
```

### block.manifest.yaml（扩展格式）

```yaml
acceptance:
  - id: user_can_create_customer
    dependsOn: [user_can_login]
    covers:
      blocks: [entity/customer-basic]
      slots: [customer_normalizer]
```

- `id` 全局唯一，`dependsOn` 引用已声明 acceptance
- `covers` 用于 coverage 计算
- coverage 报告：`control/evidence/acceptance-coverage.json`

## 3. Policy Gate

### policy.spec.yaml

```yaml
policies:
  - id: tenant-scope-required
    severity: error
    appliesTo: [entity/customer-basic, ticket/basic, worklog/basic]
    rule: tenant_context_must_flow_to_query
```

Severity：`info` / `warn` / `error` / `blocker`。`error` 或 `blocker` 失败时 verification 必须失败。

输出：`control/evidence/policy-report.json`。

## 4. Provenance

输出：`control/provenance/provenance.json`。每个 artifact 记录：

| 字段 | 说明 |
| --- | --- |
| `path` | 文件路径 |
| `originType` | `block` / `slot` / `generated` / `override` |
| `originId` | 来源标识 |
| `sourceBlock` | 来源 block |
| `sourcePath` | 源码层 slot 路径 |
| `runtimeTarget` | v0.1 兼容物化目标 |
| `generatedByPass` | 生成 pass |
| `generatorTaskId` | AI task id |
| `verifiedBy` | 通过的测试列表 |
| `overrideStatus` | `none` / `manual` / `rule-backed` |

## 5. Explain Graph

输出：`control/graph/explain-graph.json`。Node 类型：`app`、`block`、`capability`、`pin`、`slot`、`file`、`acceptance`、`policy`、`issue`、`repair`、`upgrade`。

最终形态下，Explain Graph 必须能容纳 Engineering IR 节点：`entity`、`operation`、`view`、`event`、`permission`、`generator`。这些节点用于说明语义合约如何被降级为文件、测试、策略与验收，而不是只展示文件复制关系。

### 5.1 Engineering IR (工程中间表示) 标准 Schema 规规约

为了支持多维图结构表达，并方便与外部可视化工具及知识库连通，我们将 Engineering IR 标准化为**基于邻接表的有向属性图 (Property DAG)**，其标准的 JSON Schema 设计如下：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EngineeringIR",
  "type": "object",
  "required": ["formatVersion", "appId", "nodes", "edges"],
  "properties": {
    "formatVersion": { "type": "string", "const": "1" },
    "appId": { "type": "string" },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "type", "label", "metadata"],
        "properties": {
          "id": { "type": "string" },
          "type": {
            "type": "string",
            "enum": [
              "app", "block", "capability", "pin", "slot", 
              "entity", "operation", "policy", "view", "event", 
              "permission", "generator", "file", "acceptance", "issue"
            ]
          },
          "label": { "type": "string" },
          "metadata": {
            "type": "object",
            "properties": {
              "sourcePath": { "type": "string" },
              "signature": { "type": "string" },
              "owner": { "type": "string" },
              "status": { "type": "string" },
              "riskLevel": { "type": "string", "enum": ["low", "medium", "high"] }
            }
          }
        }
      }
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["source", "target", "relation"],
        "properties": {
          "source": { "type": "string" },
          "target": { "type": "string" },
          "relation": {
            "type": "string",
            "enum": [
              "depends_on", "provides", "connects_to", "originates_from", 
              "writes_to", "verified_by", "declares", "lowers_to", 
              "generates", "enforces", "renders"
            ]
          },
          "metadata": { "type": "object" }
        }
      }
    }
  }
}
```

Edge 类型：`connects_to`、`depends_on`、`originates_from`、`provides`、`verified_by`、`writes_to`。语义合约扩展边类型预留：`declares`（声明）、`lowers_to`（编译降级）、`generates`（代码生成）、`enforces`（策略强制）、`renders`（界面渲染）。

在 Review 工作台的可视化图谱上，当检测到开发者手写的 Override 自定义逻辑时，相关节点需标为**橘色 (Orange)** 以警示 AI 避免改写。此外，Explain Graph 会同时绘制 Policy 规约关联的 `Audited By` 有向边，以及升级迁移历史的轨迹。

## 6. Review Summary

输出：`control/evidence/review-summary.json`。聚合 CI 摘要、链摘要、覆盖率、provenance、repair、upgrade、policy 的全部摘要信息。

Review Summary 是 Review Workbench 的主数据源之一。它必须优先回答人类 review 问题：哪些 block/slot/entity/operation 发生变化、哪些文件由哪些合约或 generator 产生、哪些 acceptance/policy 失败、哪些路径需要人工决策。

### Engineering Semantic Diff

Engineering Semantic Diff 是 review 语义合同，不是单独的新事实源。它从 lock、Engineering IR / Explain Graph、provenance、verification、acceptance coverage、policy report、repair/upgrade plan 派生，用于把 review 从代码行差异提升为工程语义差异。

最小 diff 维度：

| 维度 | 必须回答的问题 |
| --- | --- |
| capability / block | 能力、block、版本、来源或 trust level 是否变化 |
| pin / slot / contract | 连接、类型、slot 边界、语义合约或 generator 是否变化 |
| policy / acceptance | policy 约束、验收覆盖、失败链是否变化 |
| provenance / artifact | 生成路径、人工 override、未验证 artifact 是否变化 |
| runtime / upgrade | runtime evidence、migration、rollback、override conflict 是否变化 |
| risk | 是否引入 failure point、regression risk、conflict hint 或人工决策点 |

在独立 stable artifact 落地前，Semantic Diff 应作为 `review-summary.json` 和 Workbench Review View 的派生 section；不得新增第二套 review schema，也不得绕过 `review-summary.json`、provenance 或 explain graph 直接从源码 diff 推断平台结论。

## 7. 治理产物清单

| 产物 | 路径 |
| --- | --- |
| Graph lock | `control/state/graph.lock.json` |
| Provenance | `control/provenance/provenance.json` |
| Verification report | `control/evidence/verification-report.json` |
| Runtime report | `control/evidence/runtime-report.json` |
| Policy report | `control/evidence/policy-report.json` |
| Acceptance coverage | `control/evidence/acceptance-coverage.json` |
| Install manifest | `control/evidence/install-manifest.json` |
| Block usage map | `control/evidence/block-usage-map.json` |
| Explain graph | `control/graph/explain-graph.json` |
| Explain graph Mermaid | `control/graph/explain-graph.mmd` |
| Explain graph DOT | `control/graph/explain-graph.dot` |
| Review summary | `control/evidence/review-summary.json` |
| Repair plan | `control/workflow/repair-plan.json` |
| Upgrade plan | `control/workflow/upgrade-plan.json` |
| CI artifacts manifest | `control/ci/artifacts.json` |
| Source view | `control/workbench/views/source-view.html` |
| Slot rule view | `control/workbench/views/slot-rule-view.html` |
| Graph view | `control/workbench/views/graph-view.html` |
| Review view | `control/workbench/views/review-view.html` |

## 8. 质量、架构与语义模式 evidence 预留

`jscpd`、`dependency-cruiser`、`scripts/discover-all.ts`、Graph-It-Live/MCP、GitNexus repo graph provider、Graphify knowledge graph provider、未来 trace 或 IDE graph 工具可以作为 evidence provider 接入治理面，但不能替代 `source/app.yaml`、block manifest、contracts、graph lock、provenance、review summary 等事实源。

预留 evidence / overlay 类型：

| 类型 | 预留路径 | 说明 | 稳定性 |
| --- | --- | --- | --- |
| Code quality report | `control/evidence/code-quality-report.json` | 聚合 L1/L2 重复、复杂度、死代码、候选重构 | 已定义 draft adapter，不属于当前 stable artifact |
| Architecture boundary report | `control/evidence/architecture-boundary-report.json` | 聚合 dependency-cruiser、cycle、module boundary、layer drift | 已定义 draft adapter，不属于当前 stable artifact |
| Semantic pattern report | `control/evidence/semantic-pattern-report.json` | L3 工程模式/意图重复候选，如 read-validate-build-write | 已定义 draft report，不属于当前 stable artifact |
| Quality overlay | `control/graph/code-quality-overlay.json` | 将质量 finding 映射到 file/function/block/slot 节点 | 未实现，不属于当前 stable artifact |
| Architecture overlay | `control/graph/architecture-overlay.json` | 将依赖边界和循环风险映射到 graph view | 未实现，不属于当前 stable artifact |
| Semantic pattern overlay | `control/graph/semantic-pattern-overlay.json` | 将 L3 pattern 映射为 review suggestion 或 generator/block 候选 | 已定义 draft overlay，不属于当前 stable artifact |

实现这些路径时必须同步 contract freeze、artifact manifest、CLI compact contract 和 Workbench view；实现前不得把它们加入当前治理产物必需清单。

## 9. 带外门禁 (Compiler Gates) 与 SCM 约束

为了防止 AI 编写助手（如 Claude Code、Cursor）或人类开发人员绕过编译器直接改写生成的物理代码，编译链在本地 `se verify` 和 CI 阶段强制实施带外硬拦截：
1. **SCM 物理隔离 (Gitignore)**：项目的根目录 `.gitignore` 必须将 `project/` 整体忽略。禁止在版本控制中提交生成的项目源码，使 Git 库中仅包含纯粹的开发层 `source/` 和控制面配置。
2. **物理只读锁 (File-system Readonly Lock)**：在 `se compose --lock` 运行后，除了已声明为 Writable Zones 的插槽文件外，编译器通过操作系统文件系统属性将 `project/**` 内的文件全部设为 **只读 (Read-only)**，在物理层拦截任何外部直接编辑。
3. **代码漂移门禁 (Reference Drift Gate)**：在 `se verify` 运行期间，验证器逐一比对 `project/` 文件与 `control/provenance/provenance.json` 记录的签名哈希。一旦在只读 Zone 检测到任何非预期修改，抛出 **`ERROR-DRIFT-001`** 并中断发布/部署。
4. **合约冻结门禁 (Contract Freeze Gate)**：在 CI 合约审查流水线中，静态分析器对比生成代码的符号签名与已冻结的契约。如果在没有进行 Semver 版本变更的情况下接口签名发生了变化，即使测试通过，编译门禁依然予以强行拦截。
