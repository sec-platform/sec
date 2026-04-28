# Registry 与 Block 协议规范

> 目标：定义 block 的打包、版本、兼容、发布、信任、测试与升级协议，避免 registry 退化成“另一个源码仓库”。

## 1. Registry 模型

### Registry 类型

- `official`
  - 平台官方维护
- `private`
  - 团队内部维护
- `community`
  - `v1+` 才开放

### Registry 根目录

```text
platform/registry/
  official/
    auth.basic-session/
    tenant.basic-workspace/
    entity.customer-basic/
  private/
```

### 当前默认 registry source

```yaml
registry:
  sources:
    - id: official
      kind: official
      location: compiler
      path: platform/registry/official
    - id: private
      kind: private
      location: workspace
      path: platform/registry/private
```

- `official` 由编译器随仓库分发。
- `private` 由当前 workspace 提供，可被团队按项目直接扩展。

### block 目录结构

```text
<registry>/<block-id>/
  block.manifest.yaml
  files/
    src/
    prisma/
    tests/
  templates/
  fixtures/
  migrations/
  docs/
```

## 2. Block 分类协议

### Capability Block

- 提供用户可感知能力
- 必须定义 `acceptance`
- 可以暴露 slot

### Strategy Pack

- 提供非功能策略
- 不应直接暴露页面能力
- 必须声明适用条件与不适用条件

### Infra Pack

- 提供基础设施接入
- 必须声明外部依赖
- 必须声明环境变量需求
- 常见候选包括 `infra/postgres`、`infra/redis`、`infra/kafka`、`infra/rabbitmq`、`infra/elasticsearch`、`infra/object-storage`。
- Redis 更像缓存、会话、限流、短期状态和语义缓存标准件；Kafka/RabbitMQ 更像事件流、消息总线和异步任务标准件；Elasticsearch 更像搜索、日志检索、分析和 RAG 检索标准件。
- 这些基础设施不应在早期作为业务主入口；应通过 Infra Pack 暴露依赖、连接、环境变量、运行约束，并通过 Strategy Pack 表达 `async/event-streaming`、`async/job-queue`、`search/fulltext`、`search/hybrid-vector` 等策略选择。

### Governance Pack

- 提供验收、政策、审计、安全与升级相关能力
- 不得成为业务主入口

### Kernel Block

- 针对高性能、底层、实时或专家维护核心模块。
- 只暴露接口、pin、性能预算、benchmark、correctness harness 和必要 adapter slot。
- 不要求编译器生成 kernel 内部实现。
- 不允许 AI 在默认任务中重写 kernel 热路径。
- 适用于数据库内核、搜索排序核心、渲染循环、协议栈、实时交易、游戏主循环等场景。
- `v0.1` 不实现 Kernel Block，只在 manifest schema 和图谱模型中预留。

## 3. 命名规范

- block id：`domain/name`
- 目录名：`.` 替代 `/`
  - `auth/basic-session -> auth.basic-session`
- capability id：`domain/action`
- pin id：`snake_case`
- slot id：`snake_case`

## 4. Versioning

### 版本策略

- 使用 semver
- `MAJOR`
  - 破坏 block interface、pin、slot、install target
- `MINOR`
  - 向后兼容新增
- `PATCH`
  - 修复行为或实现问题

### 兼容性声明

manifest 必须包含：

```yaml
compatibility:
  blockApi: "1"
  compilerApi: "1"
  stackProfiles:
    - nextjs-ts-prisma-sqlite
```

### 兼容性规则

- `blockApi` 与编译器当前支持版本不匹配时，resolver 必须报错。
- 同一项目中若出现两个不兼容 major 版本的同 id block，不允许装配。

## 5. Block Interface 协议

### pins

- `inputs`
  - 该块消费的上游信号或上下文
- `outputs`
  - 该块产生的下游信号或能力
- `events`
  - 异步事件出口
- `configs`
  - 可配置参数入口

### pins 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | pin 唯一 id |
| `type` | 是 | 类型名 |
| `required` | 否 | 默认 `false` |
| `description` | 否 | 文本说明 |
| `multiplicity` | 否 | `one` / `many` |

### slot 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | slot id |
| `kind` | 是 | `adapter` / `policy` / `ux` / `repair` |
| `target` | 是 | 默认目标文件 |
| `symbol` | 是 | 必须导出的符号 |
| `inputType` | 否 | 输入类型 |
| `outputType` | 否 | 输出类型 |
| `writableZones` | 是 | 允许写入目录 |
| `tests` | 否 | 需通过测试列表 |

## 6. 安装协议

### `installs[]` 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `kind` | 是 | 安装动作 |
| `from` | 是 | registry 内路径 |
| `to` | 是 | 项目内目标路径 |
| `condition` | 否 | 满足时才安装 |
| `replace` | 否 | 是否允许替换 |
| `mergeStrategy` | 否 | 合并策略 |

### 禁止规则

- block 不得安装到：
  - `platform/cli/`
  - 其他 block manifest
  - `graph.lock.json`
  - `provenance.json`
- block 不得修改不属于自己的 `writableZones`。

## 7. 测试与 fixtures 协议

### 每个 block 至少应包含

- 安装后 smoke test
- capability behavior test
- 若暴露 slot，至少一个 slot contract test

### fixtures 规则

- fixtures 只用于测试和模板渲染
- 不得作为运行时配置的唯一来源

## 8. 发布协议

### `official` / `private` 发布步骤

1. 校验 manifest schema
2. 校验版本号
3. 校验 stackProfiles
4. 校验安装路径合法性
5. 跑 block 自测
6. 生成 package metadata
7. 发布到对应 registry 目录或索引

### 需要生成的元数据

- block id
- version
- checksum
- compatibility
- publishedAt
- publishedBy
- trustLevel

## 9. 信任与治理

### trustLevel

- `official`
- `trusted-private`
- `untrusted-private`
- `community-reviewed`
- `community-unreviewed`

### 默认准入

- `v0.1`
  - 只允许 `official`
- `v0.5`
  - 允许 `trusted-private`
- `v1+`
  - 在治理机制到位后才考虑 community

## 10. 升级接口

manifest 预留：

```yaml
upgrade:
  from:
    - "0.1.x"
  migrations:
    - id: mig-rename-customer-status
      kind: codemod
      entry: migrations/rename-customer-status.ts
```

### 升级规则

- 没有显式 `upgrade.from` 声明时，默认不支持自动升级。
- major 升级必须伴随 migration plan 或显式拒绝自动升级。

## 11. 审计字段

每个 block 元数据至少记录：

- `sourceRegistry`
- `sourceVersion`
- `checksum`
- `installedAt`
- `compilerVersion`

## 12. `v0.1` 官方块名单

- `auth/basic-session`
- `tenant/basic-workspace`
- `entity/customer-basic`

## 12.1 `v0.2+` 建议扩展块

- `ticket/basic`
- `worklog/basic`
- `rbac/basic`
- `audit/basic`
- `table/filter-search`
- `export/csv-basic`
- `notify/email-basic`
- `file/upload`

### 母例块策略

- `entity/customer-basic` 保持为 `v0.1` 首条闭环的最小业务块。
- `ticket/basic` 和 `worklog/basic` 用于后续 Work Tracking / Ticket SaaS 母例，覆盖状态、负责人、租户隔离、列表筛选、审计和通知等更真实业务组合。
- 新母例不得破坏 `v0.1` 的 customer-admin 兼容性；应通过新增块和新增 plan 示例推进。

## 13. 延期项

- 远程 registry 拉取
- block 签名验证
- 社区发布审批流程
- marketplace 评分与下载
