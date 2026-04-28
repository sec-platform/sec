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
      - ticket/basic
      - worklog/basic
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
- `Pin / Interface Graph`
- `Data Flow Graph`
- `Business Flow Graph`
- `State Machine Graph`
- `Policy Graph`
- `Event Topology`
- `Slot / AI Logic Graph`
- `Provenance Overlay`
- `Acceptance Coverage Graph`
- `Issue Graph`
- `Kernel Boundary Graph`
- `Deployment Topology Graph`
- `Upgrade Graph`
- `Performance Budget Graph`

Graph 不是独立手动画图工具；规范、manifest、lock、acceptance、policy、provenance 和 verification report 才是源，图只是从同一套结构化工程对象自动投影出的视图。

### Node 类型

- `app`
- `block`
- `capability`
- `pin`
- `slot`
- `file`
- `entity`
- `state`
- `event`
- `acceptance`
- `policy`
- `kernel`
- `issue`
- `benchmark`
- `deployment`
- `upgrade`

### Edge 类型

- `depends_on`
- `provides`
- `connects_to`
- `emits`
- `consumes`
- `transitions_to`
- `writes_to`
- `verified_by`
- `covers`
- `originates_from`
- `violates`
- `classified_as`
- `bounded_by`
- `measured_by`
- `impacts`
- `upgrades_to`
- `deployed_to`

### 原生图谱对象原则

- Graph 不是事后画图，而是工程对象的解释层：block、pin、slot、file、acceptance、policy、provenance、issue 和 kernel boundary 都应能进入统一图谱。
- AI 定位问题时应优先使用 graph 和 provenance，而不是直接全文搜索源码。
- `Issue Graph` 用于把失败映射到 Spec Issue、Composition Issue、Slot Issue 或 Kernel Issue。
- `Kernel Boundary Graph` 用于标明哪些节点属于外部/专家维护热路径，哪些边界可由 adapter slot 连接。

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

### `v0.2` 最小归因规则

- 每个 block manifest 的 `pins.inputs[]` 和 `pins.outputs[]` 必须进入 explain graph：
  - input pin 节点：`pin:<blockId>:input:<pinId>`，由 `block:<blockId>` 通过 `depends_on` 指向。
  - output pin 节点：`pin:<blockId>:output:<pinId>`，由 `block:<blockId>` 通过 `provides` 指向。
- `policy-report.json` 中的 `merged.policies[]` 必须进入 explain graph，节点 id 为 `policy:<policyId>`。
- `policy-report.json` 中的每个 violation 必须产生 `file:<path> -> policy:<policyId>` 的 `violates` 边。
- 文件来源归因仍以 provenance overlay 为准；policy 归因以 policy report 为准；explain graph 只负责把两者合并展示。

### Engineering Semantic Diff

Review 不应只比较源码 diff；平台应从同一批 governance artifact 派生工程语义 diff，用于解释一次变更改变了哪些能力、约束和风险。

最小字段：

- `capabilityChanges`：新增、移除或改变的 capability / block。
- `interfaceChanges`：pin、slot contract、输入输出类型和连接关系变化。
- `policyChanges`：policy、severity、target、violation 的变化。
- `acceptanceChanges`：acceptance coverage、依赖关系、通过/失败状态变化。
- `provenanceChanges`：artifact origin、override status、generatedByPass、verifiedBy 变化。
- `runtimeImpact`：runtime report、deployment topology、性能预算或观测证据变化。
- `upgradeImpact`：migration、override conflict、rollback boundary、版本兼容影响。
- `riskClass`：由 issue graph、policy gate、verification status 和 diff budget 归约出的风险等级。

语义 diff 只能由 plan、manifest、lock、acceptance、policy、provenance、verification report、review summary 和 explain graph 派生；不得成为另一份手写状态源。

## 8. Coverage 计算

### Acceptance Coverage

- 统计每个 block 被哪些 acceptance 覆盖
- 统计每个 slot 是否被至少一个 acceptance 覆盖

### Provenance Coverage

- 统计多少生成文件已挂上来源元数据

### Verification Coverage

- 统计多少关键文件通过了 unit + acceptance 双重校验

## 9. 测试工程约定

### 临时工作空间

- 测试临时工作空间统一创建在仓库内 `.tmp/test-workspaces`，避免直接写入系统 `os.tmpdir()`。
- 测试文件不得重复实现 `createWorkspace` 或 `withTempWorkspace`；应复用 `tests/helpers/test-utils.ts`。
- 需要测试结束立即清理目录时，使用 `withTempWorkspace(async (workspaceRoot) => { ... })`。
- 需要跨测试生命周期延迟清理目录时，使用 `createWorkspace(prefix?)`。
- 只有非工作空间类 fixture 可以单独使用 `fs.mkdtemp`，例如写入受控测试 fixture 目录并由专门 cleanup 管理。

### 共享断言与缓存

- 读取 compiler 源文件或根 `package.json` 进行合同断言时，优先使用 `readCompilerFile` 和 `readCompilerPackageJson`，避免重复磁盘读取。
- 多个字符串 marker 断言应使用 `expectContainsAll` 或 `expectContainsNone`，避免大段重复 `toContain`。

## 10. `v0.1` 最低要求

- 输出 `verification-report.json`
- `graph.lock.json` 中记录 slot task 与 generated paths
- 主验收链路至少覆盖三块和单槽位的主路径

## 11. `v0.2` 必须补齐

- `provenance.json`
- `platform explain`
- `Acceptance Coverage Graph`
- policy violations 报告

## 12. 延期项

- 可视化 DAG 编辑器
- 实时 perf flame graph
- 多环境 rollout graph
