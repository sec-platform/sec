---
title: 编译器与目标 IR
status: stable
domain: compiler-target-ir
---

# 编译器与目标 IR

## 1. 所有权

本文拥有从 validated Engineering semantics 到**用户目标工程** Target Program 与 deterministic artifact plans 的 pure compilation chain：Target Profile、Type Algebra、Application/Behavior IR、Implementation Resolution、Target Program IR、Backend。SEC 自身 logical responsibility 到 declaration/package/file/generated artifact 的实现架构、Change Locality 和 Intent-to-Code admission 由 `docs/implementation-architecture.md` 拥有；两者共享 semantic identity 与 Binding contract，但不能互相成为 facade 或第二 lowering owner。

~~~mermaid
flowchart LR
  E[Validated Engineering IR] --> A[Application IR]
  A --> B[Behavior IR]
  B --> R[Implementation Requirements]
  T[Target Profile and Type Algebra] --> R
  R --> C[Candidate closures]
  C --> EL[Hard eligibility]
  EL --> P[Resolution policy and tie-break]
  P --> D[Resolution Decision]
  D --> IB[Exact Implementation Binding]
  IB --> TP[Target Program IR]
  TP --> BE[Backend]
  BE --> PL[Artifact dependency verification plans]
~~~

Compiler authority 终止于 pure Target Program 和计划。filesystem、process、network、package manager、workspace writer、Verification execution、publication 与 recovery 属于外层 operation/capability owner。

## 2. Pipeline 合同

| Stage | Input | Output | 不得做 |
|---|---|---|---|
| Application lowering | validated semantic snapshot | target-neutral application | 重写 semantic facts |
| Behavior legalization | Application + governed behavior | bounded Behavior IR | 猜测 opaque runtime |
| Requirement derivation | Behavior + Target/Type | ImplementationRequirement | 选择 provider |
| Candidate discovery | bounded catalogs/existing refs | candidate closures | 扫 live Registry |
| Eligibility | requirements + candidates | typed eligibility | 软分抵消安全失败 |
| Resolution | eligible set + policy | Decision | 判 Compatibility |
| Binding | Decision + exact closure | frozen Binding | 安装依赖 |
| Target lowering | IR + Binding | Target Program | 重选实现 |
| Backend | Target Program | deterministic plans/bytes | 执行 Effect |

Compiler journal 只记录 pure scheduling 与外部 receipt refs。repair 发布新的 authoring revision 后，外层 coordinator 用新 input identity 启动新 compiler epoch。

## 3. Target Profile

Target Profile 是生成目标的 canonical capability input，与 SEC Host Runtime、Toolchain Provider、物理执行环境分离。

| Axis | Examples of semantics |
|---|---|
| language | language family/revision |
| runtime | runtime family/version range/capabilities |
| module/package | module system、package manager |
| delivery | package、container、artifact form |
| compute | thread/process/resource/network |
| persistence | storage/database/consistency |
| interface | server/UI/browser capability |
| verification | required environments/providers |
| deployment | platform/operations requirements |

未知字段、未知组合或缺失 capability 在 resolution/emit 前拒绝；不能回退到 current host、cwd、ambient executable、默认框架或已有模板。

## 4. Type Algebra

~~~mermaid
flowchart TD
  P[primitive nominal enum] --> C[optional list map record]
  C --> U[union result]
  U --> F[function async stream]
  F --> R[recursive graph]
  R --> N[normalize identity]
  N --> S[serialization and Target mapping]
~~~

Type Algebra 拥有跨层 type identity、normalization、nullability、collection/object/function shape、serialization 与 Target mapping。validated boundary 检查 reference、recursion/cycle、union discrimination、map key、ordering、unsupported 与 deep-freeze。Resolver/Adapter/Backend 不能按字符串名称重猜类型。

## 5. Application 与 Behavior

### Application IR

表达 target-neutral component/service/module、Responsibility、State、Operation、Data、Policy、Permission、Effect、Scenario 与 dependencies。

Promotion：

- upstream validated；
- 每个 node 可追溯到 canonical facts/assertions；
- owner、lifecycle、state writer、public boundary 唯一；
- unknown/opaque 不补全；
- identity 不含 Target、path、UI layout、runtime attempt。

