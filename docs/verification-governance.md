---
title: Verification、Evidence 与 CI 治理
status: stable
domain: verification-governance
last-reviewed: 2026-08-06
---

# Verification、Evidence 与 CI 治理

本文拥有不同验证层证明什么、Requirement/Gate/Result/Claim/Aggregate/Evidence的稳定身份边界、Implementation conformance、Impact选择、失败复用、trusted bootstrap和merge authority。具体测试文件、suite、command、timeout、并发、selector、当前schema revision和physical Gate结果由机器合同、runner、workflow和最新 `main` 拥有。

Verification可以为Implementation Resolution、Binding Delta、Compatibility和Migration提供Evidence，但不拥有Resolver、Delta comparator或Compatibility evaluator。

## 当前合同与后继平台

必须区分两层：

### Verification Truth Kernel

统一合同族使用：

```text
passed | failed | not-run | unsupported | invalidated
```

并独立表达：

- executed / reused / not-executed；
- applicable / not-applicable / unsupported / unresolved；
- Gate identity、Claim definition、owning environment和proof identity；
- order-independent aggregate；
- exact input/revision/environment/artifact/command/cleanup binding；
- duplicate、missing、unknown、stale和self-proof fail closed。

该语义是当前canonical contract方向。某个writer、adapter、artifact或CI consumer是否已经完整迁移，仍必须从最新代码和Evidence验证；稳定文档不把局部实现扩大成全系统完成。

### 后继 Verification Platform

以下能力只有对应contract、producer、consumer、migration、tests和Work Package进入 `main` 后才是现实能力：

- 完整Execution Ledger；
- Evidence DAG/CAS；
- Development Run Journal；
- 统一Hermetic Runtime和resource allocator；
- 自动persistent reuse/resume/flake governance；
- 跨Host/Target/Implementation/Release的完整Observation catalog；
- 机器化Review finding/merge decision平台。

目标设计被接受不等于实现完成。CLI、PR summary、文档或Skill不得把未来状态名投影成当前PASS。

## 验证对象与层级

- **Requirement / Claim**：要证明的exact性质、owner、subject、inputs和applicability；
- **Gate Definition**：如何在声明环境和capability下观察或执行该Requirement；
- **Observation / Execution**：一次physical执行、合法reuse或明确not-executed事实；
- **Result**：该Observation的五态结果、reason、cleanup和artifacts；
- **Aggregate**：按Claim、owning environment和proof identity组合多个Results；
- **Decision**：Mutation、Implementation Resolution、Compatibility、merge、release、support等上层consumer对Aggregate和其他事实作出的决定；
- **Evidence**：支撑Result/Claim/Decision的exact记录。

一个绿色命令不是完整Verification对象；一个Aggregate PASS也不能自动证明Implementation eligibility、Binding Delta、Compatibility、packaged/deployed或product-supported。

## 测试层

- **Unit**：pure builder、selector、resolver、comparator、index、normalizer、formatter和安全边界；
- **Contract**：公共schema、CLI、package、CI、error、IR、Requirement/Candidate/Decision/Binding/Delta和inter-owner shape；
- **Integration**：Workspace pipeline、Implementation Resolution、Binding Delta/Impact、artifact flow、transaction和跨owner集成；
- **E2E / slow**：真实Git、filesystem durability、server、browser、native host、package、Provider和发布路径；
- **Property / Model**：输入空间、幂等、round-trip、状态机、fixed-point、排序、tie-break、Delta direction和反特化；
- **Fault / Recovery**：crash/persistence boundary、TOCTOU、cache invalidation、rollback/recovery和资源收口；
- **Mutation / Test-quality**：校准关键validator、authorization、eligibility、Delta/Impact fail-closed和selector是否真正被断言覆盖。

测试层由要证明的性质、真实副作用、状态冲突、资源和环境决定，不由目录名、一次duration或“看起来像集成”决定。

真实browser/server/native/durable acceptance即使偶尔很快仍属于physical layer；反之，位于acceptance目录但不请求browser capability的contract test不应被迫启动无关browser。Gate definition和fixture实际需求共同决定capability。

## 不可违反的不变量

