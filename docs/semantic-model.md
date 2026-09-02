---
title: Engineering IR 语义模型
status: stable
domain: semantic-model
---

# Engineering IR 语义模型

## 1. 所有权与边界

本文拥有 Entity、Fact、Assertion、Semantic Responsibility、Validated Snapshot 的语义、身份域、authority、冲突和 admission。精确 TypeScript shape、parser、validator、canonical serializer 与 revision 由 semantic code owner 唯一实现。

| Engineering IR 回答 | 不回答 |
|---|---|
| 哪些工程对象与关系成立 | 源码语法、AST、文件布局 |
| 谁以什么 authority/provenance 声明 | 选择哪个具体类库/Provider |
| 哪个 Responsibility 拥有什么状态、行为和 Effect | 目标代码如何打印 |
| 当前 validated semantic snapshot 是什么 | 某次运行是否 PASS |

Engineering IR 不是 Physical Inventory、Source Program、Implementation Resolution、Target Program、ExplainGraph、interface projection 或 AI Knowledge Graph。Brownfield 与 deterministic generation 共用它，不建立平行语义核心。

## 2. 对象图

~~~mermaid
flowchart TD
  E[Entity] --> F[Fact: subject predicate object]
  P[Predicate signature] --> F
  F --> A[Assertion]
  AU[Authority] --> A
  PR[Provenance] --> A
  ER[Evidence reference] --> A
  A --> VS[Validated Snapshot]
  R[Semantic Responsibility] --> E
  R --> F
  VS --> SC[Derived Scenario cache]

  SP[Source Program receipt] --> AC[IR admission compiler]
  C[Contract Policy Adopt] --> AC
  AC --> A
  VS --> IM[Implementation requirements]
  VS --> DI[Delta and Impact]
~~~

## 3. 核心合同

| 对象 | Identity 来源 | 拥有 | 禁止 |
|---|---|---|---|
| Entity | canonical semantic subject | kind、stable identity | path、数组位置、display label、随机 UUID |
| Fact | normalized subject + predicate + object | triple identity | authority、confidence、Evidence 数量 |
| Assertion | Fact + authority + provenance identity | source claim、snapshot binding、confidence、Evidence refs | strongest/last-write-wins |
| Responsibility | stable engineering responsibility | state/operation/effect/contract/lifecycle facets | 等同文件、函数、Block、团队或类库 |
| Scenario | canonical Facts 的确定性投影 | read-only derived view | 第二声明入口 |
| Validated Snapshot | canonical payload + semantic contract | immutable admitted graph | raw/caller-built/index projection |

同一 triple 在一个 snapshot 中只有一个 Fact；不同来源的主张保留为不同 Assertions。重复来源不能合成“综合事实”。

## 4. Semantic Responsibility

~~~mermaid
flowchart LR
  R[Responsibility] --> S[Owned state]
  R --> O[Operations]
  R --> E[Effects and permissions]
  R --> C[Provided and required contracts]
  R --> P[Consumers and providers]
  R --> V[Acceptance and verification obligations]
  R --> B[Source artifact release bindings]
  R --> L[Lifecycle and replacement]
~~~

Responsibility 是影响传播和 owner 决策单位。合法 identity continuity：

| 演进 | Identity 处理 |
|---|---|
| same / renamed / moved | 保持 identity，更新 Address/Binding |
| split | 新 identities + SPLIT_FROM + migration |
| merged | 新 identity + MERGED_FROM + migration |
| replaced | 新 identity + REPLACES + retirement |
| ambiguous / unknown | 不延续、不猜测 |

### 来源与 Adopt

| 来源 | 可产生 | Authority ceiling |
|---|---|---|
| Contract / Policy / Adopt decision | authoritative assertion | 声明 scope 内 |
| canonical semantic rule | derived assertion | rule inputs 与 revision 内 |
| Source Program receipt | observed/inferred candidate | exact snapshot/coverage 内 |
| runtime observation | observed candidate/Evidence | exact environment/attempt 内 |
| AI/static analysis | inferred candidate | 永不自动 Adopt |

~~~mermaid
stateDiagram-v2
  [*] --> Candidate
  Candidate --> Accepted: scoped Adopt
  Candidate --> Rejected
  Candidate --> Ambiguous
  Candidate --> Opaque
  Accepted --> Replaced: explicit transition
  Accepted --> Split: explicit transition
  Accepted --> Merged: explicit transition
