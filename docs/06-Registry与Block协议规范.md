---
title: Registry 与 Block 协议规范
status: stable
last-reviewed: 2026-07-04
---

# Registry 与 Block 协议规范

> 目标：定义 block 的打包、版本、兼容、安装与命名协议。

## 1. Registry 模型

Registry 的最终形态不是文件模板市场，而是语义合约 registry。官方 block 可以随编译器分发，用户私有 block 应位于 workspace 或远程 registry；核心平台只理解 manifest、capability、pin、slot、contract、generator 等协议，不理解具体业务 block 的内部 hardcode。

| 类型 | 说明 | 当前状态 |
| --- | --- | --- |
| `official` | 平台官方维护，随编译器分发 | 16 个官方块 |
| `private` | 团队内部维护 | `source/blocks/private/**` / `platform/registry/private/**` |
| `community` | 社区贡献 | `v1+` 开放 |

### 当前 registry sources

```yaml
registry:
  sources:
    - { id: official, kind: official, location: compiler, path: platform/registry/official }
    - { id: source-private, kind: private, location: workspace, path: source/blocks/private }
    - { id: private, kind: private, location: workspace, path: platform/registry/private }
```

### block 目录结构

```text
<registry>/<block-id>/
  block.manifest.yaml
  contracts/              # 语义合约，承载 entity/operation/policy/view/event/permission 等最终形态输入
  generators/             # 可选生成器元数据或模板，按工程动作生成产物，不按业务 block hardcode
  files/src/installed/    # v0.x 文件装载入口，安装到 project/src/installed/
  files/prisma/           # merge-prisma 源
  files/tests/            # 测试文件
  versions/<ver>/         # 版本化 overlay manifest 与版本专属文件
    migrations/           # 升级迁移
    block.manifest.yaml   # 可只声明 version + upgrade，其他字段继承 root manifest
```

`files/**` 是低级 escape hatch；`contracts/**` 与 `generators/**` 是最终形态的主路径。新增 block 应优先考虑能否用语义合约表达，只有无法抽象或需要兼容时才直接复制具体文件。

## 2. Block 分类

| 类型 | 职责 | 约束 |
| --- | --- | --- |
| `capability` | 用户可感知业务能力（entity/ticket/auth） | 必须定义 `acceptance`，可暴露 slot |
| `strategy` | 非功能策略（权限/审计/通知/搜索） | 不直接暴露页面，声明适用条件 |
| `infra` | 基础设施接入（db/cache/queue） | 声明外部依赖和 env 变量 |
| `governance` | 验收/政策/审计/安全 | 不成为业务主入口 |

`v0.2+` 预留 `kernel`：高性能/底层模块，只暴露接口、pin、perf budget、benchmark harness。

## 3. 命名规范

- block id：`domain/name`（如 `auth/basic-session`）
- 目录名：`.` 替代 `/`（如 `auth.basic-session`）
- capability id：`domain/action`（如 `customer/read`）
- pin id / slot id：`snake_case`

## 4. 版本与兼容性

| 字段 | 说明 |
| --- | --- |
| `version` | semver |
| `compatibility.blockApi` | 可省略；默认 `"1"` |
| `compatibility.compilerApi` | 可省略；默认 `"1"` |
| `compatibility.stackProfiles` | 可省略；默认继承 root `stackProfiles` |

规则：同一项目中同 id block 不允许出现不兼容 major 版本。

版本化 manifest 是 root manifest 的 overlay：
- `versions/<ver>/block.manifest.yaml` 至少声明 `version`，通常只额外声明 `upgrade`。
- 未声明的 `kind`、`requires`、`provides`、`installs`、`pins`、`slots`、`acceptance`、`routes` 等字段由 root `block.manifest.yaml` 继承。
- 若某版本需要改变这些字段，必须在 versioned manifest 中显式覆盖整个字段值。

## 5. Manifest 字段速查

