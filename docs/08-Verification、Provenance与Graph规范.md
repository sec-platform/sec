# Verification、Provenance 与 Graph 规范

> 目标：定义验收、Policy、来源追踪和可解释图谱。

## 1. Verification 层级

| 层级 | 组件 | 说明 |
| --- | --- | --- |
| Fast lane | typecheck + 快速单元测试 + 快速验收 + policy gate | 默认本地验证 |
| Runtime lane | runtime service/unit 测试 | CI PR 推送到此层 |
| All lane | Next build + Vitest 全量 + Playwright acceptance + browser | 完整循环 |

当前已实现：`verify --lane fast|runtime|all --json [--compact]`，输出 `control/evidence/verification-report.json`。

CI 质量门禁由 `platform/shared/ci-contract.ts` 统一声明；`imports:check` 在 typecheck 之后检查 TypeScript import baseline，漂移时本地运行 `imports:organize` 修复，定时 full CI 复用同一门禁。

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

Edge 类型：`connects_to`、`depends_on`、`originates_from`、`provides`、`verified_by`、`writes_to`。语义合约扩展边类型预留：`declares`、`lowers_to`、`generates`、`enforces`、`renders`。

## 6. Review Summary

输出：`control/evidence/review-summary.json`。聚合 CI 摘要、链摘要、覆盖率、provenance、repair、upgrade、policy 的全部摘要信息。

Review Summary 是 Review Workbench 的主数据源之一。它必须优先回答人类 review 问题：哪些 block/slot/entity/operation 发生变化、哪些文件由哪些合约或 generator 产生、哪些 acceptance/policy 失败、哪些路径需要人工决策。

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

`jscpd`、`dependency-cruiser`、`scripts/discover-all.ts`、Graph-It-Live/MCP、未来 trace 或 IDE graph 工具可以作为 evidence provider 接入治理面，但不能替代 `source/app.yaml`、block manifest、contracts、graph lock、provenance、review summary 等事实源。

预留 evidence / overlay 类型：

| 类型 | 预留路径 | 说明 | 稳定性 |
| --- | --- | --- | --- |
| Code quality report | `control/evidence/code-quality-report.json` | 聚合 L1/L2 重复、复杂度、死代码、候选重构 | 已定义 draft adapter，不属于当前 stable artifact |
| Architecture boundary report | `control/evidence/architecture-boundary-report.json` | 聚合 dependency-cruiser、cycle、module boundary、layer drift | 已定义 draft adapter，不属于当前 stable artifact |
| Semantic pattern report | `control/evidence/semantic-pattern-report.json` | L3 工程模式/意图重复候选，如 read-validate-build-write | 已定义 draft adapter，不属于当前 stable artifact |
| Quality overlay | `control/graph/code-quality-overlay.json` | 将质量 finding 映射到 file/function/block/slot 节点 | 未实现，不属于当前 stable artifact |
| Architecture overlay | `control/graph/architecture-overlay.json` | 将依赖边界和循环风险映射到 graph view | 未实现，不属于当前 stable artifact |
| Semantic pattern overlay | `control/graph/semantic-pattern-overlay.json` | 将 L3 pattern 映射为 review suggestion 或 generator/block 候选 | 未实现，不属于当前 stable artifact |

实现这些路径时必须同步 contract freeze、artifact manifest、CLI compact contract 和 Workbench view；实现前不得把它们加入当前治理产物必需清单。
