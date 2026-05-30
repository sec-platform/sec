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

支持动作：`copy`（递归复制）、`merge-prisma`（智能合并去重）。

最终形态还允许 generator 类动作，但必须按工程动作命名和注册，例如 `generate-entity-service`、`generate-api-route`、`generate-prisma-model`、`generate-view`、`generate-acceptance-test`。禁止按业务 block 命名策略，例如 `generate-customer`、`CustomerInstallStrategy`、`TicketInstallStrategy`。

禁止规则：
- block 不得安装到其他 block manifest、`control/**`、`platform/cli/`。
- block 不得修改不属于自己 `writableZones` 的文件。
- block 不得要求核心编译器理解具体业务名；业务语义必须通过 `contracts`、`pins`、`slots`、`acceptance`、`policy` 进入 Engineering IR。