详见 `05` §4。关键字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 唯一 block id |
| `version` | 是 | semver |
| `kind` | 是 | capability / strategy / infra / governance |
| `stackProfiles` | 是 | 至少 1 个 |
| `requires` | 否 | 依赖的 capability id |
| `provides` | 否 | 提供的 capability id |
| `conflicts` | 否 | 冲突的 block/capability id |
| `installs` | 是 | 安装动作（copy / merge-prisma） |
| `pins.inputs` | 否 | 输入 pin |
| `pins.outputs` | 否 | 输出 pin |
| `slots` | 否 | 暴露的 slot |
| `acceptance` | 否 | 验收声明 |
| `routes` | 否 | 路由声明 |
| `contracts` | 否 | 语义合约入口，声明 entities / operations / policies / views / events / permissions 等 |
| `generators` | 否 | 生成器声明，按工程动作从合约生成文件、测试、视图或治理产物 |
| `upgrade` | 否 | 升级元数据 |
| `uiPortals` | 否 | 声明式的 UI 插槽 Portal 列表 |
| `uiHooks` | 否 | 将 UI Hook 注入 Portal 的组件挂载元数据 |

## 6. Slot 字段

Pin/slot 是工程编译器的接口类型系统。约束必须稳定，但不能承载业务 hardcode：核心编译器只验证连接、类型、写入边界和可追踪性；具体业务逻辑由语义合约、slot 实现或 generator 处理。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | slot 唯一 id |
| `kind` | 是 | adapter / policy / ux / repair |
| `target` | 是 | 默认 runtime 目标 |
| `symbol` | 是 | 必须导出的函数名 |
| `inputType` | 否 | 输入 TS 类型 |
| `outputType` | 否 | 输出 TS 类型 |
| `writableZones` | 是 | 允许写入的目录范围 |

### Opaque Module 与 private block 回收

`source/code/opaque/**/module.yaml` 是开发事实源中的开放实现边界，不属于 registry block。它可以作为旧项目迁移或复杂业务逻辑的临时容器，但不能被其他 block 作为稳定依赖引用。

当 opaque module 需要复用、升级或被平台治理时，必须回收为 private block：补齐 `block.manifest.yaml`、pins/slots、acceptance、policy、provenance，并按需要迁移到 `contracts/**` 或 `generators/**`。回收前不得绕过 registry trust、version、upgrade 和 rollback 规则。

## 7. UI Portal 与 UI Hook 协议

UI Portals 和 UI Hooks 是实现前端页面生成去业务 Hardcode 的通用插槽机制。
核心编译器只负责在 Compose 阶段收集所有 resolved 块声明的 `uiHooks` 并根据匹配的 `targetPortal` 合并生成渲染代码。

### 7.1 UI Portal 声明
每个 Portal 代表前端页面的一个插槽占位符：
```yaml
uiPortals:
  - id: customer_list_item
    description: "渲染在每个客户行内的自定义挂载项"
```

### 7.2 UI Hook 挂载
其他业务或辅助块（如 file/upload 或 audit/basic）可以声明对应的 Hook 挂载入特定 Portal：
```yaml
uiHooks:
  - targetPortal: customer_list_item
    component: CustomerAttachmentForm
    importFrom: ../../components/customer-attachment-form.tsx
    dataBinder: |
      const attachments = listCustomerAttachments(database, session, customer.id);
    renderSnippet: |
      <CustomerAttachmentForm attachments={attachments} />
```

- `targetPortal`: 目标插槽 Portal 的 ID。
- `component`: 注入的组件符号（包括任何需要引用的服务函数，以逗号分隔，比如 `listCustomerAttachments`）。
- `importFrom`: 前端页面导入这些符号的相对或绝对路径。
- `dataBinder`: （可选）在 React 页面服务端/Setup 阶段执行的数据获取与绑定代码。
- `renderSnippet`: （可选）渲染在 JSX 组件树中的 React 表达式片段。

## 8. 安装协议

# Registry 与 Block 协议规范

> 目标：定义 block 的打包、版本、兼容、安装与命名协议。

## 1. Registry 模型

Registry 的最终形态不是文件模板市场，而是语义合约 registry。官方 block 可以随编译器分发，用户私有 block 应位于 workspace 或远程 registry；核心平台只理解 manifest、capability、pin、slot、contract、generator 等协议，不理解具体业务 block 的内部 hardcode。

