# Verification、Provenance 与 Graph 规范

> 目标：定义验收、Policy、来源追踪和可解释图谱。

## 1. Verification 层级

| 层级 | 组件 | 说明 |
| --- | --- | --- |
| Fast lane | typecheck + 快速单元测试 + 快速验收 + policy gate | 默认本地验证 |
| Runtime lane | runtime service/unit 测试 | CI PR 推送到此层 |
| All lane | Next build + Vitest 全量 + Playwright acceptance + browser | 完整循环 |

当前已实现：`verify --lane fast|runtime|all --json [--compact]`，输出 `control/evidence/verification-report.json`。

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

Edge 类型：`connects_to`、`depends_on`、`originates_from`、`provides`、`verified_by`、`writes_to`。

## 6. Review Summary

输出：`control/evidence/review-summary.json`。聚合 CI 摘要、链摘要、覆盖率、provenance、repair、upgrade、policy 的全部摘要信息。

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
| Review summary | `control/evidence/review-summary.json` |
| Repair plan | `control/workflow/repair-plan.json` |
| Upgrade plan | `control/workflow/upgrade-plan.json` |
| CI artifacts manifest | `control/ci/artifacts.json` |
| Source view | `control/workbench/views/source-view.html` |
| Slot rule view | `control/workbench/views/slot-rule-view.html` |
