---
title: Semantic / Implementation Delta 与 Impact
status: stable
domain: delta-and-impact
---

# Semantic / Implementation Delta 与 Impact

## 1. 所有权

本文拥有 canonical change、Impact propagation、certainty、unknown frontier 与 Verification recommendation reference。它不拥有 Semantic Contract、Implementation Resolution、Compatibility/Migration、测试命令、Verification Result、Release 或 Support。

Pure in-process output 与 durable/public receipt 是不同 capability；只有真实跨进程/持久/外部 consumer 才增加 schema、parser、provenance、readback 与 migration。

## 2. 变化对象

~~~mermaid
flowchart TD
  AU[Authoring Delta] --> FD[Fact Delta]
  AU --> BD[Implementation Binding Delta]
  FD --> SI[Semantic Impact]
  BD --> II[Implementation Impact]
  SI --> VI[Verification recommendations]
  II --> VI
  SI --> CM[Change Management]
  II --> CM
  CM --> CD[Compatibility Decision]
  CM --> M[Migration]
  SI --> AD[Artifact Delta]
  II --> AD
  AD --> RO[Runtime Observation Delta]
  RO --> VR[Verification Result]
~~~

| 对象 | 比较/表达 | 不等于 |
|---|---|---|
| Authoring Delta | Contract/Plan/Manifest/Policy/source bytes/input constraints | canonical semantic change |
| Fact Delta | Entity/Fact/Assertion active sets | changed files |
| Binding Delta | exact implementation closure sets | semver change |
| Semantic Impact | semantic consumers/Acceptance 的保守传播 | runtime result |
| Implementation Impact | artifact/dependency/runtime/release/support 传播 | compatibility |
| Repository/Test Impact | physical/import/test owner closure | semantic authority |
| Artifact Delta | generated/config/package/release bytes | accepted intent |
| Runtime Observation Delta | exact environment observation | universal behavior |
| Verification Result | exact requirement 是否满足 | Delta |
| Compatibility Decision | Change owner 的裁决 | comparator output |

这些对象用 stable references 连接，不能改名复用。

## 3. Endpoint 与 Delta identity

~~~text
DeltaIdentity =
  endpointScope
  + fromValidatedRevision
  + toValidatedRevision
  + comparatorContract
  + canonicalPayloadDigest
~~~

| 必须绑定 | 必须排除 |
|---|---|
| from→to direction | branch、PR、wall-clock |
| graph/app/scope lineage | UI、Map/Set insertion order |
| endpoint format/revision | ambient cache |
| comparator identity | candidate discovery order |
| canonical delta payload | display name/path similarity |

两端 lineage、format、app/scope 或 Target comparison boundary 无法证明时返回 typed unsupported/unresolved，不生成空 Delta。

## 4. Fact / Assertion change algebra

| Endpoint 变化 | Canonical change |
|---|---|
| 新 triple | Fact added |
| triple 消失 | Fact removed |
| subject/predicate/object 改变 | old removed + new added |
| 新 source/authority/provenance claim | Assertion added |
| active claim 消失 | Assertion removed |
| 同一 Assertion 允许字段改变 | Assertion updated |
| canonical payload 相同 | retained |

Fact identity 不含 authority、confidence、provenance；Entity-only 变化允许 Fact Delta 为空。空 Fact Delta 只证明 Fact/Assertion sets 未变，不证明 Binding、Artifact、Repository、performance 或 runtime 未变。

## 5. ImplementationBindingDelta

Binding Delta 只比较同一 implementation scope 的 validated Binding sets，不重新运行 Resolver 或修改 Binding。

### 激活时必须覆盖的维度

| 维度 | 变化 |
|---|---|
| existence | added、removed、retained |
| provider | Provider/reference/existing/custom identity |
| package | version、integrity、Adapter、configuration |
| target | Target Profile、Block-delivery binding |
| closure | dependency/peer/native/install/build |
| authority | Effect、Permission、resource、support references |
| provenance | source/artifact owner、Decision、conformance/Evidence |
| uncertainty | ambiguous match、coverage gap、endpoint conflict |

这些是语义维度，不预先要求一个巨型字段 union。首个真实 producer/consumer 从 validated endpoint 派生最小 canonical shape，但不能丢失上述可观察差异。

## 6. Comparator 合同