| 类型 | 说明 | 当前状态 |
| --- | --- | --- |
| `official` | 平台官方维护，随编译器分发 | 16 个官方块 |
| `private` | 团队内部维护 | `source/blocks/private/**` / `platform/registry/private/**` |
| `community` | 社区贡献 | `v1+` 开放 |

### 当前 registry sources

```yaml
registry:
  sources:
    - { id: official, kind: official, location: compiler, path: platform/registry/official }
    - { id: source-private, kind: private, location: workspace, path: source/blocks/private }
    - { id: private, kind: private, location: workspace, path: platform/registry/private }
```

### block 目录结构

```text
<registry>/<block-id>/
  block.manifest.yaml
  contracts/              # 语义合约，承载 entity/operation/policy/view/event/permission 等最终形态输入
  generators/             # 可选生成器元数据或模板，按工程动作生成产物，不按业务 block hardcode
  files/src/installed/    # v0.x 文件装载入口，安装到 project/src/installed/
  files/prisma/           # merge-prisma 源
  files/tests/            # 测试文件
  versions/<ver>/         # 版本化 overlay manifest 与版本专属文件
    migrations/           # 升级迁移
    block.manifest.yaml   # 可只声明 version + upgrade，其他字段继承 root manifest
```

`files/**` 是低级 escape hatch；`contracts/**` 与 `generators/**` 是最终形态的主路径。新增 block 应优先考虑能否用语义合约表达，只有无法抽象或需要兼容时才直接复制具体文件。

## 2. Block 分类

| 类型 | 职责 | 约束 |
| --- | --- | --- |
| `capability` | 用户可感知业务能力（entity/ticket/auth） | 必须定义 `acceptance`，可暴露 slot |
| `strategy` | 非功能策略（权限/审计/通知/搜索） | 不直接暴露页面，声明适用条件 |
| `infra` | 基础设施接入（db/cache/queue） | 声明外部依赖和 env 变量 |
| `governance` | 验收/政策/审计/安全 | 不成为业务主入口 |

`v0.2+` 预留 `kernel`：高性能/底层模块，只暴露接口、pin、perf budget、benchmark harness。

## 3. 命名规范

- block id：`domain/name`（如 `auth/basic-session`）
- 目录名：`.` 替代 `/`（如 `auth.basic-session`）
- capability id：`domain/action`（如 `customer/read`）
- pin id / slot id：`snake_case`

## 4. 版本与兼容性

| 字段 | 说明 |
| --- | --- |
| `version` | semver |
| `compatibility.blockApi` | 可省略；默认 `"1"` |
| `compatibility.compilerApi` | 可省略；默认 `"1"` |
| `compatibility.stackProfiles` | 可省略；默认继承 root `stackProfiles` |

规则：同一项目中同 id block 不允许出现不兼容 major 版本。

版本化 manifest 是 root manifest 的 overlay：
- `versions/<ver>/block.manifest.yaml` 至少声明 `version`，通常只额外声明 `upgrade`。
- 未声明的 `kind`、`requires`、`provides`、`installs`、`pins`、`slots`、`acceptance`、`routes` 等字段由 root `block.manifest.yaml` 继承。
- 若某版本需要改变这些字段，必须在 versioned manifest 中显式覆盖整个字段值。

## 5. Manifest 字段速查

详见 `05` §4。关键字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 唯一 block id |
| `version` | 是 | semver |
| `kind` | 是 | capability / strategy / infra / governance |
| `stackProfiles` | 是 | 至少 1 个 |
| `requires` | 否 | 依赖的 capability id |
| `provides` | 否 | 提供的 capability id |
| `conflicts` | 否 | 冲突的 block/capability id |
| `installs` | 是 | 安装动作（copy / merge-prisma） |
| `pins.inputs` | 否 | 输入 pin |
| `pins.outputs` | 否 | 输出 pin |
| `slots` | 否 | 暴露的 slot |
| `acceptance` | 否 | 验收声明 |
| `routes` | 否 | 路由声明 |
| `contracts` | 否 | 语义合约入口，声明 entities / operations / policies / views / events / permissions 等 |
| `generators` | 否 | 生成器声明，按工程动作从合约生成文件、测试、视图或治理产物 |
| `upgrade` | 否 | 升级元数据 |
| `uiPortals` | 否 | 声明式的 UI 插槽 Portal 列表 |
| `uiHooks` | 否 | 将 UI Hook 注入 Portal 的组件挂载元数据 |

