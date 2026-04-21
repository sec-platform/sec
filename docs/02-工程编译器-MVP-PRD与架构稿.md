# 工程编译器 PRD 与架构总稿

> 说明：沿用原文件名，但本稿不再只覆盖 `v0.1 MVP`，而是作为 `v0.1 -> v3.x` 的总规格。它既服务于开发者理解产品，也服务于后续 AI/Agent 作为实施依据。

## 规范栈

- 产品与架构总规格：当前文档
- 编译器核心实现规格：[05-编译器核心实现规格.md](D:\Project\pjc\docs\05-编译器核心实现规格.md)
- Registry 与 Block 协议规范：[06-Registry与Block协议规范.md](D:\Project\pjc\docs\06-Registry与Block协议规范.md)
- Pass 状态机与错误恢复规范：[07-Pass状态机、错误码与恢复机制.md](D:\Project\pjc\docs\07-Pass状态机、错误码与恢复机制.md)
- Verification、Provenance 与 Graph 规范：[08-Verification、Provenance与Graph规范.md](D:\Project\pjc\docs\08-Verification、Provenance与Graph规范.md)
- AI Runtime 与治理规范：[09-AI Runtime、任务信封与治理规范.md](D:\Project\pjc\docs\09-AI Runtime、任务信封与治理规范.md)
- Upgrade 与 Override 规范：[10-升级迁移与Override规范.md](D:\Project\pjc\docs\10-升级迁移与Override规范.md)

## 产品定位

### 已定结论

- 产品暂定名为“工程编译器（Engineering Compiler）”。
- 这不是 IDE、低代码工具、模板市场，也不是自由生成式 AI 结对编程工具。
- 系统的权威输入是工程规格、块接口、连接关系、slot 描述和验收要求；最终源码是可审查、可部署、可修改的编译产物。
- 这套产品要做的不是“让 AI 多写代码”，而是“把 AI 收束为编译链中的受限综合 pass”。
- 终局形态不是单一 CLI，而是一整层工程基础设施：
  - Authoring Layer：规格、块图、slot、规则、验收视图
  - Compilation Layer：解析、对齐、求解、装配、综合、验证、修复、发射
  - Artifact Layer：源码、测试、部署配置、锁文件、来源追踪
  - Platform Layer：registry、升级、治理、观测、可视化、托管运行时

### 工作假设

- 最先能跑通的切入口是多租户后台业务系统，而不是通用软件全领域。
- 一旦验证“规格优先、块优先、验收优先”成立，这种结构可以向更复杂的软件工业形态扩展。

## 技术栈分层

### 编译器实现栈

- `v0.1` 已定：
  - `TypeScript`
  - `Node.js`
  - `ESM`
  - CLI-first 工具形态
  - 文件系统驱动
  - `yaml` 解析
- 当前仓库若存在 `.js` 原型实现，只视为过渡状态，不视为长期规范。

### Bun 环境定位

- `v0.1` 不把 `Bun` 定为主运行时。
- `Bun` 的角色定义为：
  - 可选的本地开发运行时
  - 可选的本地测试加速器
  - 暂不作为规范源的默认 CI 运行时
- 进入 `v0.2+` 后，可增加：
  - `bun run` 本地执行支持
  - `bun test` 辅助测试支持
  - `bun install` 作为可选包管理器支持

### 生成项目目标栈

- `v0.1` 唯一支持的目标栈：
  - `Next.js`
  - `TypeScript`
  - `React`
  - `Tailwind`
  - `Prisma`
  - `SQLite`
  - `Vitest`
  - `Playwright`

### 已定结论

- 编译器本体和被生成的应用不是同一个技术层。
- 编译器源码层应收敛到 `TypeScript`，不建议长期停留在纯 `JavaScript`。
- 当前用 `Node.js` 做编译器主运行时是刻意选择，不是偏离设计。
- `Next.js` 在当前规格里属于“目标应用栈”，不是“编译器本体实现栈”。
- `Bun` 的优势在于原生运行 TS、内建测试和更快启动，但它更适合作为次级运行环境，而不是在 `v0.1` 直接替代 `Node.js` 成为规范基线。
- 后续可以给编译器加 Web 工作台，但不会替代 CLI 作为一等入口。

