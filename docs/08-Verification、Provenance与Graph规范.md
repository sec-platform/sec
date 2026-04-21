# Verification、Provenance 与 Graph 规范

> 目标：定义验收、政策、来源追踪和可解释图谱，使平台不止“能生成”，还能“能证明、能解释、能回放”。

## 1. Verification 层级

### `v0.1`

- typecheck
- build
- unit tests
- acceptance

### `v0.2+`

- policy gate
- regression check
- baseline perf check
- upgrade verification

## 2. Acceptance DSL

### `v0.1` 简化格式

```yaml
acceptance:
  - id: user_can_login
  - id: user_can_create_customer
  - id: user_can_list_customers
  - id: tenant_only_sees_own_customers
```

### `v0.2+` 扩展格式

```yaml
acceptance:
  - id: tenant_only_sees_own_customers
    kind: playwright
    tags:
      - critical
      - tenant
    dependsOn:
      - user_can_login
    covers:
      blocks:
        - auth/basic-session
        - tenant/basic-workspace
        - entity/customer-basic
      slots:
        - customer_normalizer
```

### 规则

- `id` 全局唯一
- `dependsOn` 只能引用已声明 acceptance
- `covers` 用于后续 coverage 计算

## 3. Policy Gate

### `v0.2+` 最小字段

```yaml
policies:
  - id: tenant-scope-required
    severity: error
    appliesTo:
      - entity/customer-basic
    rule: tenant_context_must_flow_to_query
```

### severity

- `info`
- `warn`
- `error`
- `blocker`

### gate 规则

- `error` 或 `blocker` 失败时，`verify` 必须失败。

## 4. `verification-report.json`

### 顶层结构

```json
{
  "build": { "status": "passed" },
  "unit": { "status": "passed" },
  "acceptance": { "status": "passed", "passed": [], "failed": [] },
  "policy": { "status": "skipped", "violations": [] },
  "summary": { "status": "passed" }
}
```

### 规则

- `summary.status` 由最严重子状态归约得出。
- 每个失败项必须关联 block、slot 或文件路径。

## 5. Provenance 模型

### `provenance.json`

```json
{
  "formatVersion": "1",
  "artifacts": [
    {
      "path": "custom/customer_normalizer.ts",
      "originType": "slot",
      "originId": "customer_normalizer",
      "sourceBlock": "entity/customer-basic",
      "generatedByPass": "adapt",
      "generatorTaskId": "fill_slot_customer_normalizer",
      "verifiedBy": [
        "tests/customer_normalizer.spec.ts",
        "tests/acceptance/customer-flow.spec.ts"
      ],
      "overrideStatus": "none"
    }
  ]
}
```

### artifact 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `path` | 是 | 文件路径 |
| `originType` | 是 | `block` / `slot` / `generated` / `override` |
| `originId` | 是 | 来源 id |
| `sourceBlock` | 否 | 来源 block |
| `generatedByPass` | 否 | 生成 pass |
| `generatorTaskId` | 否 | AI task id |
| `verifiedBy[]` | 否 | 通过的测试 |
| `overrideStatus` | 是 | `none` / `manual` / `rule-backed` |

## 6. Graph 数据模型

### Graph 类型

- `Block Graph`
- `Pin Graph`
- `Slot Graph`
- `Provenance Overlay`
- `Acceptance Coverage Graph`

### Node 类型

- `app`
- `block`
- `capability`
- `pin`
- `slot`
- `file`
- `acceptance`
- `policy`

### Edge 类型

- `depends_on`
- `provides`
- `connects_to`
- `writes_to`
- `verified_by`
- `originates_from`
- `violates`

## 7. `explain-graph.json`

### 顶层结构

```json
{
  "nodes": [],
  "edges": [],
  "overlays": {
    "provenance": [],
    "coverage": []
  }
}
```

### 目标

- 提供给 `platform explain`
- 提供给双视图工作台
- 不直接作为编译输入

## 8. Coverage 计算

### Acceptance Coverage

- 统计每个 block 被哪些 acceptance 覆盖
- 统计每个 slot 是否被至少一个 acceptance 覆盖

### Provenance Coverage

- 统计多少生成文件已挂上来源元数据

### Verification Coverage

- 统计多少关键文件通过了 unit + acceptance 双重校验

## 9. `v0.1` 最低要求

- 输出 `verification-report.json`
- `graph.lock.json` 中记录 slot task 与 generated paths
- 主验收链路至少覆盖三块和单槽位的主路径

## 10. `v0.2` 必须补齐

- `provenance.json`
- `platform explain`
- `Acceptance Coverage Graph`
- policy violations 报告

## 11. 延期项

- 可视化 DAG 编辑器
- 实时 perf flame graph
- 多环境 rollout graph