## 6. Slot 字段

Pin/slot 是工程编译器的接口类型系统。约束必须稳定，但不能承载业务 hardcode：核心编译器只验证连接、类型、写入边界和可追踪性；具体业务逻辑由语义合约、slot 实现或 generator 处理。

| 字段 | 必填 | 说明 |
| --- | --- |
| `id` | 是 | slot 唯一 id |
| `kind` | 是 | adapter / policy / ux / repair |
| `target` | 是 | 默认 runtime 目标 |
| `symbol` | 是 | 必须导出的函数名 |
| `inputType` | 否 | 输入 TS 类型 |
| `outputType` | 否 | 输出 TS 类型 |
| `writableZones` | 是 | 允许写入的目录范围 |

### Opaque Module 与 private block 回收

`source/code/opaque/**/module.yaml` 是开发事实源中的开放实现边界，不属于 registry block。它可以作为旧项目迁移或复杂业务逻辑的临时容器，但不能被其他 block 作为稳定依赖引用。

当 opaque module 需要复用、升级或被平台治理时，必须回收为 private block：补齐 `block.manifest.yaml`、pins/slots、acceptance、policy、provenance，并按需要迁移到 `contracts/**` 或 `generators/**`。回收前不得绕过 registry trust、version、upgrade 和 rollback 规则。

## 7. UI Portal 与 UI Hook 协议

UI Portals 和 UI Hooks 是实现前端页面生成去业务 Hardcode 的通用插槽机制。
核心编译器只负责在 Compose 阶段收集所有 resolved 块声明的 `uiHooks` 并根据匹配的 `targetPortal` 合并生成渲染代码。

### 7.1 UI Portal 声明
每个 Portal 代表前端页面的一个插槽占位符：
```yaml
uiPortals:
  - id: customer_list_item
    description: "渲染在每个客户行内的自定义挂载项"
```

### 7.2 UI Hook 挂载
其他业务或辅助块（如 file/upload 或 audit/basic）可以声明对应的 Hook 挂载入特定 Portal：
```yaml
uiHooks:
  - targetPortal: customer_list_item
    component: CustomerAttachmentForm
    importFrom: ../../components/customer-attachment-form.tsx
    dataBinder: |
      const attachments = listCustomerAttachments(database, session, customer.id);
    renderSnippet: |
      <CustomerAttachmentForm attachments={attachments} />
```

- `targetPortal`: 目标插槽 Portal 的 ID。
- `component`: 注入的组件符号（包括任何需要引用的服务函数，以逗号分隔，比如 `listCustomerAttachments`）。
- `importFrom`: 前端页面导入这些符号的相对或绝对路径。
- `dataBinder`: （可选）在 React 页面服务端/Setup 阶段执行的数据获取与绑定代码。
- `renderSnippet`: （可选）渲染在 JSX 组件树中的 React 表达式片段。

## 8. 安装协议

支持动作：`copy`（递归复制）、`merge-prisma`（智能合并去重）。

最终形态还允许 generator 类动作，但必须按工程动作命名和注册，例如 `generate-entity-service`、`generate-api-route`、`generate-prisma-model`、`generate-view`、`generate-acceptance-test`。禁止按业务 block 命名策略，例如 `generate-customer`、`CustomerInstallStrategy`、`TicketInstallStrategy`。

禁止规则：
- block 不得安装到其他 block manifest、`control/**`、`platform/cli/`。
- block 不得修改不属于自己 `writableZones` 的文件。
- block 不得要求核心编译器理解具体业务名；业务语义必须通过 `contracts`、`pins`、`slots`、`acceptance`、`policy` 进入 Engineering IR。

## 9. 自描述 Block 契约开发与 README 规范标准

为了使得无论是开发者还是 AI Agent 都能瞬间获取每个 Block 的开发、接入和使用细节指引，所有的 Registry 块必须在自身根目录下配备一份强契约的 **`block.README.md`** 文件（可记录在 block 根目录），作为其“自描述物理微核”。