所有 Delta producer 必须：

| 要求 | 拒绝 |
|---|---|
| 只接受 validated/deep-frozen endpoints | raw/caller-built endpoint |
| 保持 from→to | 无方向 diff |
| 不 repair/renormalize 输入 | comparator 内修改状态 |
| stable identity 比较集合 | 名称、semver、API 相似度配对 |
| canonical sorted unique 输出 | insertion-order 结果 |
| 保留 endpoint/transaction provenance | detached summary |
| unsupported/collision/duplicate fail closed | 空 Delta |
| 不判 compatibility | 测试绿或版本号即兼容 |

Mutation request、AI proposal、Review、Resolver、interface 与 test selector 只能声明 expectation 或消费 canonical Delta，不能提交 actual Delta。

## 7. Expected 与 Actual

~~~mermaid
flowchart LR
  P[Plan expectation] --> IT[Isolated transform]
  IT --> RB[Canonical rebuild and re-resolution]
  RB --> AD[Actual Fact and Binding Delta]
  AD --> C{Compare with expectation}
  C --> OK[exact or allowed additional]
  C --> BL[missing forbidden unexplained stale]
~~~

| 判定 | Publication |
|---|---|
| required change 出现 | 可继续 |
| required change 缺失 | block |
| forbidden change 出现 | block |
| additional 在显式 allowance | 可继续 |
| unexplained semantic/Binding change | block |
| lineage/mapping/scope stale | block |

apply 后必须重算 actual；不能沿用 predicted，也不能因文本 diff 小、package 版本合理或测试通过忽略额外变化。

## 8. Impact

~~~text
Impact = fixpoint(
  Delta seeds,
  validated relation graph,
  canonical rule set,
  scope and budget,
  uncertainty lattice
)
~~~

输出：

| 输出族 | 内容 |
|---|---|
| occurrence | seed、direct/transitive impacted subject |
| surfaces | Responsibility、Operation、Scenario、Acceptance、Requirement、Artifact、runtime、release、support |
| certainty | definite、possible、unknown |
| witness | canonical path 与 rule refs |
| frontier | missing rule/reference/coverage/provider freshness/conflict/budget |
| recommendations | owner-issued Verification references |
| binding | endpoints、graph、rules、producer generation、completeness |

Impact 是保守静态推导，不是 Compatibility、Migration、business risk 或 execution result。

## 9. Propagation rule registry

~~~mermaid
flowchart LR
  PS[Predicate signature] --> F[Valid relation shape]
  BR[Binding schema] --> BF[Valid binding facet]
  RR[Rule registry] --> P[Direction condition certainty stop]
  F --> P
  BF --> P
  P --> I[Impact fixpoint]
~~~

每个 active rule 的 identity 由 predicate/facet、direction、condition、certainty transform、boundary 与 producer generation 派生。Signature 只定义 shape，不拥有传播方向；UI edge、source call、semantic dependency 与 implementation dependency 方向不可互相猜测。

一个 rule 至少声明 change kinds、endpoint side、traversal direction、kind conditions、certainty transform、stop boundary、Verification mapping 或明确无 mapping、cycle/negative proof。

未注册 relation、unsupported object、missing reference、rule conflict 或 budget cutoff 都形成 unknown frontier。

## 10. Addition、Removal、Replacement

| Change | 主要 endpoint | 原因 |
|---|---|---|
| addition | to | 新依赖/行为只在新图 |
| removal | from | 发现失去的 consumer/guarantee |
| assertion update | from/to/both | 由 authority 与语义决定 |
| Binding replacement | both | 旧 retirement + 新 requirement/effect |
| Entity/Provider replacement | explicit relation | 不按同名拼接 |

同一 change 可有多个 occurrences，但 canonical item 按 identity 去重。

## 11. Certainty 与 complete

| Certainty | 条件 |
|---|---|
| definite | authoritative/derived relation + validated Binding + deterministic rule |
| possible | observed/inferred/optional/dynamic/candidate 或 coverage 不完备 |
| unknown | 缺 rule/reference/coverage/freshness、endpoint conflict 或预算耗尽 |

多个 possible 路径不能多数票升级；definite 前缀遇 unknown boundary 后只保留前缀 definite。Risk、severity、priority、compatibility 与 cost 不进入 certainty。

