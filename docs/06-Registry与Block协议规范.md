---
title: Registry 与 Block 协议规范
status: active
last-reviewed: 2026-07-04
---

# Registry 与 Block 协议规范

本文定义 Registry、Block、Pin、Slot、Contract、Generator 和版本打包边界。

## 1. Registry

Registry 分发 Block。当前支持 official/private source；远程/community 属于后续阶段。

核心平台只理解协议，不理解业务 Block 名称。Registry 的长期资产是：

```text
Block = Manifest + Contracts + Generators + Files + Tests + Migrations
```

当前 v0.2 兼容文件装载型 Block；v0.3 开始允许 Contract-first Block。`files/**` 是兼容与 escape hatch，不是长期主模型。

## 2. Block 是什么

Block 是：

- 分发单位。
- 版本单位。
- Registry 信任单位。
- Upgrade/Migration 单位。
- Artifact Provenance 的来源单位。

Block **不是默认架构理解单位**。一个 Block 可声明多个 Semantic Responsibility；Responsibility 可在显式 Contract 下跨 Block。

## 3. Block 分类

| kind | 用途 |
| --- | --- |
| `capability` | 用户可感知的业务能力 |
| `strategy` | 权限、审计、通知、搜索等横切策略 |
| `infra` | DB、Cache、Queue、External Service 接入 |
| `governance` | Verification、Policy、Audit 等治理能力 |
| `kernel` | 规划：高性能/底层实现，只治理接口、Effect、Ownership、Benchmark |

`kernel` 在正式类型/Schema 未落地前仍是规划值，不能出现在稳定 Manifest。

## 4. 目录协议

```text
<registry>/<block-id>/
  block.manifest.yaml
  contracts/
  generators/
  files/
  tests/
  versions/<version>/
    block.manifest.yaml
    migrations/
```

当前实现仍从现有 `files/**` 和 manifest 安装动作工作。`contracts/**`、`generators/**` 在 v0.3 按 `14` 的 IR 闭环逐步落地。

## 5. Manifest 核心字段

当前代码支持：

- id / version / kind / stackProfiles / compatibility。
- requires / provides / conflicts。
- installs。
- pins。
- slots。
- acceptance。
- routes。
- upgrade。
- uiPortals / uiHooks。

`contracts` 和 `generators` 是 v0.3 需要真实加入 TypeScript 类型、loader validation 和 contract test 的字段。文档不得再把它们描述为已实现字段。

目标形态：

```yaml
contracts:
  - path: contracts/ticket.yaml

generators:
  - kind: generate-entity-service
    contract: ticket
```

字段名是方向示意；正式 Schema 必须在实现时由 `05/06/14` 同步冻结。

## 6. Capability

`requires` / `provides` 表达 Block 级能力依赖。Capability 是组合求解合同，不承担完整数据流和状态语义。

约束：

- provides 与 conflicts 不得自相矛盾。
- Resolver 对 requires/provides/conflicts 做确定性求解。
- Capability ID 采用稳定 domain/action 形式。

## 7. Typed Semantic Port

Pin 是 Block 边界上的连接合同。当前字段是 `id/type/required`；目标升级为 Typed Semantic Port：

```yaml
id: ticket_created
direction: output
kind: event
schema: TicketRecord
scope: tenant
verifiedBy:
  - ticket_can_be_created
policies:
  - tenant_scope_required
```

计划 `kind`：

```text
event | data | command | query | policy | view | lifecycle
```

Port 连接进入 IR 后应形成 Fact；UI 连线只是 Mutation 输入，不是连接事实源。

## 8. Slot

Slot 是显式扩展点，用于有限、局部、可验证的定制逻辑。

当前 kind：

```text
adapter | policy | ux | repair
```

稳定合同包括：

- id / kind。
- target / sourcePath。
- symbol / exports。
- input/output type。
- writable zones。
- acceptance/verification association。

Slot 不适合承载大型领域子系统。逻辑持续增长、需要独立版本/复用/升级时，应提升为 Governed Source Responsibility 或 Private Block。

## 9. Semantic Contract

Contract 声明工程语义，第一批只覆盖 Ticket 母例需要的最小集合：

- entity / field。
- state。
- operation。
- event。
- policy / permission。
- effect。
- responsibility。
- scenario/acceptance reference。

Contract Parser 产生 Authoritative Fact；Static Analysis/Runtime Evidence 不能覆盖它，只能提供 Derived/Observed Evidence 或冲突诊断。

## 10. Generator

Generator 按工程动作注册。输入是 IR/Contract selector，输出是 Generator Plan/Artifact。

Generator 必须声明：

- kind。
- consumes：需要的 entity/fact kind。
- produces：artifact kind。
- target constraints。
- deterministic identity。
- verification requirements。

Generator 不允许以具体业务名称分派。

## 11. 版本与兼容

- Block version 使用 SemVer。
- Block API、Compiler API、Stack Profile 属于 compatibility contract。
- 同一解析结果不得包含同 ID 不兼容 major。
- Versioned Manifest 是 Root Manifest 的显式 overlay；数组/结构字段覆盖规则必须由 loader test 固定。
- Contract Schema version 与 Block version 分开；Contract 格式升级不得偷偷借用业务 Block major 表达。

## 12. Trust 与发布

后续 Registry Trust 至少区分 official/private/remote/community source，并记录：

- registry identity。
- signer/trust policy（实现前为规划）。
- content digest。
- Block provenance。
- declared effects/permissions。
- verification status。

Trust 不能由 AI confidence 代替。