### 9.1 Block README 必需结构
自描述文件必须包含以下五个严密的规范章节：

1. **基本能力与定位 (BASIC CAPABILITIES)**
   - 块 ID、版本和 Block 分类类型 (`capability` / `strategy` / `infra` / `governance`)。
   - 块的核心业务边界描述，明确该块是解决什么核心业务痛点。
2. **能力契约拓扑 (DEPENDENCY TOPOLOGY)**
   - 明确列出本 Block 依赖的 Capability ID (等同于 `requires` 声明)，以及向系统提供的接口 Capability ID (等同于 `provides` 声明)。
3. **Slots（管脚）接口与 Symbol 规范 (SLOT & INTERFACE DETAILS)**
   - 若 Block 声明了 Slots 或暴露了 API，在此列出全部暴露的 Slots 接口。
   - 规定每个 Slot 的导出的 Symbol 符号名称、参数类型定义（Zod & TypeScript 类型）以及 `writableZones`（可写安全区），为 AI 自动化生成 Slot 提供完美的契约输入。
4. **数据模型扩展 (DATA SCHEMA EXTENSIONS)**
   - 说明该 Block 安装时，通过 `merge-prisma` 缝合机制向 `schema.prisma` 追加了哪些实体模型 (Prisma Models)、枚举和关系。
5. **UI Hooks 门户挂载点 (UI HOOKS & PORTALS)**
   - 详细列出 Block 声明的 `uiPortals` 插槽列表，以及其通过 `uiHooks` 注入了哪些交互前端组件（例如注入 LoginForm，或在 Customer 列表挂载 AttachmentForm），并说明其 `dataBinder` 的服务端数据流。
6. **验收测试准则 (ACCEPTANCE TESTS)**
   - 记录该 Block 配套的 Acceptance 验收用例的 ID 以及它所覆盖（Covers）和依赖（DependsOn）的具体功能点，说明其端到端自动化校验的运行入口与预期结果。

### 9.2 Block.README.md 权威标准模板

每一个 Block 根目录下的 `block.README.md` 必须严格按照以下格式进行编写，以提供完美的自描述契约：

```markdown
# Block: [Block ID，例如 tenant/basic-workspace]

## 1. BASIC CAPABILITIES (基本能力与定位)
- **ID**: `tenant/basic-workspace`
- **Version**: `1.0.0`
- **Kind**: `capability`
- **Description**: 负责提供多租户底盘隔离能力。它通过在数据库所有核心实体中缝合 `tenantId` 字段，实现租户级别的数据隔离，并提供基于域名的租户动态解析与绑定上下文。

## 2. DEPENDENCY TOPOLOGY (能力契约拓扑)
- **Requires (依赖能力)**: 
  - `infra/database` (需要物理数据库支持)
- **Provides (提供能力)**:
  - `tenant/context` (提供租户解析上下文)
  - `tenant/isolation` (提供数据行级隔离拦截)

## 3. SLOT & INTERFACE DETAILS (管脚与接口规范)
该 Block 暴露了以下 Custom Slots。任何需要定制的租户路由或归一化逻辑，都必须实现对应的 Slot 契约：

### Slot ID: `tenant_resolver`
- **Symbol**: `resolveTenantDomain`
- **Kind**: `adapter`
- **Target File**: `custom/tenant_resolver.ts`
- **Writable Zones**: 
  - `source/code/slots/tenant_resolver.ts`
- **Contract Signature**:
  ```typescript
  export function resolveTenantDomain(hostname: string): Promise<{ tenantId: string; status: 'active' | 'suspended' }>
  ```
- **Description**: 运行时接收用户请求的 `hostname` 域名，由开发者手写 Slot 解析为合法的租户 ID。

## 4. DATA SCHEMA EXTENSIONS (数据模型扩展)
本 Block 安装时将通过 `merge-prisma` 自动在 `schema.prisma` 中注入以下模型与字段：

- **Model `Tenant`**:
  ```prisma
  model Tenant {
    id        String   @id @default(uuid())
    name      String
    domain    String   @unique
    status    String   @default("active")
    createdAt DateTime @default(now())
  }
  ```
- **Inject Field**: 向被管理的所有业务实体追加租户关联：
  ```prisma
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])
  ```

## 5. UI HOOKS & PORTALS (前端挂载点)
- **Portals (提供的插槽)**:
  - `tenant_setting_panel`: 租户后台设置面板插槽。
- **Hooks (注入的组件)**:
  - `TenantDomainBanner` (通过 `uiHooks` 自动注入到 Layout 头部，提示当前所处租户)。

## 6. ACCEPTANCE TESTS (验收测试准则)
验收该 Block 必须跑通以下测试以确保契约无损：
- **Acceptance ID**: `tenant_isolation_flow`
- **Test Commands**:
  - `bun run playwright test tests/acceptance/tenant-isolation.spec.ts`
- **Covers (覆盖场景)**:
  - `domain_resolution`: 访问 `tenantA.test.com` 自动渲染 TenantA 专属页面。
  - `db_isolation_leak`: 严格校验跨租户试图读取数据时触发 Row-Level 异常拦截。
```


