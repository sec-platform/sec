---
title: Brownfield 导入
status: stable
domain: brownfield
---

# Brownfield 导入

## 1. 所有权

本文拥有既有工程与外部类库进入 SEC 的 Attach→Lift→Reconcile→Adopt→Normalize 生命周期、typed invocation、owner migration、unknown/opaque 与安全导入条件。TypeScript 是首个 frontend；identity、Evidence 与阶段语义保持语言无关。Adopt 后的 entity realization、Placement、Change Locality、round-trip implementation 和旧地址退役由 `docs/implementation-architecture.md` 拥有；本文不能从路径/名字直接签发实现 owner。

~~~mermaid
flowchart LR
  A[Attach physical facts] --> L[Lift source model]
  L --> R[Reconcile candidates]
  R --> AD[Adopt governed authority]
  AD --> G[Govern operations]
  G --> N[Normalize deterministic projection]
~~~

每阶段增加可证明的理解或治理权力；源码可读、类型正确、AI 可生成调用都不等于业务语义恢复。

## 2. Subject 边界

`SEC repository`、`Target workspace`和`Project`的产品含义只引用[产品词汇](product.md)，本片段不重新定义。Brownfield 只增加导入所需的物理关系：

| Import subject | 含义 | 不能混用 |
|---|---|---|
| external package/source snapshot | 独立外部输入的 exact content subject | SEC authored source、业务 Definition |
| Git worktree observation | 某个 repository revision 的物理 checkout | workspace/project identity |
| path | snapshot 内的 Address | semantic identity、owner、permission |

裸 workspace/source/worktree/path 不能跨边界授权读取、写入或复用；它们只能通过产品词汇与本片段的 typed relation 进入导入闭包。

## 3. Attach：物理事实

Attach 对 exact physical identity 建 inventory，只回答“看见什么”。

| Inventory facet | 内容 |
|---|---|
| structure | repository/workspace/package/target/application/module |
| Git/content | tracked/untracked/ignored、mode、encoding、digest |
| topology | symlink/reparse、case、Unicode、containment |
| classification | source/generated/vendor/binary/secret/protected/temp/opaque |
| surface | public/release entry、config、resource、owner |
| package | exports/types/peer/transitive/lock/integrity/native/install/build |
| environment | toolchain/build system/workspace resolution |
| frontier | unreadable/unsupported/excluded/unresolved + reason |

Attach 默认不执行 target code、package scripts、build、browser 或 network。扫描/权限/parser/provider coverage 失败是 unknown，不是 absent。

## 4. Lift：Source Program

~~~mermaid
flowchart TD
  I[Physical inventory] --> F[Language frontend]
  F --> S[Syntax symbol type module facts]
  S --> A[Analysis candidates]
  A --> M[Canonical Source Program]
  M --> P[Bounded projections]
  P --> AU[Audit]
  P --> TI[Test Impact]
  P --> AR[Architecture]
  P --> AI[AI Read Plan]
~~~

### 模型层

| Layer | Facts |
|---|---|
| physical | workspace/package/target/file/module |
| language | export/declaration/type/reference/span/import/resolution |
| invocation | function/constructor/method/generic/overload/call candidate |
| analysis | control/data-flow/state/effect/framework candidate |
| classification | generated/vendor/protected/opaque |
| frontier | unresolved/ambiguous/provider conflict |

模型绑定 exact snapshot、compiler/provider/config/dependency generation、coverage、canonical digest，并 strict validate/order/freeze。rename/move、merge、overload、conditional export、monorepo、generated source、case/reparse 与 version skew 都必须有策略。

### One snapshot, one graph

同一 exact source snapshot 只编译一个 canonical Source Program。CLI、hook、workflow、test、Impact、Architecture 与 audit 只消费 bounded projections，不各自创建 AST、Language Service、resolver、path census、entrypoint list 或 cache。

~~~text
SourceClosure =
  entrypoint
  → handler
  → operation
  → capability/provider
  → Effect
  → settlement
  → readback
~~~

dynamic load、shell composition、reflection 或 external runner 无法解析时保留 unknown。consumer-zero 删除裁决必须覆盖 source/generated/runtime consumers、dependency/integrity、external capabilities、durable readers/writers、migration/retirement 与 opaque frontier。