~~~

Adopt 只授予明确 scope 的 canonical authority、source owner、allowed Operations、Acceptance 和 Verification obligations；不授予 Verification result、Effect execution 或整个文件/Provider 的 authority。

Block 可以声明多个 Responsibilities，但只有真实分发/信任/版本/迁移生命周期时才是 Entity；没有 Block 的 Contract/Responsibility 同样合法。

## 5. Identity 与 revision 域

| 域 | 表示 | 不得包含 |
|---|---|---|
| input revision | normalized authoring declarations | runtime attempt |
| physical/content revision | exact bytes/tree/config | semantic interpretation |
| source-program revision | exact physical snapshot 的语言模型 | business authority |
| semantic revision | canonical admitted graph | implementation selection |
| responsibility-candidate revision | 尚未 Adopt 的解释集合 | authoritative facets |
| implementation requirement revision | 语义派生的实现需求 | candidate choice |
| resolution decision revision | eligibility/policy 决策 | semantic identity |
| implementation binding revision | exact selected closure | compatibility decision |
| transaction identity | 一次 authorized execution | artifact identity |
| artifact revision | 生成结果 bytes/structure | execution PASS |
| Evidence revision | observation/proof record | semantic assertion authority |

时间戳、absolute path、UI 坐标、Map insertion order、process ID 与 attempt ID 不污染 semantic identity。

## 6. Authority、confidence 与 provenance

| Authority | 定义 | 可覆盖 authoritative? |
|---|---|---|
| authoritative | 用户/Contract/Policy/Adopt 等被授权声明 | 由冲突规则裁决，不能静默覆盖 |
| derived | canonical rule 从受信输入确定推导 | 否 |
| observed | exact source/runtime/environment 的直接观察 | 否 |
| inferred | 静态分析、AI、不完备机制的解释 | 否 |

Authority 是权力类别，不是概率。confidence 只描述允许不确定的 Assertion 自身；inferred confidence 为一仍不升格。多个 Provider 一致不构成多数票 authority。

Provenance 指向 Contract、Adopt decision、compiler rule、source span、runtime observation 或 Provider receipt。Evidence 的内容、expiry、bias、环境保留在 Evidence owner；IR 只引用 identity。

## 7. Assertion 生命周期

~~~mermaid
stateDiagram-v2
  [*] --> ActiveInSnapshot
  ActiveInSnapshot --> Retained: next snapshot rebuild agrees
  ActiveInSnapshot --> Removed: no longer active
  ActiveInSnapshot --> Recomputed: derived rule/input changed
  ActiveInSnapshot --> Reobserved: source/environment changed
  ActiveInSnapshot --> Conflicted: incompatible claim
~~~

Engineering IR 是当前 revision 的 active assertion set，不是历史 validity ledger。跨 revision lineage 只有在真实 consumer 需要时，由独立 durable owner 提供 schema、writer/reader、migration、retention 与 split/merge/replacement readback；普通 IR 不保留空历史字段或双读 grammar。

Provider/Binding 升级若保持 Semantic Contract，不重写 semantic Assertions；不能保持时进入 Semantic Migration。

## 8. Conflict 与 unknown

| 条件 | 结果 |
|---|---|
| 同一 Assertion identity 出现不兼容 payload/binding | hard conflict |
| authoritative assertions 对互斥命题 | 阻止相应 validated boundary |
| observed/inferred 与 authoritative 冲突 | 保留 competing assertions + diagnostic |
| owner/writer/effect/source candidate 竞争 | ambiguous/conflicted |
| inventory/coverage 不完备 | unknown frontier |
| identity/reference 无法唯一解析 | ambiguous |
| predicate/object shape 不支持 | admission reject |
| 明确完整 census 中未找到 | absent |

~~~text
Absent(x) = CompleteCoverage(requiredSpace) AND ObservedNotPresent(x)
otherwise = Unknown(x)
~~~

空 Provider 结果、类型检查成功或未发现 Fact 都不能自动证明能力、安全或行为。

## 9. Predicate registry