## 10. 6个开源参考仓库的复用与只读边界

平台在开发、Review、验收及可视化交互设计中，有选择性地引用和参考了 6 个业界极具统治力的开源仓库。
核心纪律：**严禁在物理代码层直接导入或把它们的源码塞入平台编译器 codebase！保持编译器的高内聚、纯净与极速编译。**

### 10.1 物理集成直接用（NPM 库依赖）

1. **`React Flow (xyflow)`**：
   - **GitHub**: [https://github.com/xyflow/xyflow](https://github.com/xyflow/xyflow)
   - **复用边界**：作为前端 Node-Link 拓扑连接器（Visual Spec Builder）的底层渲染引擎，由平台前端 `package.json` 物理以 npm 依赖形式导入，负责卡片节点、动态连接线、以及吸附缩放的 UI 展现。

### 10.2 只读架构设计与业务实现标杆（Reference Standards）

1. **`Dub.co` (Next.js 美学与 SaaS 底盘参考)**：
   - **GitHub**: [https://github.com/steven-tey/dub](https://github.com/steven-tey/dub)
   - **参考点**：子域名动态解析 Middleware 多租户隔离机制、行级 RBAC 权限判定、以及开发者 API Keys 平台凭证发放机制。我们在编写 `tenant/basic-workspace` 及 `rbac/basic` 等策略块时，以此为只读标准进行契约升华。
2. **`Cal.com` (企业动态协作与正交 Slots 插件参考)**：
   - **GitHub**: [https://github.com/calcom/calcom](https://github.com/calcom/calcom)
   - **参考点**：`packages/app-store/` 中极致的正交 Slots 声明式 manifest 插件机制、数千行级极其健壮的 `schema.prisma` 模型关联、以及 EE Workflows 动态工作流规则引擎。这为我们设计大中枢 Block 提供了最顶级的业务建模设计范本。
3. **`Flowise` (拓扑转契约的交互设计参考)**：
   - **GitHub**: [https://github.com/FlowiseAI/Flowise](https://github.com/FlowiseAI/Flowise)
   - **参考点**：用户在前端进行 React Flow 拖拽、引脚连线、配置卡片参数后，如何将图形操作归一化回写为一份后端的 JSON 拓扑数据（Engineering IR）。这对于我们设计 mutations 缓冲回写流程是最佳的交互范本。
4. **`Novu` (多通道 Omni 通知中心设计参考)**：
   - **GitHub**: [https://github.com/novuhq/novu](https://github.com/novuhq/novu)
   - **参考点**：如何通过统一的 Provider 适配器（Adapters）模式封装 Email、SMS、Push、In-app 通知，消除具体通道提供商的业务 hardcode，指导我们 `notify/` 通知 Block 库的升级。
5. **`Casbin` (声明式策略引擎设计参考)**：
   - **GitHub**: [https://github.com/casbin/casbin](https://github.com/casbin/casbin)
   - **参考点**：其著名的“PERM”声明式访问控制模型（Subject, Object, Action, Effect）和行级策略过滤引擎，用来指导我们 `policy/` 模块对于行级 ABAC 权限策略存储的 schema 设计。


