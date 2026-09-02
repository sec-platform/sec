---
title: Registry、Block 与能力协议
status: stable
domain: capability-block
---

# Registry、Block 与能力协议

## 1. 所有权与存在证明

本文拥有 Registry、可选 Block 载体、Block Capability/Binding、Port、Semantic Contract、Generator、Typed/Governed Extension 与历史 Slot 退役边界。产品级 Implementation Resolution 属于 compiler owner。

~~~text
Keep(Object) iff
  real producer
  AND real consumer
  AND independent semantic identity
  AND lifecycle or boundary not derivable from smaller object
  AND deleting it worsens user outcome or correct-change cost
~~~

| 需求 | 最小对象 |
|---|---|
| 声明业务语义 | Semantic Contract |
| 选择具体实现 | Implementation Candidate/Binding |
| 调用 typed 外部 API | TypedInvocation |
| 可替换局部纯实现 | Typed Extension |
| 有 Effect/状态/资源的扩展 | Governed Extension/Custom Provider |
| 独立分发/信任/升级/资产生命周期 | Block |
| 私有独立分发 + governed behavior | Private Block |

Block、Capability、Port、Generator、version 或 migration 不是统一必经“芯片层”。缺存在证明时使用更小对象。

## 2. 对象关系

~~~mermaid
flowchart TD
  R[Registry] --> B[Block revision]
  B --> C[Contract declarations]
  B --> G[Generator declarations]
  B --> F[Assets or migrations]
  B --> PC[Provided Block capabilities]
  Q[Block capability requirement] --> BR[Block Resolver]
  R --> BR
  PC --> BR
  BR --> BPB[Frozen BlockProviderBinding]
  BPB --> IC[Implementation candidate closure]
  IC --> IR[Implementation Resolution]
  IR --> IB[ImplementationBinding]
  C --> EIR[Engineering IR]
  IB --> TP[Target Program]
~~~

Registry 分发；Block 封装独立生命周期；Block Resolver 解析 Block 级资源/信任；Implementation Resolver 选择产品实现。四者不能合并。

## 3. Registry

Registry source 可为 official/private/remote/community；source class 只表达分发与 trust policy，不证明安全、语义正确或 Target compatible。

一次 resolution 绑定：

| Binding | 要求 |
|---|---|
| source | registry identity + source revision |
| content | Block identity/version/content digest |
| trust | signer/policy/integrity |
| compatibility | explicit constraints |
| selection | canonical policy + witness |

同一 ID 多 source 不按搜索顺序、时间或“最新”覆盖。Registry 是只读 distribution authority；cache/copy/mirror/Brownfield path 不获得 Registry 写 authority。

## 4. Block

~~~mermaid
flowchart TD
  X{是否有独立分发 信任 升级 迁移 或资产生命周期?}
  X -- no --> S[Use Contract Provider Extension or ordinary implementation]
  X -- yes --> C{有真实 producer and consumer?}
  C -- no --> O[Capability obligation only]
  C -- yes --> B[Create Block identity and lifecycle]
  B --> M[Minimal manifest/components required by consumers]
~~~

Block 可作为分发、trust/digest、upgrade/migration/retirement、Contract/Generator/tests/assets packaging 与 artifact provenance 单位。它不是默认架构理解、source organization、implementation selection 或 test organization。

Block components 由真实 consumer 决定，不设统一必填大清单。file installation 是 escape hatch，不证明 Contract 执行、Effect 受控或 Acceptance 覆盖。

## 5. Block lifecycle 与 version domains

~~~mermaid
stateDiagram-v2
  [*] --> Authored
  Authored --> Validated
  Validated --> Published
  Published --> Resolved
  Resolved --> Materialized
  Materialized --> Composed
  Composed --> Verified
  Verified --> Operated
  Operated --> Migrating
  Migrating --> Operated
  Operated --> Deprecated
  Deprecated --> Retired
~~~

| Version domain | 不能借用 |
|---|---|
| Block business version | Contract schema、compiler protocol |
| Contract format/revision | Block release number |
| Generator protocol | Adapter protocol |
| Registry protocol | Target compatibility |
| Block Capability revision | Implementation Binding revision |
| Migration grammar | current runtime grammar |

只有真实持久、跨进程、外部或迁移 consumer 区分多个状态时，版本域才存在。退役必须覆盖 installed workspaces、dependent Blocks、artifacts、migration、provenance 与 rollback。

