---
title: Registry 与 Block 协议规范
status: active
last-reviewed: 2026-07-06
---

# Registry 与 Block 协议规范

本文定义 Registry、Block、Pin、Slot、Semantic Contract、Generator 和版本打包边界。

## 1. Registry

Registry 分发 Block。当前支持 official/private source；remote/community 属于后续阶段。

长期分发模型：

```text
Block = Manifest + Contracts + Generator Declarations + Files + Tests + Migrations
```

当前实现仍兼容 file/install 型 Block；`files/**` 是兼容与 escape hatch，不是长期工程语义母模型。

## 2. Block 的职责

Block 是：

- 分发单位。
- 版本单位。
- Registry Trust 单位。
- Upgrade/Migration 单位。
- Artifact Provenance 来源单位。

Block 不是默认架构理解单位。架构理解由 Semantic Responsibility、Operation、State、Contract、Effect 等 IR Entity/Fact 承担。

Responsibility 可以通过显式 Contract import 与 qualified reference 跨 Block；未声明 import 的跨 Contract linkage 仍然 hard fail，禁止按同名或共享 namespace 隐式合并。

## 3. 当前 Block 分类

| kind | 用途 |
| --- | --- |
| `capability` | 用户可感知业务能力 |
| `strategy` | 权限、审计、通知、搜索等横切策略 |
| `infra` | DB、Cache、Queue、External Service 接入 |
| `governance` | Verification、Policy、Audit 等治理能力 |

`kernel` 是规划类别，正式 TypeScript union / Schema 未支持前不能进入稳定 Manifest。

## 4. 当前目录协议

```text
<registry>/<block-id>/
  block.manifest.yaml
  contracts/
  generators/        # 目录协议保留；当前 generator declaration 实际位于 manifest.generators
  files/
  tests/
  versions/<version>/
    block.manifest.yaml
    migrations/
```

当前 `load-manifest.ts` 支持 Root Manifest 与 versioned manifest overlay。当前 overlay 是 shallow object merge；结构/数组字段由 versioned manifest 整字段覆盖 Root Manifest。改变 overlay 规则必须同步 loader contract tests 与 migration policy。

## 5. Manifest 当前真实字段

当前 TypeScript 类型与 loader 已支持：

- id / version / kind / stackProfiles / compatibility。
- requires / provides / conflicts。
- contracts。
- generators。
- installs。
- pins。
- slots。
- acceptance。
- routes。
- upgrade。
- uiPortals / uiHooks。

`validateManifest()` 会把缺失的 `contracts` / `generators` 归一为空数组，并执行 Semantic Manifest validation。

当前示例：

```yaml
contracts:
  - path: contracts/ticket.yaml

generators:
  - id: ticket-status-runtime-contract
    kind: generate-state-transition-map
    contract: ticket-core
    state: ticket-status
    target: src/installed/ticket/ticket-semantic-contract.ts
    consumes:
      - state
      - transition
    produces: typescript-runtime-contract
    typeBinding:
      name: TicketStatus
      importFrom: ../../runtime/database.ts
    verification:
      - typecheck
      - ticket_status_can_transition
```

## 6. Capability

`requires` / `provides` 表达 Block 级组合依赖。Capability 是 Resolver contract，不承担完整数据流、状态、Effect 或 lifecycle semantics。

约束：

- provides 与 conflicts 不得自相矛盾。
- Resolver 对 requires/provides/conflicts 做确定性求解。
- Capability ID 使用稳定 domain/action 形式。

## 7. Pin 与 Typed Semantic Port

当前 Pin 字段只有：

```text
id / type / required
```

Engineering IR 当前把 Manifest input/output pins投影成 `port` Entity，并通过 `REQUIRES / PROVIDES` 与 Block连接。

目标 Typed Semantic Port：

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

计划 kind：

```text
event | data | command | query | policy | view | lifecycle
```

Port 连接进入 IR 后形成 Fact；UI连线只是 Mutation输入，不是事实源。

## 8. Slot

Slot 是显式扩展点，用于有限、局部、可验证的定制逻辑。

当前 kind：

```text
adapter | policy | ux | repair
```

当前合同包括：

- id / kind。
- target / sourcePath。
- symbol / exports。
- input/output type。
- writable zones。
- provenance hints。
- acceptance/verification association。

当前 Task Envelope v1只服务 Slot Synthesis。Slot逻辑持续增长、需要独立版本/复用/升级时，应提升为 Governed Source Responsibility 或 Private Block。

## 9. Semantic Contract

当前真实 Schema v1支持：

- entity / field。
- state / transition。
- responsibility。
- operation。
- event。
- policy。
- permission。
- effect。
- scenario / acceptance reference。
- `imports[{ alias, namespace, contractId }]`。
- Semantic Policy `verifiedBy` Verification Policy identity。

当前 loader执行：