### 约束

- 编译器核心不得依赖 `Bun.*` 全局 API。
- 编译器核心不得依赖只在 `bun:test` 或 Bun 特有模块解析下成立的行为。
- 若引入 Bun 支持，必须保持 `Node.js` 主路径不被破坏。
- 若未来同时支持 `Node.js` 和 `Bun`，规范源以 `Node.js + tsc` 检查结果为准。

### 待验证

- 是否继续使用“工程编译器”作为对外产品名，不影响当前设计与实施。

## 终局目标

### 已定结论

- 可见的最远端不是“能生成一个项目”，而是形成一套完整的工程编译平台：
  - 规格成为主要设计面
  - registry 成为能力资产面
  - 编译器成为主干装配面
  - AI 只负责有限洞位和修复任务
  - acceptance、policy、provenance 成为质量与可解释性面
  - 源码是下游产物，不再是唯一源头
- 终局产品至少包含六类能力：
  - 本地或 CI 中可运行的编译器 CLI
  - 官方与私有 registry
  - 升级和迁移系统
  - 验证、政策和审计系统
  - 图谱与双视图交互层
  - 企业级托管与团队协作层

### 工作假设

- 终局形态中，开发者日常主要编辑的是 `plan/spec/rule/slot`，而不是四处手改业务主干。
- 终局形态中，AI 应能在给定编译合同后，自主完成多数局部实现、局部修复和升级迁移任务。

## 版本边界

### v0.1

- 证明首条闭环成立：
  - 开发者写 `app.plan.yaml`
  - 系统解析并安装 3 个官方块
  - AI 只填 1 个 slot
  - Playwright 主验收链路通过

### v0.2 - v0.4

- 从“闭环能跑”升级到“工程可持续”：
  - 增加 provenance
  - 增加 upgrade/migrate 入口
  - 扩充到 6 到 10 个官方块
  - 引入第二数据库路线 `PostgreSQL`
  - 引入 Interface Alignment pass
  - 引入 override 与回写策略

### v1.x

- 从单人实验升级到团队平台：
  - 私有 registry
  - 策略块、基础设施块、治理块体系化
  - acceptance graph、policy gate、review assist
  - 图谱视图与双视图工作台
  - CI/CD 集成与团队准入规则

### v2.x

- 从单栈平台升级到多目标编译器：
  - 第二后端目标栈
  - 更完整的升级/迁移引擎
  - marketplace / 受控生态
  - 托管验证、观测和审计

### v3.x

- 从后台母体扩展到跨领域工程编译：
  - 旧系统现代化
  - 大型企业系统增量替换
  - LiveOps / 后台工具链
  - 玩法系统 / 内容管线等更强规则域

## 非目标

### 已定结论

- `v0.1` 不做：
  - 多语言支持
  - Java 支持
  - 微服务
  - Redis / MQ / 多数据库
  - 文件上传、导出、通知、审计、AI 摘要
  - 多角色复杂权限
  - 多工作区切换
  - 社区贡献工作流
  - AST 级 patch engine
  - 图形化 IDE
  - 多后端目标栈
- 长期阶段才考虑：
  - Java 企业系统
  - 游戏系统编译器
  - 内容生产管线
  - 高性能或多区域复杂运行治理

## 三层世界与权威输入

### 第一层：Authoring Layer

- 这是开发者真正编辑的“上游源代码”。
- 主要对象：
  - `app.plan.yaml`
  - block graph
  - strategy selection
  - slot description
  - acceptance spec
  - policy spec
  - override spec

### 第二层：Compilation Layer

- 这是工程编译器本体。
- 负责：
  - parse
  - interface alignment
  - resolve
  - compose
  - synthesize
  - typecheck / lint / build
  - verify
  - repair
  - emit

### 第三层：Artifact Layer

- 这是产出的工程项目与附带元数据。
- 包括：
  - 前后端源码
  - Prisma schema / migration
  - 测试
  - 部署配置
  - lock files
  - provenance

### 已定结论