~~~text
CompleteImpact =
  frontier.empty
  AND all active relations covered
  AND fixpoint reached
  AND budget not exhausted
~~~

没有 recommendation 只有在 CompleteImpact 且相关 rules 明确无 Verification requirement 时，才能支持 not-run。

## 12. Cycle、fixpoint 与预算

图允许 cycle。算法必须使用 finite identity set 与 monotone lattice：

- visited state 收敛；
- 同一 occurrence 选择稳定 canonical witness；
- 多路径可引用，不复制 item；
- 非单调 rule 或无限新 identity 拒绝；
- cutoff/timeout/entry limit 产生 unknown，不返回 complete；
- clean 与 incremental 结果 canonical 等价。

## 13. Cross-domain Impact

~~~mermaid
flowchart TD
  I[Semantic or Binding Impact] --> SO[Source and artifact owner]
  I --> DP[Dependency materialization]
  I --> DOC[Documentation projection]
  I --> WF[Workflow and Gate applicability]
  I --> AO[Agent Operation]
  I --> REL[Release deployment support]
  I --> EV[Evidence freshness]
  I --> CM[Compatibility and Migration]
~~~

跨域 adapter 由目标 domain owner 拥有。Delta/Impact 不扫描 changed files 建第二 Repository graph；Repository/Test Impact 不推断 semantic authority、Binding 或 Compatibility。

## 14. Predicted、Actual、Runtime

| 层 | 来源 | 用途 |
|---|---|---|
| predicted impact | plan + candidate Binding + current graph | preview、Verification planning |
| actual Delta | rebuilt/re-resolved validated endpoints | publication comparison |
| actual impact | actual Delta + canonical rules | final affected closure |
| artifact/runtime impact | physical outputs/Acceptance | environment truth |
| residual impact | unresolved/unsupported/risk | block/support decision |

predicted omission、unexpected actual change、planned/actual Binding divergence 或 runtime counterexample 必须更新 rule/owner/coverage，使依赖旧前提的 Evidence stale。

## 15. Cache 与 identity 分域

~~~text
ImpactCacheKey =
  endpoint revisions
  + Delta identity
  + graph/rule digest
  + producer generation
  + scope/coverage/frontier policy
~~~

Cache/memo 是可丢弃 projection，不签发 Delta、Impact、Verification 或 completion。损坏/foreign/stale cache 回到 clean compute 或 typed reject。Impact 提供 revision/reference 给 Verification owner 构建 ActionKey；不得反向依赖 ActionKey。

| Identity | owner |
|---|---|
| endpoint revision | semantic/binding owner |
| Delta digest | comparator owner |
| Impact digest | propagation owner |
| cache key | derived projection |
| ActionKey | Verification owner |

## 16. Verification recommendation

Recommendation 只能转发 owner-issued Acceptance/Requirement/Claim/Gate reference，并保存 change→rule→consumer witness。Impact 不解释 raw selector、不拥有 test path、suite、argv、execution result 或 merge decision。

## 17. 无代码逻辑验证

| 场景 | 必须结果 | 禁止 |
|---|---|---|
| same semver、different integrity | Binding change | 仅版本相同即 retained |
| changed files、semantic endpoint相同 | Repository Impact，Fact Delta可空 | changed file冒充 Fact |
| Provider API相同但credential/effect变化 | Binding Impact | 生成源码没变即无影响 |
| removal | 从旧图传播 | 只在新图找 consumer |
| cycle | finite fixpoint | 无限 witness |
| budget耗尽 | unknown frontier | complete |
| test PASS | Evidence input | compatibility |
| predicted与actual不同 | block + rule/plan invalidation | UI warning后发布 |
| recommendation字符串伪造 | origin reject | 直接执行 |
| cache命中但rule digest变 | invalidated | 复用旧 Impact |

## 18. 激活与完成

~~~text
DeltaImpactClosed =
  exact validated endpoints
  AND one comparator per Delta kind
  AND one propagation registry
  AND canonical identity and ordering
  AND unknown/collision/budget fail closed
  AND predicted != actual
  AND compatibility remains external
  AND clean = incremental
  AND real consumers and negative/property proof exist
~~~

任一缺失只能产生 unresolved admission；类型名、schema 字面、byte stability 或局部测试不能单独激活公共能力。