- 未运行、缺失、skipped、超时、取消、平台不匹配、scope mismatch、stale、损坏或candidate self-proof都不是PASS。
- `not-applicable`必须有可信applicability proof；它不等于required但没有执行。
- zero-test/empty selection只有在Target/Gate contract证明不适用时才能not-run；否则invalidated/unresolved，不能passed。
- executed/reused result只有在Claim owning environment满足时才能支持该Claim。
- Aggregate状态与Claim输入顺序无关；duplicate/missing/unknown identity fail closed。
- 一项Check只证明它绑定的exact candidate、Binding、Delta/Compatibility subject、profile、environment和input closure。
- 测试主体通过但cleanup/readback/receipt失败，整个Gate仍未通过。
- changed path、owner、required Gate、ImplementationBinding、Delta或Evidence unresolved时fail closed。
- 失败不能通过删除测试、弱化assertion、无边界增加timeout、重复运行直到绿、自动换Provider或把unsupported当skipped消除。
- Provider manifest、类型声明、文档、下载量、单次示例和AI生成测试都不是conformance PASS。
- verifier、selector、Resolver、Delta comparator、Compatibility evaluator、Evidence validator或merge authority的candidate不能只用自身新实现授权自身。
- CI workflow是executor/adapter，不拥有第二套Gate定义、result truth、Eligibility、Delta、Compatibility或test inventory。
- Local cache、聊天、PR body、branch、commit ancestry和人工checkbox不是merge或Implementation Evidence。

## Result 与 Claim 真值

### 五态

- **passed**：required execution或合法reuse对exact input closure证明成立；
- **failed**：已执行但断言、运行、cleanup或Evidence完整性不满足；
- **not-run**：可信applicability/Impact证明无需执行，或尚未执行但如实保留；
- **unsupported**：执行环境/Provider缺少声明能力；是否阻断由上层Requirement/Implementation/Compatibility/Support contract决定；
- **invalidated**：过去结果或当前selection因输入、环境、规则、coverage、identity、Binding、Delta subject或信任变化而失效。

状态和execution disposition正交。`not-run`可以是not-executed，`passed`可以来自合法reuse；但reuse必须保留原execution/environment/input Evidence并满足当前invalidation rules。

### Claim definition

Claim至少绑定：

- claim identity/revision和owner；
- subject/requirement/input digest；
- required/optional Gates；
- owning environment集合或matcher；
- applicability与not-applicable proof；
- invalidation rules；
- supported/required contribution semantics。

Gate的passed状态不能越过Claim environment、identity或applicability。Non-owning observation可以保留为Evidence，但不能poison或支持owning Claim。

### Aggregate

Aggregate固定使用声明的status lattice和deterministic reason selection。Order、Map insertion、duplicate overwrite和first-non-pass都不能改变结果。

Empty Claims、empty required Gates、zero physical observations、cleared supportedClaims、mixed proof identity或unknown contribution默认不能passed。

Aggregate只计算Verification truth，不拥有Mutation terminal、Implementation Resolution、Binding Delta、Compatibility、merge、release或Support decision。

## Gate identity 与 Execution Ledger

Gate definition和一次运行实例分离：

- **Gate contract**：identity、revision、owner、applicability、inputs、capabilities、dependencies、command/runner、timeout policy、Evidence output和invalidation rules；
- **Execution record**：exact candidate/input/Binding/Delta-subject revisions、runtime/OS/arch/filesystem、toolchain/provider/dependency authority、环境、开始/结束/cleanup、result、artifacts和receipt。

一次执行的唯一key只包含会改变证明语义的input closure；branch名、PR编号、聊天、显示标题和wall-clock不能成为语义key。

在完整Execution Ledger实现前，当前writer/artifact/CI evidence继续作为迁移中的唯一实际authority。新Ledger必须逐producer和consumer迁移，不能长期双写两个结果源或用未来schema包装旧不完整Evidence。

## Implementation Conformance 与 Resolution Evidence

Implementation Resolution可以消费Verification Evidence，但不能自己制造或改写Result。至少区分：

```text
Provider declaration
→ Conformance Requirement
→ physical Gate / Observation
→ Verification Result / Aggregate
→ Eligibility input
→ Resolution Decision
```

### Conformance Claim

一个Provider/Adapter/Reference/Custom candidate的conformance Claim至少绑定：

- exact Provider/package/version/integrity/Adapter/config revision；
- Semantic Contract/capability subset和Type Algebra references；
- Target/Host/Toolchain/Runtime owning environments；
- input/output/error/cancellation/timeout/retry/idempotency/serialization semantics；
- Effect、Permission、resource、network、process、filesystem、secret和telemetry边界；
- dependency/peer/native/install/build closure；
- positive、negative、boundary、failure和cleanup cases；
- coverage、unsupported/opaque和invalidation rules。

通过一个API示例、typecheck、unit test或单一happy path不能支持完整conformance Claim。

### Eligibility 与 Verification 的边界

- Verification owner只回答exact Claim在exact环境下的五态Result/Aggregate；
- External Provider policy决定Evidence是否足以注册正式candidate；
- Compiler Implementation Resolution把Result、Support、Target和Policy作为hard eligibility/optimization输入；
- Resolver不能把`not-run`、`unsupported`、`unknown`或stale Evidence解释为eligible；
- Result passed也不自动选择candidate，不能越过用户/组织constraints或其他hard conditions；
- candidate未被选择不使其conformance Result失效；Binding或环境变化则必须按invalidation rule失效。

### Benchmark Evidence