## 6. Block Capability Resolution

~~~mermaid
flowchart LR
  Q[BlockCapabilityRequirement] --> C[Registry candidates]
  C --> T[Trust eligibility]
  T --> V[Version/contract/Target eligibility]
  V --> E[Effect/resource eligibility]
  E --> D[BlockResolutionDecision]
  D --> B[Frozen BlockProviderBinding]
~~~

Capability identity 与 display name 分离，并绑定 contract/type/effect profile、consumer scope；revision/range 只在真实 compatibility consumer 存在时建立。

Block Resolver 必须：

- canonicalize input/source/trust/policy；
- 只枚举 candidates，不 install/run Generator/execute code；
- 检查 conflicts、missing provider、version/contract/Target incompatibility、cycles；
- unknown/ambiguous/untrusted/unsupported fail closed；
- 使用 explicit selector 或 canonical policy，不因只找到一个而授权；
- 输出 deterministic Binding 与 materialization/lowering order；
- 引用 exact manifest/resource/source/trust digests，不复制 truth summaries；
- frozen Binding 后 consumer 不重扫 live Registry。

## 7. 与 Implementation Resolution 的边界

~~~mermaid
sequenceDiagram
  participant IR as Implementation Resolver
  participant BR as Block Resolver
  IR->>IR: build native/reference/existing/custom candidates
  alt candidate needs block delivery
    IR->>BR: bounded capability request
    BR-->>IR: frozen BlockProviderBinding or typed failure
  end
  IR->>IR: unified hard eligibility
  IR->>IR: policy/tie-break/ResolutionDecision
  IR->>IR: exact ImplementationBinding
~~~

| Block Resolver owns | Implementation Resolver owns |
|---|---|
| Registry/Block candidates | product-semantic candidates |
| trust/version/static constraints | hard eligibility across all sources |
| resource closure/install order | user/org constraints and policy |
| BlockResolutionDecision | final ResolutionDecision |
| BlockProviderBinding | ImplementationBinding |

ImplementationBinding 可以引用零或多个 BlockProviderBindings，但不复制其内容。没有 block-delivered requirement 时，Block Resolver 与 Registry observation 均为零。

## 8. Provider、Adapter、Reference、Custom

| Object | Meaning | Authority ceiling |
|---|---|---|
| Provider declaration | 提供 Capability/Target/Effect/resource/limits | candidate declaration |
| Adapter declaration | Contract 到 Provider API 的映射 | 不拥有 business Responsibility |
| Reference Provider | 最小可解释 conformance baseline | 不代表全局最优 |
| Custom Provider | 用户/组织的 governed implementation | 需 owner/Effect/Verification/Migration |
| AI/source candidate | inferred implementation | Adopt 前不进 catalog |

Registry 分发声明；External Provider owner 决定 security/license/conformance；Implementation Resolution 决定是否选择。

## 9. Port

Typed Semantic Port 表达 event/data/command/query/policy/view/lifecycle 等连接，并绑定 direction、payload/type、scope、owner、policy/permission、compatibility、Verification。

~~~text
CanonicalConnection =
  two compatible Contracts
  + explicit qualified reference
  + resolver/linker decision
  + validated IR Fact
~~~

UI 连线、同名 endpoint、Provider 推断只是 proposal。Port evolution 必须说明 compatibility direction、consumer migration、serialization 与 failure；不允许 any、隐式 coercion 或字符串同名。

## 10. Extension 模型：替代 Slot

历史 Slot 把 contract、implementation、work item、verification 混成一个对象。canonical model 强制拆分：

~~~mermaid
flowchart LR
  EC[ExtensionContract] --> EB[ExtensionImplementationBinding]
  WI[ExtensionWorkItem] --> EB
  EB --> EV[ExtensionVerification]
  EC --> EV
~~~

| Object | Owns | Does not own |
|---|---|---|
| ExtensionContract | local semantics、I/O、allowed ports、forbidden Effects、Acceptance | path、task、result |
| ExtensionImplementationBinding | source/provider identity、content/grant digest、Target、transitive Effects | mutable work |
| ExtensionWorkItem | write bounds、required symbols、budget、progress | runtime authority |
| ExtensionVerification | exact Binding behavior/Effect/Target Evidence | all tests globally |

### Promotion decision