- 开发者对系统的 100% 控制，应该体现在对第一层输入和第二层规则的控制，而不是要求手写所有下游源码。
- 直接改产物源码必须允许，但应被标记为 `override`，并有回写上游规则的推荐路径。

## 模块与资源模型

### 模块分类

1. `Capability Block`
   - 用户能感知到的功能能力。
   - 例：`auth/basic-session`、`entity/customer-basic`
2. `Strategy Pack`
   - 非功能实现策略。
   - 例：`resilience/retry`、`security/tenant-isolation`
3. `Infra Pack`
   - 基础设施接入与运行依赖。
   - 例：`infra/postgres`、`infra/blob-storage`
4. `Governance Pack`
   - 验证、审计、升级、安全扫描等治理能力。
   - 例：`governance/acceptance-runner`

### Block Interface

- 每个块必须显式定义：
  - 输入管脚
  - 输出管脚
  - 事件管脚
  - 配置管脚
  - 权限约束
  - 生命周期约束
  - 错误边界
  - 性能或一致性约束
  - 可暴露 slot

### Slot 类型

- `Adapter Slot`
  - 块间字段、事件、协议映射
- `Policy Slot`
  - 业务规则、审批条件、校验逻辑
- `UX Slot`
  - 局部界面和交互语义
- `Repair Slot`
  - 验收失败后的局部修复位

### 已定结论

- `v0.1` 只实现 `Capability Block` 与单一 `Adapter Slot`。
- 其他模块和 slot 类型从 `v0.2` 开始逐步开放，但数据结构从本稿开始统一。

## Compile Contract 与 Provenance

### Compile Contract

编译合同必须回答五个问题：

1. 什么是输入
   - `app plan`
   - `block graph`
   - `strategy selection`
   - `slot descriptions`
   - `acceptance spec`
2. 什么是可综合部分
   - adapter
   - policy rule
   - 局部 UX 实现
   - repair patch
3. AI 在哪一步可以动什么
   - 哪些文件可写
   - 哪些符号必须保留
   - 哪些测试必须通过
   - 哪些安全/性能约束不可破坏
4. 什么是输出
   - repo
   - tests
   - lockfiles
   - provenance
   - deployable artifact
5. 什么叫编译成功
   - 所有依赖解析成功
   - 所有接口连通
   - 所有 slot 已填充
   - 所有 acceptance 通过
   - policy gate 通过

### Provenance

- 每段编译产物必须最终可追溯到：
  - 来源 block
  - 来源 version
  - 生成 pass
  - AI task id
  - 生成时间
  - 最近一次验证结果
  - 是否有人为 override

### 已定结论

- `v0.1` 可以先不单独输出完整 provenance 文件，但 `graph.lock.json` 必须为后续 provenance 预留字段。
- 从 `v0.2` 起，`provenance.json` 应成为正式一等公民。

## 数据与文件约定

### 1. `app.plan.yaml`

- 角色：开发者编写的工程规格。
- 所在位置：项目根目录。
- `v0.1` 必填字段：

```yaml
app:
  name: customer-admin
  stack: nextjs-ts-prisma-sqlite
  packageManager: pnpm

blocks:
  - id: auth/basic-session
  - id: tenant/basic-workspace
  - id: entity/customer-basic

slots:
  - id: customer_normalizer
    block: entity/customer-basic
    kind: adapter
    target: custom/customer_normalizer.ts
    symbol: normalizeCustomerInput
    description: |
      customer name 必填；
      email 转小写；
      phone 去掉空格和横线；
      company 为空时填 Unknown。

acceptance:
  - id: user_can_login
  - id: user_can_create_customer
  - id: user_can_list_customers
  - id: tenant_only_sees_own_customers
```

- `v1` 扩展字段预留：

```yaml
strategies:
  - id: security/tenant-isolation

infra:
  - id: infra/postgres

policies:
  - id: policy/tenant-scope-required

views:
  sourceView: true
  slotView: true
  graphView: true
```

### 2. `block.manifest.yaml`

- 角色：块的安装、依赖、接口、slot、验收和升级契约。
- 所在位置：`registry/<block-id>/block.manifest.yaml`
- `v0.1` 最小结构：

