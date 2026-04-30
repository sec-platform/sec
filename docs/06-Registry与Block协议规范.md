# Registry 与 Block 协议规范

> 目标：定义 block 的打包、版本、兼容、安装与命名协议。

## 1. Registry 模型

| 类型 | 说明 | 当前状态 |
| --- | --- | --- |
| `official` | 平台官方维护，随编译器分发 | 13 个官方块 |
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
  files/src/installed/    # 安装到 project/src/installed/
  files/prisma/           # merge-prisma 源
  files/tests/            # 测试文件
  versions/<ver>/         # 版本化 overlay manifest 与版本专属文件
    migrations/           # 升级迁移
    block.manifest.yaml   # 可只声明 version + upgrade，其他字段继承 root manifest
```

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
| `upgrade` | 否 | 升级元数据 |

## 6. Slot 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | slot 唯一 id |
| `kind` | 是 | adapter / policy / ux / repair |
| `target` | 是 | 默认 runtime 目标 |
| `symbol` | 是 | 必须导出的函数名 |
| `inputType` | 否 | 输入 TS 类型 |
| `outputType` | 否 | 输出 TS 类型 |
| `writableZones` | 是 | 允许写入的目录范围 |

## 7. 安装协议

支持动作：`copy`（递归复制）、`merge-prisma`（智能合并去重）。

禁止规则：
- block 不得安装到其他 block manifest、`control/**`、`platform/cli/`。
- block 不得修改不属于自己 `writableZones` 的文件。