~~~mermaid
flowchart TD
  X[Extension need] --> P{Pure deterministic local transform?}
  P -- yes --> B{No state resource env migration external Effect?}
  B -- yes --> T[Typed Extension]
  B -- no --> G[Governed Extension or Custom Provider]
  P -- no --> G
  G --> D{Independent distribution/trust/upgrade lifecycle?}
  D -- yes --> PB[Private Block]
  D -- no --> GE[Governed Extension]
~~~

Typed Extension 的 capabilities 只通过 typed ports 注入；ambient host capability 禁止。出现 event callback、database、network、clock/random、process、filesystem、credential、state、multi-operation、reuse 或 migration 任一项，就升级为 governed object。

普通参数传高权限对象、forbiddenOperations prose 或 lint PASS 都不能证明零 capability。

旧 Slot grammar 只在 exact durable migration parser 中识别；normal runtime 不创建新 Slot revision、alias、dual-write 或 fallback。

## 11. Semantic Contract

Contract 声明 Entity、Field、Responsibility、Operation、State、Transition、Event、Policy、Permission、Effect、Scenario、Acceptance；不拥有 source layout、具体 library、run result 或 UI。

Cross-contract reference 必须 explicit import + alias + namespace + contract identity + expected kind：

| Failure | Result |
|---|---|
| duplicate alias | reject |
| missing target | reject |
| kind mismatch | reject |
| implicit same-name link | reject |
| same namespace/different contract | reject |

Contract 被 validated frontend 直接装载，不持久化第二 authority graph。Provider 无法满足 Contract 时淘汰或触发 Semantic Migration，不能修改 Contract。

## 12. Generator

Generator 按 engineering operation 注册，只消费 validated semantic selector、Target/Profile、exact Implementation/Block Bindings 与 declaration。

| Facet | Contract |
|---|---|
| identity | deterministic；真实 protocol consumer 才 versioned |
| selection | required predicates/selector |
| dependency | consumes/produces/Target constraints |
| implementation | exact Binding refs |
| ownership | source/artifact writer + collision policy |
| output | canonical ordering/naming/bytes |
| proof | Verification requirements/diagnostics/provenance |
| lifecycle | migration/retirement |

专用字段只在 discriminated variant；缺 semantic producer/Binding/support 时 emit 前拒绝，不生成 TODO、empty implementation、default library 或品牌分支。

## 13. Writer cutover 与 migration

~~~mermaid
flowchart LR
  O[Old resolver/writer] --> S[Read-only shadow]
  S --> P[Decision Binding bytes effect parity]
  P --> C[Consumer and writer cutover]
  C --> I[Invalidate old plans/bindings]
  I --> R[Retire old owner path tests dependencies]
~~~

切换必须消费 Change Management 的 intent-absorption、Compatibility/Migration 与 consumer-zero admission，覆盖 current observable、accepted future obligations、producer/reader/writer、external/durable state、failure/recovery 与 unknown。

升级不能让同名 Capability 静默改变 timeout/retry/error/effect。Generated-file override 默认 block，直到保留、转 rule-backed patch 或明确丢弃。

## 14. Trust 与发布

Block publication 绑定 registry、content digest、signer/trust policy、Effect/Permission、compatibility、tests、Verification、provenance。下载量、AI confidence、source 名称与多 Provider 一致都不能代替 trust 或 implementation choice。remote/native/install/build code 需要独立 sandbox/provider boundary。

## 15. 无代码逻辑验证

| 场景 | 必须结果 | 禁止 |
|---|---|---|
| 只有一个 local pure callback | Typed Extension | 创建 Block |
| callback接收数据库/session | Governed Extension | 仍称零 capability |
| Block只因目录存在 | orphan | path证明生命周期 |
| 同Capability多Registry source | explicit policy/witness | search-order wins |
| Block candidate唯一 | 仍做 trust/eligibility | 自动授权 |
| Provider通过conformance | eligible candidate | final Binding |
| Contract同名未import | reject | implicit link |
| Generator缺Binding | unsupported-before-emit | TODO output |
| old Slot state存在 | isolated migration | runtime dual-read |
| old writer仍有consumer | preserve/block | 宣称 retired |

## 16. 完成条件

~~~text
CapabilityBlockClosed =
  every object passes existence proof
  AND Registry distribution != trust != implementation choice
  AND Block Resolver != Implementation Resolver
  AND Contract != Binding != WorkItem != Verification
  AND Slot grammar is retired from normal runtime
  AND one writer per artifact and one resolver per scope
  AND migration absorbs current and accepted future obligations
~~~