性能、内存、bundle、启动、构建、延迟或成本只有绑定：

```text
candidate / Binding revision
Target / Host / Toolchain / hardware
workload / dataset / corpus
warm-cold / cache / concurrency mode
sample count / distribution / outlier policy
measurement tool / method / uncertainty
expiry / invalidation
```

后才能参与`performance`等ResolutionPolicy。单次wall-clock、作者benchmark、不同机器对比或只选有利样本不能成为排名truth。

### Reference 与第三方 parity

Reference Provider和第三方Provider宣称满足同一Contract时，必须消费同一Target-independent conformance suite，再分别执行Target physical acceptance。Reference实现是oracle/fallback候选，不因由SEC维护而自动更可信；第三方实现也不因生态成熟而免除负向和供应链验证。

## Binding Delta 与 Compatibility Evidence

Verification不比较old/new Binding，也不签发Compatibility。固定关系是：

```text
validated old/new Binding
→ Delta/Impact owner produces ImplementationBindingDelta and Impact
→ Verification executes required conformance / behavior / package / runtime Claims
→ Change Management consumes Delta + Impact + Results
→ Compatibility Decision / Migration
```

Verification Claim可以绑定old Binding、new Binding或exact Delta item，证明：

- old/new Contract conformance；
- Adapter是否恢复旧timeout/retry/error/serialization/Effect语义；
- Target、dependency、native、install/build和package surface；
- consumer/runtime/behavior parity或明确差异；
- migration/rollback/compensation前置条件。

但Verification Result只证明该Claim，不得：

- 重新生成或修改`ImplementationBindingDelta`；
- 把测试绿解释为Delta为空或Behavior兼容；
- 把未运行/unsupported/partial结果解释为Compatibility；
- 选择Provider、Adapter或Migration路线；
- 用new implementation的自带tests单独授权自身Compatibility。

## Impact、Applicability 与选择

选择最小充分Verification的输入包括：

- canonical Entity/Fact/Responsibility、public contract和state writer；
- Source Program Model coverage和opaque/unknown frontier；
- Implementation Requirement、Candidate、Decision、Binding、`ImplementationBindingDelta`和Implementation Impact；
- Compatibility Decision/Migration obligations（已存在时）；
- Generator/Artifact和source ownership；
- Target Profile、Type/Behavior/Program IR和Backend；
- Host/Toolchain/Provider/platform capability；
- configuration/resource、Gate/test和release surface；
- Documentation/Agent/Workflow trust root；
- Support obligations。

已证明无影响的Gate可以合法not-run；可信key未变化且invalidation条件未触发的result可以reused；存在影响时运行最小充分闭包；unknown/unresolved阻止成功。

Semantic Impact、Implementation impact、repository/test impact、physical platform applicability、Compatibility和release impact是不同producer。它们可以组合，但不能互相冒充。

Full/Release是selector校准backstop。若Full发现affected漏选，缺陷属于relation/ownership/selector：必须登记漏边、补permanent regression并失效依赖旧selector的Evidence，而不是只把漏掉的测试永久塞进Full。

## Candidate、Epoch 与 Failure

```text
Authoring → Candidate → Frozen → Published/Merged → Readback
```

只有Frozen candidate和冻结Binding可以签发最终Evidence。任何source/base/head/tree/manifest/profile、Requirement/Candidate catalog/ResolutionPolicy/Binding/BindingDelta subject、required Gate、Claim definition或trust input变化都会产生新epoch或使旧Evidence invalidated。

Failure record至少包含：code、phase、Gate、owner、invariant、exact input、minimal reproduction、failure fingerprint、invalidated Evidence、cleanup state、next action和retry policy。

输入与failure fingerprint未变化时复用失败并停止；重复运行同一确定性失败不是进展。Transient retry必须绑定可观察因果变化，例如锁owner退出、网络/外部服务恢复、cache按authority重建或runner incident结束。

重复同类frozen invalidation要求proof reset，回到reproduction、owner、contract、fixture、Resolver、Delta comparator、Compatibility evaluator或test architecture；再次出现说明需要redesign，不能继续补丁循环。

## Hermetic Runtime

每个physical Gate的资源生命周期目标为：

```text
prepare → allocate → execute → terminate
→ cleanup → readback → receipt
```

资源先分类：immutable-copyable、rebuildable、identity-bound、process-bound、non-copyable-control-state、external-capability或unknown。Unknown默认拒绝复制、共享或并行。

Workspace、`.sec`子域、temp/cache、port、process group/Job Object、browser、database、environment、network、logs和residue都有唯一owner。复制workspace时identity-bound lease/journal/control state不能当普通目录复制；rebuildable cache也不能被发布成Evidence。

执行不受信Provider/package/install/build/test/runtime代码时，需要独立credential-free sandbox、bounded filesystem/network/process/resource和cleanup Evidence。普通临时目录、Node VM、browser context或静态lint不构成恶意代码sandbox。