Predicate signature 唯一定义合法 subject kind、object kind 和 value schema；它不定义 Impact 方向、UI 边样式、implementation eligibility 或 runnable command。

一个 predicate 进入 active union 必须同时存在：

~~~text
active(predicate) =
  producer
  AND canonical signature
  AND semantic consumer
  AND Impact/Effect interpretation when applicable
~~~

无 consumer 的未来名称、reserved token、Vn 常量和测试字符串不建立 capability。旧 durable token 只属于 Change Management 的隔离 migration grammar。

典型关系包括 ownership、state access、dependency、implements、Effect、Permission、Verification、consumes、publishes 与 lowers-to；实际集合由 registry 生成，不在本文复制清单。

## 10. Canonicalization 与 validated boundary

~~~mermaid
flowchart LR
  R[Raw inputs] --> P[Parse]
  P --> N[Normalize]
  N --> I[Identity and reference checks]
  I --> S[Predicate signature checks]
  S --> C[Conflict and completeness checks]
  C --> D[Canonical order and digest]
  D --> F[Deep-frozen branded snapshot]
~~~

统一 validator 至少验证：

| 维度 | 验证 |
|---|---|
| binding | format、input、graph、application、snapshot |
| identity | Entity/Fact/Assertion/Responsibility IDs |
| references | subject/object/source/replacement 完整性 |
| signature | predicate 与 value shape |
| assertion | authority、confidence、provenance、Evidence refs |
| responsibility | facets、source binding、split/merge/replace |
| conflicts | duplicate/collision/incompatible assertions |
| projections | Scenario/cache 与 Facts 一致 |
| canonical | ordering、payload、semantic revision |
| immutability | clone 后递归 freeze |

IR-native consumer 只接受 branded Validated Snapshot，不能接受 caller index、raw graph、candidate 或结构相同对象。

Source admission 只消费 Source Program owner 对同一 exact snapshot 签发的 receipt，并绑定 provider、source revision、config/dependency generation、coverage/scope、Target 与 unknown frontier。任何 IR/Policy/Impact/Review/Projection/test 重读源码或自建 AST/import/call graph 都形成第二 source authority并使 admission unresolved。

## 11. Implementation、Effect 与 Verification 边界

~~~text
validated semantic Fact
!= implementation
!= Implementation Binding
!= Effect authorization
!= physical execution
!= Verification or support
~~~

| 下游 | 可消费 | 不得反向修改 |
|---|---|---|
| Implementation Resolution | Contract/Responsibility/Effect/Target requirements | semantic identity/Contract |
| Delta/Impact | validated endpoints/relations | endpoint Facts |
| Mutation planner | target semantic state | source ownership/authority |
| Verification | obligation references | Assertion authority |
| Agent/CLI | projections/stable refs | Eligibility/Binding/terminal |

某个 Provider 不满足合同只能淘汰候选；用户 pin/require 也不能绕过 Type、安全、Permission 或 Verification。Evidence 可成为新 observed Assertion 或下游 decision input，不能升级原 Assertion authority。

## 12. 无代码逻辑验证

| 场景 | 必须得到 | 必须拒绝 |
|---|---|---|
| 两个来源声明同一 triple | 一个 Fact、两个 Assertions | 综合事实/last-write |
| inferred 与 authoritative 冲突 | competing diagnostic | confidence 覆盖 authority |
| 文件移动但责任不变 | Address 变化、identity 保持 | path-derived 新责任 |
| 一个责任拆成两个 | 新 IDs + lineage/migration | 旧 ID 同时代表三者 |
| Provider 更换但合同不变 | semantic revision 稳定、Binding revision 变化 | 改写业务 Fact |
| source coverage 不完整且未找到调用 | unknown | absent |
| caller 构造 shape 相同 snapshot | origin gate 拒绝 | structural branding |
| UI 要新增边样式 | presentation projection | 修改 predicate semantics |
| 未来 predicate 无 consumer | obligation | active registry member |
| runtime PASS | Evidence input | semantic authority |

## 13. 完成条件

~~~text
SemanticModelClosed =
  one identity owner
  AND one predicate registry
  AND one validated boundary
  AND every Assertion has authority and provenance
  AND unknown is preserved
  AND Responsibility evolution is explicit
  AND implementation/effect/verification cannot write semantics backward
~~~