### Behavior IR

只表达可完整验证和 lowering 的控制流、数据流、state transition、Effect、error、authorization 与 transaction。

| 可进入 Behavior IR | 进入 Extension/Opaque |
|---|---|
| typed input/output | dynamic reflection |
| enumerable Effects/Permissions | arbitrary external code |
| deterministic transition/error protocol | runtime code generation |
| target-independent oracle | unmodelled side effect |
| complete source mapping | incomplete semantics |

Governed Extension 声明 interface、Effect、capability、source owner、Verification obligations 与 rollback；不能为“支持一切”无限扩展 Behavior IR。

## 6. Implementation Resolution

Resolution 是唯一具体实现选择边界。它不拥有产品意图、Semantic Contract、Target physical support、Registry trust、package install、Binding Delta、Compatibility、Verification Result 或 publication。

### Canonical objects

| Object | Meaning | Identity boundary |
|---|---|---|
| ImplementationRequirement | 从 semantic/behavior/Target 派生的硬需求 | 不含 candidate |
| ImplementationConstraint | Target/security/license/resource 等不可抵消约束 | 不含 preference |
| ImplementationPreference | 合格候选间软排序 | 不能改变 eligibility |
| ResolutionPolicy | canonical optimization/tie-break policy | 真实 consumer 才 versioned |
| ImplementationCandidate | 完整实现 closure | 不是 package name |
| EligibilityResult | eligible/ineligible/unknown/unsupported/conflicted + witness | 不选择最终候选 |
| ResolutionDecision | candidate set、淘汰、policy、tie-break、choice | 不等于 Binding |
| ImplementationBinding | exact provider/package/integrity/config/adapter/target/dependencies | 不等于 semantic identity |

Requirement、Candidate、Decision、Binding 是不同 identity 域。枚举顺序、UI、Map/Set insertion、locale、time 与 ambient cache 不进入 identity。

### Candidate closure

Candidate 来源可以是 Reference、verified external Provider、repository Existing、Adopted Brownfield、Custom 或 AI/static candidate。完整 closure 至少绑定 version/integrity、Adapter、configuration、dependency/native/install/build、Target、Effect/Permission/resource、support、migration 与 Evidence。

### 决策顺序

~~~mermaid
flowchart TD
  C[Candidate set] --> H[Hard eligibility]
  H --> X{result}
  X -- ineligible --> O[Eliminate with witness]
  X -- unknown/conflicted --> U[Preserve frontier]
  X -- eligible --> P[Apply approved policy]
  P --> T{still tied?}
  T -- yes --> TB[Stable tie-break]
  T -- no --> D[Decision]
  TB --> D
  D --> B[Exact Binding]
~~~

合同、类型、Target、Effect/Permission、安全、数据、license、dependency、support 与 owner 是 hard constraints；performance、popularity、download、bundle size 或 code length 不能抵消。Benchmark 只有绑定 exact environment/version/sample/warm-cold/method 才参与对应 policy。

唯一最优只在 semantic/application/behavior revision、Target、repository stack、constraints、policy、eligible catalog/Evidence、measurements 与 Backend 全部冻结后成立。

## 7. Block、Provider 与任意类库

~~~mermaid
flowchart LR
  IR[Implementation Resolver] --> N[Native Reference Existing Custom]
  IR --> Q[Bounded Block capability request]
  Q --> BR[Block Resolver]
  BR --> BB[BlockProviderBinding or typed failure]
  BB --> IR
  N --> EL[Unified eligibility]
  IR --> EL
~~~

Block Resolver 只拥有 Registry trust、version、manifest/resource closure 与 BlockProviderBinding；不理解业务语义或最终候选比较。Implementation Resolver 不读 live Registry 或重新选择 Block。没有 block-delivered requirement 时 Block Resolver 调用与 manifest/resource/trust observation 均为零。

无Adapter时，Source Program可提供typed export/call-shape/source-binding；用户连接参数/返回值后可生成type-correct invocation。`provider-maturity.typed-invocation`不证明Effect、idempotency、retry、timeout、cancellation、security或runtime behavior；这些经declaration、conformance与physical Evidence才可提升Provider maturity。

## 8. Invalidation 与 cache