1. formatVersion / contract identity validation。
2. deterministic normalization / sorting。
3. collection-local unique id validation。
4. entity/field reference validation。
5. state local reference validation。
6. responsibility/operation/event/policy/permission/effect local reference validation。
7. scenario local step reference validation。
8. qualified reference 语法保留给 Workspace Semantic Linker。

### Workspace Semantic Linker

Semantic Frontend 在 local normalization 后建立 workspace namespace/contract identity registry，并按 import alias 解析：

```text
local reference:     TicketQuery
qualified reference: tenant::TenantScopeGuard
```

- unqualified reference 只解析当前 Contract，不搜索 imports。
- qualified reference 的 alias 必须在当前 Contract `imports` 中唯一声明。
- import 同时绑定 namespace 与 contractId；同 namespace distinct Contract、重复 alias、missing import/target 均 hard fail。
- Linker 对 entity/field、responsibility、operation、policy、permission、effect 与 event 进行 kind-specific resolution，并把引用 canonicalize 为 `namespace::id`。
- Semantic Policy 只有显式 `verifiedBy` 才与 Verification Policy 产生 `ENFORCES / VERIFIED_BY` Facts；同名不自动映射。
- linked Contract 直接进入 canonical IR build/validate，不持久化第二份 authoritative graph。

当前仍不支持跨 workspace/repository Contract import；P0-4 的 ownership boundary 是同一个 resolved workspace。

## 10. Generator：当前实现与目标协议分开

### 当前 Generator v1

当前只有一种 kind：

```text
generate-state-transition-map
```

当前全局 `ManifestGenerator` shape实际上是该 generator的专用配置：

- contract。
- state。
- target。
- consumes必须包含 state + transition。
- produces固定支持 typescript-runtime-contract。
- relative TypeScript type binding。
- verification selectors。

这只是 **State Transition Generator v1**，不得描述为已经完成通用 Generator Protocol。

### 目标 Generator Protocol

Generator按工程动作注册。输入是 validated IR selector，输出 Generator Plan / Artifact。

通用声明至少需要：

- kind。
- deterministic identity。
- semantic selector / required predicates。
- consumes。
- produces。
- target constraints。
- verification requirements。

不同 generator kind的 config必须使用 discriminated union或 per-kind schema registry验证。禁止把 `state/typeBinding` 等某一 generator专有字段提升为所有 Generator的全局必填字段。

长期链路：

```text
Validated IR
  → select semantic facts
  → build Generator Plan
  → lower
  → Artifact Provenance
  → Verification
```

Lowerer不得重新读取 Contract形成第二套语义解释器。

## 11. Semantic Contract 与 Runtime Enforcement

声明 Contract 不等于实现 Contract。

当前 `ticket/basic` 已暴露一个明确反例：Contract state machine只声明：

```text
open → in_progress
in_progress → closed
closed → open
```

而现有 Ticket Service仍可直接把 `open` 改为 `closed`。因此当前 Contract只能算 authoritative declaration prototype，尚未成为 runtime enforcement authority。

v0.3 Ticket纵切面完成前必须满足：

```text
State transition Facts
  → Generator Plan
  → Runtime transition contract
  → Ticket Service enforcement
  → positive transition tests
  → forbidden transition tests
```

Contract、generated map、service implementation、acceptance suite不得维护不同状态机。

## 12. Artifact Provenance 与 Fact Provenance

Artifact Provenance回答：

```text
这个文件从哪里来？
```

Fact Provenance回答：

```text
这条语义陈述为什么成立？
```

Block是 Artifact Provenance来源单位之一；Semantic Contract是 authoritative Fact assertion来源之一。

不得因为一个 Artifact来自某 Block，就推断该 Block拥有其中所有 Semantic Responsibility或 State。

## 13. 版本与兼容

- Block version使用 SemVer。
- Block API、Compiler API、Stack Profile属于 compatibility contract。
- 同一解析结果不得包含同 ID不兼容 major。
- Versioned Manifest overlay规则必须由 loader tests冻结。
- Semantic Contract formatVersion与 Block version分开。
- Contract Schema升级不得借用业务 Block major偷偷表达。
- Upgrade重编译必须进入统一 Pipeline Coordinator；不得直接调用 Resolver/Composer内部函数绕过 Semantic Frontend。

## 14. Trust 与发布

后续 Registry Trust至少区分 official/private/remote/community source，并记录：

- registry identity。
- signer/trust policy。
- content digest。
- Block provenance。
- declared effects/permissions。
- verification status。

Trust不能由 AI confidence代替。

## 15. 当前实现边界

当前正确描述是：

```text
File/install Block protocol              implemented
Registry source/version resolution       implemented
Slot protocol                            implemented
Semantic Contract v1 loader + imports    implemented
State Transition Generator v1            prototype implemented
Generic Generator Protocol               not implemented
Workspace Semantic Linker                implemented
IR-owned Lowering                         not implemented
Cross-Block Semantic Responsibility       implemented with explicit import
Semantic Policy ↔ Verification Policy map implemented with explicit verifiedBy
```

任何 active doc、README或 PR说明必须使用这一边界。