```yaml
id: entity/customer-basic
version: 0.1.0
kind: capability
stack: nextjs-ts-prisma-sqlite

requires:
  - auth/session
  - tenant/context

provides:
  - customer/read
  - customer/write

conflicts: []

installs:
  - from: files/src/app/customers
    to: src/app/customers
  - from: files/prisma/customer.prisma
    to: prisma/customer.prisma
  - from: files/tests/customer-basic.spec.ts
    to: tests/customer-basic.spec.ts

pins:
  inputs:
    - tenant_context
    - actor_identity
  outputs:
    - customer_created
    - customer_updated

slots:
  - id: customer_normalizer
    kind: adapter
    target: custom/customer_normalizer.ts
    symbol: normalizeCustomerInput
    inputType: CustomerInput
    outputType: NormalizedCustomerInput

acceptance:
  - user_can_create_customer
  - user_can_list_customers

upgrade:
  from: []
  migrations: []
```

### 3. `graph.lock.json`

- 角色：记录解析出的装配图、安装顺序、待执行任务和预留来源信息。
- 所在位置：项目根目录。
- `v0.1` 最小结构：

```json
{
  "app": {
    "name": "customer-admin",
    "stack": "nextjs-ts-prisma-sqlite"
  },
  "resolvedBlocks": [
    {
      "id": "auth/basic-session",
      "version": "0.1.0",
      "installOrder": 1
    },
    {
      "id": "tenant/basic-workspace",
      "version": "0.1.0",
      "installOrder": 2
    },
    {
      "id": "entity/customer-basic",
      "version": "0.1.0",
      "installOrder": 3
    }
  ],
  "providedCapabilities": [
    "auth/session",
    "tenant/context",
    "customer/read",
    "customer/write"
  ],
  "slotTasks": [
    {
      "id": "customer_normalizer",
      "block": "entity/customer-basic",
      "target": "custom/customer_normalizer.ts",
      "status": "pending",
      "writableZones": ["custom/"],
      "provenance": {
        "generator": null,
        "verifiedBy": []
      }
    }
  ],
  "generatedPaths": [
    "generated/routes.ts",
    "generated/block-usage-map.json"
  ],
  "acceptancePlan": [
    "user_can_login",
    "user_can_create_customer",
    "user_can_list_customers",
    "tenant_only_sees_own_customers"
  ]
}
```

### 4. `provenance.json`

- 角色：从 `v0.2` 起承载完整来源追踪。
- 所在位置：项目根目录。
- 状态：`v0.1` 保留为预留接口，不强制输出。

### 5. 目录约定

```text
platform/
  cli/
  compiler/
    parse/
    align/
    resolve/
    compose/
    synthesize/
    verify/
    repair/
    emit/
  registry/
    official/
    private/
  policies/
  upgrade/

project/
  app.plan.yaml
  graph.lock.json
  provenance.json
  src/
  prisma/
  tests/
  generated/
  custom/
  overrides/
```

## 编译流程

### CLI 面

- `platform init`
  - 初始化母栈项目
- `platform add <block-id>`
  - 向 `app.plan.yaml` 追加块
- `platform resolve`
  - 生成 `graph.lock.json`
- `platform compose`
  - 安装块和生成骨架
- `platform adapt`
  - 执行 slot 综合
- `platform verify`
  - 执行类型检查、单测、主验收
- `platform repair`
  - 根据失败项生成局部修复任务
- `platform lock`
  - 固化最终锁信息
- `platform explain`
  - 输出 block graph、slot graph 和 provenance 摘要
- `platform upgrade`
  - 从 `v0.2` 起做块升级与迁移

### Pass 流水线

1. `Parse`
   - 读入 `app.plan.yaml` 与所有 manifests
2. `Align`
   - 检查 block interface、pin 对齐、缺失 adapter slot
3. `Resolve`
   - 解依赖、冲突和安装顺序
4. `Compose`
   - 安装文件、合并依赖、生成注册表和骨架
5. `Synthesize`
   - 对所有已声明 slot 生成实现
6. `Typecheck / Lint / Build`
   - 静态检查
7. `Verify`
   - 运行 acceptance、policy、基础性能检查