| 变化 | Decision/Binding |
|---|---|
| semantic/Application/Behavior/Target/Type revision | invalid |
| constraint/preference/policy | invalid |
| Provider/package/Adapter/catalog/integrity/license/security/support | invalid |
| dependency/lock/config/existing-stack | invalid |
| benchmark environment/method/expiry | invalid |
| Verification/conformance freshness | invalid |
| Backend/printer/source policy | invalid |
| owner/migration state | invalid |

失效后 clean recompute；不能沿用旧 Binding 或换“最像”Provider。Cache 可删除，不是 decision authority。

## 9. Target Program IR

Target Program 表达 package/module、import/export、declaration、type、statement、expression、annotation、resource/config binding 与 artifact ownership。

Promotion 必须：

- Application/Behavior、Target/Type 与 exact Binding 全部 validated；
- implementation-dependent node 引用 exact Binding；
- unresolved/unknown/conflicted resolution 在 promotion 前拒绝；
- module/artifact owner、symbol identity 唯一；
- source map/provenance、canonical order/revision 完整；
- Opaque/Extension 已由上游显式冻结，emit 不临时创造。

Target Program 不观察 live Provider/Registry/package catalog，不重读 raw Contract，也不按业务/库名补语义。

## 10. Backend 与 canonical source

Backend 拥有 Target AST、printer、pure formatter、package/config/artifact/dependency/verification plans 与 canonical bytes。它不执行 typecheck/install/write；外部 owner 返回 typed receipt。

~~~text
Bytes = Compile(
  validated Target Program,
  exact Binding closure,
  Target Profile,
  Backend identity,
  canonical source policy
)
~~~

locale、timezone、cwd、temp path、host family、wall-clock 与 collection insertion order 不污染 bytes。Formatter 不能改变 semantics；diagnostic 映射回 Target Program、Binding 与 upstream semantic source。

## 11. Deterministic 与 incremental

每层遵循：

~~~text
raw builder → strict validator → branded snapshot
→ deterministic lowerer/resolver → provenance map
~~~

Incremental key 只包含真实 content、validated revision、pass/options、Target、Requirement/Candidate/Policy/Decision、Binding closure 与 Backend。incremental 路径经过同一 validators/eligibility/policy/tie-break/fixpoint/source mapping；结果与 clean byte-equivalent。unknown/read failure/revision drift 只扩大 invalidation。

## 12. 单写者迁移

同一 implementation scope 只有一个 Resolution/Binding owner；同一 Artifact 只有一个 writer。Legacy Generator/Resolver 与新 path 只能 shadow compare，不能长期 dual write。切换顺序：

~~~mermaid
flowchart LR
  O[Old owner] --> S[Read-only shadow]
  S --> P[Decision Binding byte runtime parity]
  P --> C[Consumer cutover]
  C --> R[Old owner dependency path test retirement]
~~~

Binding change 由 Delta/Impact 生成，Compatibility/Migration 由 Change Management 决定。

## 13. 无代码逻辑验证

| 场景 | 必须结果 | 禁止 |
|---|---|---|
| prefer 指向 ineligible candidate | 回退其他 eligible | preference 抵消 hard failure |
| require/pin 指向 ineligible | blocked | 自动替代 |
| candidate discovery 顺序变化 | Decision/Binding 不变 | first wins |
| Provider API相同但integrity变化 | Binding invalidated | cache reuse |
| 无 block requirement | zero Block resolution | 普遍 Block identity |
| no Adapter typed call | type-correct + behavior unknown | 自动 Provider support |
| Target Program发现unknown | promotion reject | emit placeholder |
| Backend想改 Provider | reject boundary violation | 重选实现 |
| repair产生新authoring revision | new compiler epoch | journal内回跳 |
| incremental cache损坏 | clean recompute | stale output |
| two writers produce same artifact | migration required | merge outputs |

## 14. 完成条件

~~~text
CompilerClosed =
  pure acyclic stage graph
  AND one owner per IR/Decision/Binding/Artifact
  AND hard eligibility precedes policy
  AND unknown is preserved
  AND Target Program consumes exact Binding
  AND Backend performs no Effect or re-resolution
  AND clean equals incremental
  AND provider/block/legacy paths have zero competing owner
  AND physical execution is settled by external capability owners
~~~