Compiler/provider 只发布其能证明的 language facts；SEC 组合唯一 repository graph，不重写成熟 parser。clean/incremental outputs 必须 byte-equivalent。

观察世代、内容寻址 fact shard、跨进程复用、父资源账本、Windows retained capability
以及 cold/warm/delta 的唯一实现合同由
[实现架构的增量与共享事实章节](implementation-architecture/source-and-generation.md#78-增量共享事实与性能)
拥有；Brownfield 只负责签发其中可证明的 language facts 与 unknown frontier。所有
typecheck、audit、test-impact、architecture 和 Agent 查询必须消费同一
`SourceObservationGeneration`，各自只取得自己的只读 allocation；不得再建 receipt、
scanner、AST 图或 cache owner。该交接关系变化时只更新相应 owner 的 contract/ref，
不在本文件复制实现字段。

## 5. Generic external library binding

~~~mermaid
flowchart LR
  P[Exact package identity] --> E[Exported symbol]
  E --> T[TypedInvocation]
  T --> B[ExternalCallBinding]
  B --> C[Type-correct Target call]
  C --> D[Declared governed invocation]
  D --> PC[Provider or Adapter candidate]
  PC --> V[Conformance and Adopt]
~~~

### TypedInvocation contract

| Binding | 内容 |
|---|---|
| package | source/version/integrity/module export |
| symbol | function/constructor/method identity |
| call | call/construct、generic、overload |
| type | parameters、return、throw/async shape |
| data | input/output bindings |
| target | module resolution/Target requirement |
| unknown | Effect、Permission、resource、runtime behavior |

TypedInvocation 只承诺 observed call shape 与 typecheck；不承诺 business contract、Effect、idempotency、retry、timeout、cancellation、security 或 runtime behavior。

用户声明 Contract/Effect/Permission/resource/error/Target/Verification/owner 后，它成为 Governed Extension/Custom Provider candidate，不自动成为事实。源码、types、docs、tests、examples、trace 与 AI 可以补 candidate/Evidence；只有 External Provider governance、conformance、security/license 与 Adopt 后才能进入正式 catalog。

## 6. Maturity 与 Provider

Brownfield 生命周期和 external provider maturity 是两个正交轴：

| Brownfield state | 表示 |
|---|---|
| Attach | 物理可见 |
| Lift | 结构可理解 |
| Reconcile | 候选被比较 |
| Adopt | scope 内治理 authority |
| Govern | operations 受控 |
| Normalize | SEC-owned deterministic projection |

Provider maturity taxonomy、catalog eligibility 与 Support Claim 由 external-provider owner 独立拥有。一个 package 的不同 capabilities 可处于不同 maturity。

Provider receipt 绑定 identity、scope/revision、coverage/unsupported、authority class、diagnostics/unknown、Evidence refs 与 resource/Effect boundary。Provider 只能增加 Evidence/candidates；不能创建 authoritative Fact、source owner、writable path、Binding 或 Normalize decision。多个 providers 一致不升格。

## 7. Reconcile

Reconcile 只读比较 Source Program、Contract、Engineering IR、repository identity、owner policy、Target、Provider Evidence 与 competing explanations。

| Result | Meaning |
|---|---|
| accepted | 该 claim/binding 被 policy 或人接受 |
| rejected | 保留理由/Evidence，不等于删源码 |
| conflicted | 权威或候选互不兼容 |
| ambiguous | 多种解释仍可行 |
| unknown | coverage/semantics 不足 |
| opaque | 边界已知，内部不建模 |

同名、邻近路径、运行时偶遇、高 confidence、同 AST/API/signature 或框架惯例都不建立 canonical relation。

外部调用必须分开 observed type facts、user-declared Contract/Effect、inferred Provider candidate、conformance Evidence、catalog eligibility。

## 8. Adopt

~~~text
Adopted =
  explicit scoped decision
  + stable identity/source binding
  + one owner/writer/public surface
  + allowed operations/effects
  + Contract/Policy/Permission/Acceptance
  + owner-issued Verification obligations
  + preservation/migration/recovery/retirement
~~~

Adopt 不复制源码进 IR，不提高 inferred confidence，不把整个文件或 Provider 升格。没有 Block 的工程仍可有 Responsibility、Contract 与 governed mutation；历史 Slot grammar 不因 extension 需要而恢复。

Adopt Provider 只允许其进入 candidate catalog；最终选择属于 Implementation Resolution。

## 9. Normalize

~~~mermaid
flowchart TD
  G[Governed source] --> S{Semantic completeness?}
  S -- no --> K[Remain governed or opaque]
  S -- yes --> R{Round-trip and runtime parity?}
  R -- no --> K
  R -- yes --> M[Migration plan]
  M --> C[Consumer cutover]
  C --> D[Old writer adapter dependency retirement]
  D --> N[SEC-owned projection]
~~~

Normalize 必须证明：

1. Entity/Fact/behavior/Effect/Permission/error 完整；
2. source mapping、format/comments/public surface 符合政策；
3. Target lowering、Binding 与 bytes deterministic；
4. runtime/Acceptance + Compatibility Decision 证明适用 parity；
5. consumer migration、actual Delta/Impact 可接受；
6. rollback/recovery 可验证；
7. old writer/adapter/dependency/authority 已退役。

不能生成 TODO、any、empty adapter 伪装完成。

## 10. Implementation Resolution 边界

Brownfield 提供 adopted existing implementations、verified Provider/Adapter candidates、typed/custom governed candidates、Evidence/unknown、owner/Target/migration constraints。

它不拥有 hard eligibility、policy/tie-break、ResolutionDecision/Binding、Target Program 或 artifact publication。Resolver 选择 candidate 不能反向把 inferred behavior 变成 authoritative semantics。

## 11. Governed write

Attach、Lift、Reconcile 零 Effect。Adopt 后写入必须：

~~~mermaid
sequenceDiagram
  participant O as Operation registry
  participant S as Source owner
  participant T as Transaction
  participant V as Verification
  O->>S: resolve exact governed region
  S->>T: source binding + byte identity
  T->>T: lease journal isolated transform
  T->>T: source and semantic CAS
  T->>V: actual Delta Impact requirements
  V-->>T: typed result
  T->>T: publish or rollback/recovery
~~~

不完整 mapping、ambiguous owner、opaque side effect fail closed。Codemod/AST/LST/AI patch 是 proposal；parse/typecheck success 不等于 semantic/runtime parity。

## 12. 配置、资源与多语言

配置、thread/process/network/storage/environment/deployment/native capability 先是 observations；只有独立 owner、identity、lifecycle、Impact、Mutation、Verification 后才成为 domain/Target/Provider field。

| Language capability | Responsibility |
|---|---|
| frontend | syntax/symbol/type/module resolution/source map |
| analysis | control/data/effect/framework candidates |
| language service | reference/rename/import queries |
| transform | AST/LST/codemod/comment preservation |
| backend | Target Program → bytes |
| build/runtime adapter | physical toolchain/environment |

语言 AST/bytecode/compiler IR 不是 Engineering IR。同一品牌/package 不能隐式拥有全部 capabilities。

## 13. 安全

默认不上传源码、不读 secret/environment、不跟随越界 topology、不执行 install/build/test。runtime trace、package manager、browser、native helper 或 network 需要显式 capability、isolation、deadline、aggregate budgets、redaction、cleanup 与 Evidence scope。普通 temp directory 或 compiler validation 不是 sandbox。

## 14. 无代码逻辑验证

| 场景 | 必须结果 | 禁止 |
|---|---|---|
| scan permission denied | unknown | absent |
| package有types但Effect未知 | TypedInvocation | supported Provider |
| 多Provider给同一候选 | competing Evidence | majority authority |
| file moved | binding re-evaluation | path identity |
| adopted region含unowned comments | preserve | regeneration overwrite |
| Normalize缺runtime parity | remain governed | deterministic projection |
| no Block | normal Responsibility/Contract | Block-as-license |
| frontend parse dynamic import失败 | opaque frontier | regex补图 |
| current test imports package | consumer evidence | whole package consumer-zero |
| AI生成Adapter | candidate | catalog eligibility |

## 15. 完成条件

~~~text
BrownfieldClosed =
  exact bounded physical inventory
  AND one Source Program per snapshot
  AND explicit unknown/opaque frontier
  AND Reconcile is read-only
  AND Adopt is scoped and authoritative
  AND governed writes use canonical transaction
  AND Normalize proves parity/migration/retirement
  AND Provider and Resolution owners remain separate
~~~