8. `Repair`
   - 对失败项发出局部修复任务
9. `Emit`
   - 输出 repo、lock、provenance、报告

### 已定结论

- AI 只允许出现在 `Align`、`Synthesize`、`Repair` 三个 pass 的可控子步骤中。
- 其余 pass 默认必须确定性完成。

## AI 执行模型

### Agent 角色

1. `Interface Alignment Agent`
   - 不写业务仓库主干代码
   - 负责检查 pin 是否可连、哪些 slot 需要显式声明
2. `Slot Synthesis Agent`
   - 只实现已声明 slot
   - 受 writable path、symbol 和测试边界约束
3. `Repair Agent`
   - 只处理失败项
   - 不允许扩大修改面
4. `Upgrade Planning Agent`
   - 在 `v0.2+` 评估块升级和迁移计划
5. `Review / Explanation Agent`
   - 生成人类可读的差异说明、来源说明和风险摘要

### AI 任务信封

每个 AI 任务都必须具备：

- `taskId`
- `taskKind`
- `targetBlock`
- `targetFile`
- `allowedPaths`
- `requiredSymbols`
- `forbiddenOperations`
- `inputContracts`
- `testsToPass`
- `performanceOrPolicyLimits`
- `expectedOutputShape`

### `v0.1` 任务模板

```text
任务名：fill_slot_customer_normalizer
任务类型：adapter-slot
允许修改：custom/customer_normalizer.ts
要求保留：normalizeCustomerInput
禁止行为：改其他文件、引入新依赖、访问数据库、改 Prisma schema
通过条件：customer_normalizer.spec.ts + 主验收链路
```

## 当前母例与 v0.1 固定规格

### 母例

- “登录后管理 Customer 的最小后台”

### 官方块

- `auth/basic-session`
- `tenant/basic-workspace`
- `entity/customer-basic`

### 技术基线

- `Next.js`
- `TypeScript`
- `React`
- `Tailwind`
- `Prisma`
- `SQLite`
- `Vitest`
- `Playwright`

### 单槽位

- `customer_normalizer`
  - 目标文件：`custom/customer_normalizer.ts`
  - 允许导出：

```ts
export function normalizeCustomerInput(
  input: CustomerInput
): NormalizedCustomerInput
```

## 终局产品面

### 开发者视图

- 规格视图
- block graph 视图
- slot / rule 视图
- source 视图
- acceptance coverage 视图
- provenance 视图

### 平台视图

- 官方 registry
- 私有 registry
- upgrade center
- policy center
- validation dashboard
- graph explorer

### 托管视图

- 编译日志
- 运行验收
- 失败回放
- 版本追踪
- 团队权限与审计

## 指标体系

### 核心指标

- `Deterministic Coverage`
  - 由系统确定性装配的代码和能力占比
- `Slot Surface Ratio`
  - AI 需要真正编写的逻辑面积占比
- `Compile Success Rate`
  - 从 plan 到可运行项目的一次成功率
- `Acceptance Pass Rate`
  - 主场景一次通过率
- `Verification Cost`
  - 每次交付所需人工验证成本
- `Upgrade Safety Rate`
  - 块升级后无需人工返工的比例

### 指标目标

- `v0.1`
  - `Deterministic Coverage > 50%`
  - 单槽位可控
  - 主链路通过
- `v1`
  - `Deterministic Coverage 60% - 80%`
  - `Slot Surface Ratio 20% - 40%`
  - 稳定团队复用

## 工作假设与待验证

### 工作假设

- `SQLite` 足以承载 `v0.1` 的单机母例验证。
- 三个官方块足以证明“不是脚手架、不是 SDK、不是 Skill”的核心差异。
- 在 `v0.2+` 引入 provenance、upgrade 和 graph view 后，系统才能真正从“MVP 工具”升级为“工程平台”。

### 待验证

- 第二目标栈优先是 `PostgreSQL + Route Handlers` 的增强版，还是 `Nest` / `Elysia`，需要以后续落地难度与块复用率决定。
- 游戏、Java 现代化、LiveOps 等远端方向只作为长期路线，不作为短期承诺。