Hermetic Runtime、resource allocator和cleanup receipt需要独立真实consumer驱动。现有测试有隔离行为不代表统一runtime已完成。

## 反馈与 Gate 层级

```text
focused failing sentinel
→ affected local closure
→ candidate pre-freeze
→ frozen hosted Quick / selected Risk
→ virtual merge / Release Full backstop
```

这不是每次都全跑的固定流水。普通编辑循环只运行会被后续修改自然失效的focused proof；browser、native、durable、package、Provider conformance和release Gate等candidate稳定后由selector运行一次。

不同变化类型使用最小充分门禁：pure validator、docs owner、trust root、Resolver、Delta/Impact、Compatibility、Provider、runtime/package和formatter的Evidence要求不同。统一重门禁会拖慢开发且不增加证明；统一轻门禁会假绿。

性能目标与正确性Gate分离。单次wall-clock只提供诊断；结构性工作量、固定环境的多样本基线和可重复回归才可形成性能裁决。

## Evidence DAG 与 Run State

Evidence可以形成DAG：node引用inputs、Requirement/Gate contract、environment、producer、Result、artifacts和predecessors。相同未失效node可复用；failure node可复用为诊断但不能变PASS；组合旧baseline Evidence必须同时证明intervening diff coverage和delta validation。

Development Run State记录run/capsule/event/transition/resume；Verification Evidence记录proof。二者必须通过typed references连接，不能把Run Journal变成第二Verification Result，也不能把Evidence文件当作当前执行状态。

这些平台未完整实现时，分散日志、计划文档和聊天摘要不能被称为统一Ledger。

## Trusted Bootstrap

Verifier、selector、Resolver、Delta comparator、Compatibility evaluator、docs-doctor、Skill/Agent contract、Evidence validator、workflow和merge gate等trust-root candidate不能用自身新增规则自证。

Trusted base-side runner把candidate Git tree当不可信输入，在无凭据、只读source、独立writable root中运行旧authority下的回归和adversarial vectors。Bootstrap Evidence绑定trusted verifier revision、candidate tree、runner image、lock/dependency、platform、plan、output/cleanup digest。

Candidate自带测试只能作为补充，不能授予自身合并权或把自己的Resolution、Delta、Compatibility结果标为正确。Trust migration成功后必须从新main重新加载trust root；旧会话/Review/Evidence不能继续授权新epoch。

## Property、Fault 与 Flake

- Pure property优先覆盖identity/revision/normalization/serialization、Fact/Binding Delta、Impact、Requirement/Candidate/Decision/Binding、Compatibility rule、state machine、fixed-point、deterministic ordering、tie-break和clean/incremental parity；
- Property失败要shrink并保存最小反例、seed、producer revision和replay入口；
- Physical fault遍历prepare/write/fsync/publication/terminal/cleanup/recovery等持久化边界；
- Windows、Linux、macOS、WSL和不同filesystem capability的Evidence不互相替代；
- Retry只收集flake Evidence；多次中一次绿不能改写失败；
- Quarantine必须有owner、expiry、替代coverage和退出条件；
- Mutation testing只用于高价值pure kernel/validator/authorization/eligibility/delta/compatibility/fail-closed/selector校准，不进入普通save loop。

## Evidence 与 Provenance

- Artifact Provenance：文件或产物从哪里来；
- Fact Provenance：semantic assertion为什么成立；
- Verification Evidence：某个exact execution证明了什么；
- Runtime Observation：某个环境实际发生了什么；
- Provider/AI Evidence：带coverage、freshness和不确定性的候选解释；
- Resolution Evidence：Requirement、candidate、Eligibility、policy、measurement和淘汰原因的引用；
- Delta references：old/new endpoint、Comparator revision、Delta item和Impact witness；
- Compatibility Decision Evidence：规则、Delta、Result、环境与用户decision references。

Predicted Impact、planned selection、Eligibility、Resolution Decision、actual Delta、Compatibility Decision、executed Result、Aggregate和上层Decision是不同对象。它们之间必须有显式references，不能复制字段后当作同一事实。

## Merge Authority

Merge前由独立owner重新计算：current base/head/tree/manifest/profile、changed scope、required Claims/Evidence、Review、unresolved threads、REQUEST_CHANGES、ruleset、dependency、Binding、Delta/Compatibility requirements和default-branch组合。

所有门禁闭合时及时合并，不为表现“仍在开发”继续修改正确candidate。

Merge后必须从新 `main` 读取实际类型、行为、Decision/Binding、Delta/Compatibility、artifacts和支持面，关闭absorbed/superseded结构，归档Work Package，并完成可证明安全的branch/worktree/temporary workflow cleanup。PR body、历史branch、commit ancestry或旧Evidence不能替代readback。
