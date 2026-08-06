---
title: 稳定交付路线
status: active
domain: roadmap
last-reviewed: 2026-08-06
---

# 稳定交付路线

本文只拥有稳定 capability DAG、阶段进入/退出条件、物理 Evidence、跨阶段反转条件和产品完成定义。当前 SHA、PR、CI、活动包、blocker、版本和支持矩阵只由 live resolver、代码合同与 `docs/work/**` 拥有。

## 状态解释

路线中的能力只有以下真实层级：

```text
proposed
→ contract-frozen
→ implemented-in-main
→ physically-verified
→ packaged/deployed
→ product-supported
```

本文件描述依赖和完成门，不自行把任何能力标记为已完成。一个类型、测试、PR、文档或示例存在不能跨越后续层级。

“完整设计一次冻结”与“实现分包进入 main”并不冲突：终态对象、owner、接口、依赖和验收必须先确定；实现仍按可独立验证、迁移和回滚的纵向闭包进入主干。任何分包都不得降低终态来换取局部通过。

## 唯一根 DAG

```text
R0  Theory / Authority Convergence
 ↓
R1  Canonical Engineering Semantic Kernel
 ↓
R2  Verification Truth Kernel
 ↓
R3  Physical Workspace Observation
 ↓
R4  TypeScript Source Program Model
 ↓
R5  Responsibility Reconstruction
 ↓
R6  Semantic Delta / Impact
 ↓
R7  Operation / Authorization / Planning
 ↓
R8  Transactional Controlled Mutation
 ↓
R9  Brownfield Adoption / Provider Onboarding
 ├──────────────┐
 ↓              ↓
R10 Target Profile / Type Algebra
 ↓              │
R11 Application / Behavior / Target Program Lowering
 ↓              │
R12 General TypeScript Engineering Compiler
 └──────┬───────┘
        ↓
R13 Workbench / AI Semantic Operator
 ↓
R14 Agent Operation Compiler / Run Kernel
 ↓
R15 Release / Deployment / Operations
 ↓
R16 Registry Ecosystem / Additional Languages
```

R9 与 R10–R12 不是两套产品：Brownfield governance、Provider onboarding 与 deterministic generation 共用 R1 的 Engineering Semantic Model、R5 的 Responsibility、R6 的 Impact、R7 的 Operation、R2 的 Verification truth和R11的Implementation Resolution。外部源码、Provider和Adapter只提供候选、Evidence和可替换实现，不建立第二语义核心或第二最终选择器。

## 横切不变量

以下能力不是独立“治理主线”，而是在出现真实 consumer 时随阶段闭合：

```text
Determinism / canonical ordering
Identity / revision / source and implementation binding
Provenance / Explain / Evidence references
Security / Permission / Trust boundary
Implementation eligibility / policy / canonical tie-break
Binding Delta / Impact
Compatibility / Migration / Retirement
Transaction / Fault / Recovery
Incrementality / Performance / Resource governance
Documentation / Development governance
Host / Toolchain / Provider / Adapter / Distribution
```

横切能力只能满足真实阶段出口，不能因为“以后可能需要”提前扩建完整平台。没有 producer、consumer、迁移和现实验收的合同保持 proposal。

## R0 — Theory / Authority Convergence

### 目标

冻结 SEC 最终产品、两条主链、对象模型、唯一 owner、术语、成熟度和根依赖；消除并列总计划、重复 authority 和动态事实泄漏。

### 必须具备

- `docs/product.md` 只拥有问题、产品结果、边界和成功判据；
- `docs/system-architecture.md` 只拥有总体对象层、权威流、两条主链、单写者和跨域引用；
- 本文件是唯一稳定 capability DAG；
- 每个领域只有一个 canonical 文档/代码 owner；
- Target/Host、transaction rollback/migration recovery、Responsibility、Implementation Resolution/Block Resolution、Binding Delta/Compatibility、Verification/Support、Role/Operation/Skill 边界唯一；
- Proposal、Evidence、archive、rolling plan 和 Work Package 不竞争长期 authority；
- 当前能力与目标设计显式区分。

### 退出 Evidence

- registry/ownership/consumer graph 无 duplicate、missing owner 或 cycle；
- stable docs 无动态 SHA/PR/run；
- current-control 不定义长期架构；
- 旧 proposal、阶段计划和 Draft PR 有明确 adopt/adapt/reject/defer/retire disposition；
- docs doctor、repository audit 和独立 Review闭合。

### 反转条件

若后续真实实现证明核心对象边界、authority、两条主链或Implementation Resolution的位置无法共用同一语义模型，必须返回 R0/R1 重算；禁止在下游新增第二模型、第二Resolver、第二Delta comparator、第二Compatibility evaluator或库名分支掩盖冲突。

## R1 — Canonical Engineering Semantic Kernel

### 目标

建立语言、Provider、具体类库与目标无关的 canonical engineering semantics。

### 必须具备

- stable Entity / Fact / Assertion identity；
- authority、confidence、provenance、evidence reference 和 validity；
- Semantic Contract；
- Responsibility、State、Operation、Policy、Permission、Effect、Scenario、Acceptance；
- deterministic normalization、canonical ordering、semantic revision；
- raw → validated → deep-frozen single boundary；
- conflict、ambiguous、unknown 和 opaque；
- 统一 Pipeline Kernel、transaction/journal/recovery基础设施仅作为真实 producer 的执行内核；
- Projection、Scenario cache、Explain 都可重建且不反向写事实；
- package、library、Provider、Adapter、Implementation Decision/Binding与semantic identity严格分域。

### 退出 Evidence

- 同输入 canonical graph byte-stable；
- consumer只接受统一 validated boundary；
- 不存在第二 identity、revision、writer、loader 或 pipeline coordinator；
- Responsibility具有稳定 identity 和 facets，不由文件/Block/UI/类库默认替代；
- 至少一个真实 Contract/Authoring Source 进入 Engineering IR 并产生可验证消费者结果；
- Provider或Binding切换保持Contract时不重写semantic revision；
- 三组无关语义模型不修改 Core 业务分支。

### 禁止提前建设

- 无 consumer 的完整 Application/Behavior/Target IR 宇宙；
- 把 Source Program Model、AST、代码图、Provider catalog、Implementation Binding或 AI Knowledge Graph 提升为 Engineering IR；
- 用 path/display name/random UUID/package name 代替 stable identity。

## R2 — Verification Truth Kernel

### 目标

让所有后续“成功”“合格”“兼容”和“受支持”建立在不可假绿的统一 Requirement、Gate、Result、Claim 与 Aggregate 真值上。

### 必须具备

- `passed | failed | not-run | unsupported | invalidated`；
- executed/reused/not-executed、applicability、owning environment；
- order-independent claim lattice；
- duplicate/missing/unknown gate/claim fail closed；
- not-applicable 与 required-but-not-run 分离；
- zero-test / unresolved selection 不得 passed；
- canonical writer profile、artifact readback 重算和 exact structural comparison；
- blocked prerequisite 与普通物理 failure 分离；
- candidate不能用自身新增 verifier/selector/Resolver/Delta comparator/Compatibility evaluator/merge rule授权自身；
- exact input/environment/command/artifact/cleanup/revision/Binding/Delta-subject binding。

### 退出 Evidence

- product writer、artifact validator、Mutation adapter 和 merge/CI consumer 对同一 truth一致；
- wrong environment、stale Evidence、empty selection、unknown identity、cleanup失败和 self-proof 均无法产生 PASS；
- physical integration 覆盖成功、失败、invalidated、unsupported、not-run 和 blocked；
- Provider conformance可以作为Eligibility或Compatibility输入，但不自动成为ResolutionDecision、Binding Delta、Compatibility Decision或Support；
- old boolean/three-state authority被迁移或明确降为 non-authoritative projection。

### 后继边界

Execution Ledger、Evidence DAG、Run Journal、CI Evidence 新版本、flake平台和完整 Hermetic Runtime只有在真实 R3–R13 consumer需要时增量实现，不作为离开 R2 的无限前置。

## R3 — Physical Workspace Observation

### 目标

在不执行不受信项目代码的前提下，对 exact workspace revision 建立完整、可重复的物理事实。

### 必须具备

- repository/workspace/package/build-target/file/config/test/workflow/resource/artifact inventory；
- Git/object/content/mode/encoding identity；
- tracked/untracked/ignored、generated/vendor/binary/secret/protected/temporary/opaque；
- symlink、junction/reparse、hardlink、case、Unicode 和 path containment；
- package/export/types/lock/toolchain/build-system/install/native evidence；
- owner、public/release surface 和 unreadable/unsupported/unresolved frontier；
- raw/validated observation snapshot 与 deterministic revision。

### 退出 Evidence

- exact revision 的 tracked/declared physical inventory 无未解释遗漏；
- repeated clean observation byte-stable；
- unknown/read failure 不被解释为不存在；
- source、control、cache、runtime materialization 和 recovery state 生命周期可机器分类；
- package/source bytes可作为R4与Provider onboarding的唯一读取输入；
- 至少三个无关 TypeScript fixture 和 SEC 自身通过。

### 禁止提前建设

- 读取路径即获得 semantic identity；
- 默认执行 install/build/test/browser/network；
- 一个巨型 Workspace Snapshot 复制所有 domain object。

## R4 — TypeScript Source Program Model

### 目标

把 R3 物理事实提升为 TypeScript 语言级 observed/derived 模型，并提供无专用Adapter时的最低结构化类库调用面，而不越权成为业务语义或正式Provider支持。

### 分层交付

1. file/module/symbol/declaration/source span/import/export/definition/reference；
2. package/module/exported symbol、signature、generic、overload、normalized type和module resolution；
3. `TypedInvocation` / `ExternalCallBinding`：结构化连接参数和返回值，生成type-correct external call；
4. call/reference candidate、minimal control/data flow、state/effect/error/permission/framework/config candidate；
5. provider coverage、conflict、dynamic/unknown/opaque frontier。

### 必须具备

- independent identity、revision、validator、canonical order、digest 和 freeze；
- TypeScript Compiler API 等 primary frontend作为首要语法/类型 authority，其他 Provider只补 Evidence；
- CLI checker、parser、Program/TypeChecker/module resolution、Language Service、source transform/printer与build executable分离为不同capability/version authority；
- rename/move、overload、declaration merge、generated source、conditional exports、multi-package 和 version skew策略；
- source span与 physical observation revision binding；
- package/source/version/integrity与export/type identity；
- Provider identity、scope、coverage、freshness、diagnostic、resource/network boundary；
- L1 TypedInvocation明确标记Effect、idempotency、retry、timeout、cancellation、安全和runtime behavior为unknown，除非有独立声明/证据。

### 退出 Evidence

- 三个无关 fixture + SEC 三个不相关子系统输出可重复模型；
- 至少三个无关package可在没有专用Adapter时选择export、连接输入输出并生成type-correct源码；
- unsupported/ambiguous/dynamic/behavior-unknown边界显式；
- move/rename不会仅因路径变化无条件丢失identity，也不会靠模型相似度擅自延续；
- Provider冲突保留，不多数票升格；
- TypeScript/ts-morph/private compiler对象不泄漏到Engineering Core；
- model只读，不写 live source。

## R5 — Responsibility Reconstruction

### 目标

从 Source Program Model、Contract、observations 和已有 Facts 生成可解释的 Responsibility candidate，并通过 Reconcile/Adopt 建立真实 authority。

### 必须具备

- source/module/symbol bindings；
- owned state、readers/writers、operations、effects、permissions、resources、errors、lifecycle；
- public contract、consumer/provider和Acceptance candidate；
- confidence、authority class、competing explanations、conflicts和unknown frontier；
- candidate、accepted、rejected、ambiguous、opaque 的明确状态；
- explicit Adopt policy；
- Responsibility identity continuity / split / merge / replace / unknown。

### 退出 Evidence

- 对 SEC 自身至少三个不相关子系统输出候选并与人工基准比较；
- inferred/observed candidate保持 non-authoritative；
- 同名/邻近路径/高confidence不能自动Adopt；
- 至少一个真实 source region完成Reconcile→Adopt并建立owner、Contract、Acceptance和writable boundary。

### 反转条件

若 Responsibility 只能通过业务名称、package品牌或人工逐文件硬编码建立，返回 R1/R4 重算 identity、predicate 和 Source Model。

## R6 — Semantic Delta / Impact

### 目标

对 independently validated semantic snapshots 与 Implementation Binding sets进行确定性结构比较，并保守传播其影响；不在本阶段判断兼容性或选择迁移路线。

### 必须具备

- Authoring/Entity/Fact/Assertion/Source/Implementation Binding/Artifact/Runtime/Evidence Delta分离；
- independently validated from/to endpoints与可比较lineage；
- `Fact Delta`和`ImplementationBindingDelta`具有独立identity、revision、comparator contract和canonical payload；
- Binding change至少区分added、removed、provider-replaced、version/adapter/config/Target/Block/dependency/effect-permission-resource/support变化及unknown/ambiguous；
- comparator不重新运行Resolver、不按包名、semver、API相似度或测试绿猜配对/兼容；
- `READS / WRITES / MUTATES / IMPLEMENTS / DEPENDS_ON / REQUIRES / PERFORMS_EFFECT / REQUIRES_PERMISSION / VERIFIED_BY / LOWERS_TO / CONSUMES / PUBLISHES / OWNS` 等真实关系；
- versioned propagation rule registry；
- definite/possible/unknown certainty；
- canonical witness、cycle/fixpoint、unknown frontier；
- predicted Impact 与 apply 后 actual Impact分离；
- Provider/version/config/Adapter/Target/dependency变化通过`ImplementationBindingDelta`传播到consumer、Artifact、runtime、Verification、release与support surface；
- Verification recommendation但不拥有物理 command/test path；
- Change Management消费Delta/Impact/Evidence后独立产生Compatibility Decision和Migration；
- predicted vs actual/full omission记录。

### 退出 Evidence

- 同一validated endpoints/comparator/rules产生byte-stable Fact Delta、ImplementationBindingDelta和Impact；
- added/removed/assertion update/entity-only/Binding replacement方向正确；
- Requirement、Decision、Binding与Delta identity分域；
- comparator不重新运行Resolver，不按包名/semver/API相似度猜匹配；
- cycles收敛且witness稳定；
- unknown predicate/reference/coverage/Binding endpoint不被当作无影响或兼容；
- Provider/Binding切换准确传播到consumer、Artifact、package、runtime、Verification、release与support；
- Compatibility和Migration只由Change Management消费Delta/Impact后裁决；
- clean/incremental结果等价；
- 至少三组无关模型、两个实现替换场景和一个 Brownfield unknown/opaque 场景通过；
- 至少一段真实历史变化用 predicted/actual/full 校准 precision、recall 和 unknown。

## R7 — Operation / Authorization / Planning

### 目标

把用户、Workbench、AI 和 CLI 的意图收敛为同一个版本化、受限、可计划的 Engineering Operation，包括实现constraint/preference request，但不允许caller提交derived Eligibility/Decision/Binding/Delta/Compatibility。

### 必须具备

- Operation Registry：target kinds、caller inputs、required predicates、Effects、Permissions、must-preserve、forbidden、expected Delta、minimum Verification、idempotency、rollback/recovery；
- implementation input：intent/constraint/prefer/require/forbid/pin/custom，字段权限和不可覆盖边界明确；
- authorization交集：caller capability ∩ operation ∩ target ∩ source owner ∩ path/region ∩ policy ∩ provider ∩ verification ∩ current revision；
- unique Source Ownership Resolver 和 path proof；
- plan/dry-run严格只读；
- isolated deterministic transform；
- preview canonical rebuild、Implementation re-resolution、Fact/Binding Delta、Impact、Compatibility requirements和Verification union；
- immutable plan identity、expiry 和 equivalence；
- unknown/ambiguous/stale/conflicted时拒绝或blocked。

### 退出 Evidence

- caller无法提交derived path、owner、Eligibility、Decision、Binding、Delta、Compatibility、Impact、risk、Verification、rollback或terminal；
- 同一输入产生byte-stable plan和implementation request；
- CLI/Workbench/AI对同一request绑定同一canonical plan；
- `prefer`、`require`、`forbid`、`pin`和`custom`语义不混淆；
- 至少一个真实semantic operation和一个Brownfield governed-source operation完成plan而不写live workspace。

## R8 — Transactional Controlled Mutation

### 目标

把 R7 的合法 plan安全发布为 canonical transition。

### 必须具备

- unique writer authority / lease；
- apply内重读、re-resolve owner/path、re-plan/re-resolve implementation；
- source-byte + semantic CAS；
- durable journal、staging、prior-state/recovery material；
- pre-publication Verification；
- atomic或journaled publication；
- live canonical rebuild与Implementation re-resolution；
- actual Fact Delta、ImplementationBindingDelta和Semantic/Implementation Impact；
- 适用时消费Compatibility Decision与Migration obligations；
- post-publication/readback Verification；
- accepted/rejected/rolled-back/recovery-required；
- crash/fault/TOCTOU、cleanup receipt、retention/compaction。

### 退出 Evidence

- 一个 canonical operation完整通过并发、crash、CAS、publish、rollback和recovery physical proof；
- 一个 Brownfield governed-source operation保留unowned region、comments和format；
- stale plan/Binding/Delta subject确定性拒绝；
- publish前失败无live变化；publish后失败只能exact rollback或recovery-required；
- terminal replay不重复副作用。

### 禁止降级

不能用“修改一个 TypeScript 常量”或“更新package版本”冒充产品级 Semantic Mutation，除非目标本身是明确Authoring Source、Operation target和canonical contract owner，并完成ImplementationBindingDelta、Compatibility Decision与Verification。

## R9 — Brownfield Adoption / Provider Onboarding

### 目标

让真实既有 TypeScript 工程和任意外部类库在不被强制重写为 Block/SEC 模型的情况下进入可观察、可拥有、可操作、可作为实现候选和可逐步 Normalize 的治理闭环。

### 生命周期

```text
Attach → Lift → Reconcile → Adopt → Govern → Normalize
```

外部类库成熟度与该生命周期建立typed mapping：

```text
L0 physical dependency
→ L1 typed external invocation
→ L2 declared governed invocation
→ L3 observed/inferred Provider or Adapter candidate
→ L4 verified Provider/Adapter candidate
→ L5 normalized SEC-owned projection
```

### 必须具备

- R3 Physical Inventory；
- R4 Source Program Model与TypedInvocation；
- R5 Responsibility candidate / Adopt；
- R6 Fact/Binding Delta与Semantic/Implementation Impact；
- R7/R8 governed operations；
- generated/governed/extension/opaque分类；
- formatting/comment/unowned-region preservation；
- Provider不越权；
- black/gray/white区域可见；
- Provider/Adapter candidate的security/license/freshness/conformance和Target Evidence；
- Adopt只授权进入正式candidate catalog，不直接产生最终ImplementationBinding；
- Normalize前完整语义、round-trip、runtime/Acceptance parity、consumer migration、rollback和old-writer/dependency retirement。

### 退出 Evidence

- 至少两个与 SEC reference business 无关的真实 TypeScript 仓库完成 Attach→Adopt；
- 至少一个无Adapter package完成TypedInvocation并保持unknown behavior；
- 至少一个Custom/Governed implementation声明Contract/Effect/Verification；
- 至少一个Provider/Adapter candidate完成conformance并进入正式catalog；
- 至少一个完整模块完成 Governed Mutation；
- 至少一个完整可表示模块完成 Normalize、round-trip、Mutation和rollback；
- source/package/Binding move/change产生deterministic delta census；
- Core不增加业务或品牌名称分支。

## R10 — Target Profile / Type Algebra

### 目标

建立生成目标的 canonical capability输入和跨层类型语义，作为Implementation hard eligibility和Target lowering的可信输入。

### 必须具备

- Compiler authority唯一拥有 Target Profile；
- language/runtime/module/delivery/package manager/persistence/database/UI/verification/deployment/capabilities显式；
- Host、Toolchain、Target、Runtime Environment正交；
- primitive/nominal/enum/optional/list/map/record/union/result/async/stream等Type Algebra；
- identity、normalization、compatibility、serialization、target mapping和unsupported；
- recursion/cycle、union discrimination、nullability、map key、async/stream nesting；
- Provider/Adapter Target requirements只能引用validated Target/Type，不能自己定义兼容truth；
- 未知组合在Implementation Resolution或emit前拒绝。

### 退出 Evidence

- profile/type revisions byte-stable；
- 不从Host/cwd/ambient executable推断Target；
- 一个Target/Type变化可准确失效Candidate/Decision/Binding及其后继Delta/Compatibility Evidence；
- 三组无关模型通过；
- 至少一个真实R11 consumer证明该抽象必要。

## R11 — Application / Behavior / Target Program Lowering

### 目标

按真实Generator/Backend migration建立从目标无关语义、受限行为到具体实现闭包和目标程序的合法化链。

### 必须具备

- 每层一个producer、raw/validated boundary、identity/revision、ordering、validator、deep-freeze、diagnostic和source map；
- Application IR表达module/service/data/state/operation/policy/effect/verification；
- Behavior IR只表达可完整验证和lowering的受限行为；
- 复杂算法进入 Governed Extension/Opaque Boundary；
- 从validated Application/Behavior派生ImplementationRequirement；
- Candidate是完整Provider/Reference/Existing/Custom/Block-delivered闭包，不是包名；
- hard eligibility先检查Contract、Type、Target、Effect/Permission、安全、license、dependency、support与owner；
- unknown/conflict frontier显式且阻止假eligible；
- 只在合格候选中应用版本化`stable | minimal | existing-stack | portable | performance | strict-security`等ResolutionPolicy；
- policy仍并列时使用确定性tie-break并保留完整witness；
- 冻结ResolutionDecision和exact ImplementationBinding；
- Block Capability Resolver只返回其领域的BlockProviderBinding，不取得产品级最终选择；
- Target Program IR只消费Application/Behavior、Target/Type和冻结Binding；
- Backend只负责AST/printer/formatter/typecheck/package/config/bytes，不重新选库；
- progressive legality：partial/full/analysis conversion，unsupported-before-emit；
- legacy resolver/writer read-only shadow → parity → consumer switch → old path deletion。

### 退出 Evidence

- 至少一个真实artifact migration闭合Decision、Binding、bytes、diagnostics、effects、runtime和consumer parity；
- 同一Contract至少有两个无关合格候选、一个不合格候选和一个unknown候选；
- 两种ResolutionPolicy可稳定选择不同合格候选并解释原因；
- `prefer`不合格时可回退，`require/pin`不合格时blocked；
- 输入/candidate/Map/filesystem枚举顺序不改变Decision/Binding；
- Target Program IR和Backend不能绕过Binding；
- clean/incremental Decision、Binding和Target Program parity；
- Resolver不产生Binding Delta或Compatibility Decision；
- 无竞争writer/Resolver；
- Backend不重新解释业务语义或类型兼容；
- 三组无关模型不修改Core。

### 反转条件

若实现选择只能靠具体库名、业务名、模板组合或散落if/else；若Block Resolver、Backend、Adapter或Workbench重新计算最终选择；若Resolver同时拥有Delta comparator或Compatibility evaluator；若hard constraints需要用加权总分抵消，返回R0/R1/R6/R10重算边界，禁止在下游继续扩张。

## R12 — General TypeScript Engineering Compiler

### 目标

形成非业务特化、可增量、可迁移、可发布的 TypeScript 工程编译闭环。

### 必须具备

- 多类业务：state/lifecycle、reservation/concurrency、approval/policy、Governed Extension；
- 完整Source/Test/Config/Artifact generation；
- Reference Provider、成熟第三方Provider、repository existing与Custom Provider至少各有适用闭环或明确unsupported；
- positive、negative、failure、provider switch、upgrade、round-trip场景；
- clean deterministic compilation基准；
- Compiler Incremental Graph：content/revision/pass/profile/requirement/candidate/policy/decision/binding/provider/backend key、unknown扩大失效、clean/incremental Decision/Binding/byte parity；
- cancellation、resource、memory、queue、cache和critical path可观察；
- TaskEnvelope/Generator/test selection由Acceptance/Impact/ownership派生，无Customer/Ticket硬编码；
- Provider/package升级先形成new Decision/Binding，由R6生成ImplementationBindingDelta和Impact，再由Change Management签发Compatibility Decision/Migration；
- Adapter可保持旧合同或Migration明确阻断；
- old Provider/Adapter/dependency/writer在迁移后退役。

### 退出 Evidence

- 常见新业务能力主要增加Contract/Block/Provider/Adapter，不增加Core业务或品牌分支；
- 同一Semantic Contract可在Reference和第三方Provider间切换而保持合同；
- 生成物无TODO/空实现；
- typecheck/conformance/runtime Acceptance/negative/source mapping闭合；
- clean/incremental byte-equivalent：Decision、Binding、Fact/Binding Delta与bytes等价；
- 依赖升级不静默改变timeout/retry/error/serialization/consistency/security语义；
- Delta comparator、Compatibility evaluator和Resolver没有重复owner；
- 至少两个外部工程验证反特化。

## R13 — Workbench / AI Semantic Operator

### 目标

把 canonical state、Implementation Resolution、Fact/Binding Delta、Impact、Compatibility、Plan、Evidence 和受控 Operation 形成用户可理解、可细致控制但不需要精通全部类库的产品面。

### 必须具备

- Architecture、Scenario、Data、State、Contract、Effect/Permission/Trust、Implementation、Impact、Evidence投影；
- 统一Inspector和stable references；
- unknown/opaque/stale/conflict/成熟度可见；
- Implementation View显示requirements、candidate closures、Eligibility、Decision、Binding、Binding Delta、Compatibility Decision、淘汰原因、版本和迁移影响；
- 用户控制模式：intent、constraint、prefer、require、forbid、pin、custom、bounded override；
- 所有模式进入同一Engineering Operation，UI不计算Eligibility、Binding、Delta或Compatibility；
- Context Packet从语义、Binding到必要源码渐进装载；
- Task/Operation view只是typed Operation Envelope投影；
- CLI/Workbench/AI消费同一plan/resolve/apply/query/recover adapter；
- local transport Host/Origin/capability安全；
- AI只能提交proposal/candidate，不能扩大permission/path/effect/verification或伪造Decision/Delta/Compatibility；
- accepted后从canonical revision重载，不使用UI本地patch。

### 退出 Evidence

- 主要View可相互下钻；
- CLI与Workbench对同一proposal得到等价plan、Decision、Binding、Delta/Compatibility references；
- 用户无需理解所有底层库即可声明意图和约束；专家可以精确pin/custom；
- 用户pin/require不能绕过hard eligibility；
- UI不能从source diff、test green或semver重算Binding Delta/Compatibility；
- accepted/rejected/rolled-back/recovery-required稳定；
- 跨站、越权、stale context和更宽AI proposal均被拒绝；
- 真实用户可以解释平台选了什么、为什么、哪些候选被拒绝、实际改变了什么和升级会如何迁移。

## R14 — Agent Operation Compiler / Run Kernel

### 目标

让 SEC 自身开发也消费结构化 Engineering Operations，而不是靠多份 Skill prose和聊天隐状态维持正确性。

### 最终结构

```text
Universal Policy
→ explicit Role
→ typed Operation Envelope
→ exactly one Primary Skill
→ deterministic services/contracts
→ typed outcome / legal transition
→ external Run State / Evidence
```

### 必须具备

- Role与workflow分离；
- exactly one Primary Skill；
- Work selection、permission、Work Package conflict、Impact/Gate selection、Failure/Epoch、Evidence reuse、Integration/merge legality由机器owner决定；
- Skill渐进披露、context budget、implementation state；
- fresh Worker/Reviewer/Integrator context和独立性；
- Run/Capsule/Event/Transition/Resume state外部化；
- Context compression/restart从authority重算同一next transition；
- candidate Agent/Skill不能自证trust migration；
- 旧17-Skill compatibility projection和完整retirement。

### 进入条件

R3–R13 已有真实 Observation、Impact、Operation、Mutation、Resolution、Delta/Compatibility、Verification产物。禁止只用治理fixture自我证明 Run Kernel。

### 退出 Evidence

- 真实产品Work Package完成orient→implement→review→integrate→readback；
- 恢复不依赖聊天；
- 每阶段context输入有上限；
- Skill重复owner和冲突为零；
- 失败/重跑/merge transition由typed result决定。

## R15 — Release / Deployment / Operations

### 目标

从 exact canonical revision、Target Profile和ImplementationBinding构建、验证、发布、部署和运营可追踪产品。

### 必须具备

- clean tracked-tree release workspace，禁止live-worktree copy和force-push重写历史；
- package/public projection、exports、entry、runtime assets、exact Binding/dependency/license/native/install-script closure；
- SBOM、checksums、signing/attestation、publication receipt；
- 每个声明Host/Target/platform/Provider Binding的clean install/runtime Evidence；
- 发布前适用的ImplementationBindingDelta、Compatibility Decision和Migration obligations已闭合；
- Deployment/config/secrets/migration/feature flag/canary/rollback/observability/SLO/incident；
- Support maturity与Verification/Compatibility/Implementation selection分离；
- yank/deprecation/consumer migration；
- 发布、部署、健康、回滚和事故状态来自唯一Release/Operations truth。

### 退出 Evidence

- 可重复package/public artifact；
- 跨Host canonical parity；
- 至少一个真实部署和回滚；
- secret/privacy/supply-chain边界闭合；
- Provider/Binding撤销可触发Support失效和受控重新Resolution、Delta/Compatibility与Migration；
- 支持声明可因EOL、incident或physical regression失效。

## R16 — Registry Ecosystem / Additional Languages

### 目标

在 TypeScript纵切片、Brownfield、Implementation Resolution、Delta/Compatibility、Mutation、Release和Provider contract现实闭合后扩展资产、Provider/Adapter生态与语言覆盖。

### Registry / Provider 必须具备

- identity、content digest、signing/trust、Effect/Permission；
- ProviderManifest、Adapter Contract、Reference/Custom Provider封装；
- L0–L5 onboarding、conformance、catalog eligibility和support maturity；
- compatibility、Verification、Migration、revocation/yank和supply-chain Evidence；
- official/private/community source显式policy；
- Block/Contract/Generator/Adapter/Provider/Protocol版本分域；
- 用户或组织可以注册Custom Provider，但不能自证Eligibility或Support；
- AI可以生成Provider/Adapter candidate和tests，但只能进入candidate/conformance流程；
- 消费者升级、退役和历史解释；
- Registry/Provider catalog不拥有最终Implementation Resolution、Binding Delta或Compatibility。

### 新语言必须具备

- Language Frontend；
- Source Analysis Provider；
- Language Service / Source Transformation边界；
- Target Backend；
- Build/Runtime Adapter；
- cross-language Contract/FFI/RPC/schema/artifact boundary；
- 不能把语言私有AST/IR提升为通用Engineering IR；
- 语言能力可以作为Provider候选，但最终实现选择、Binding Delta和Compatibility仍通过统一跨语言contract。

### 进入条件

R12/R15闭合。否则扩大Registry、Provider市场或语言只会放大Core缺口。

## Workspace Domain 激活规则

Workspace Domain 轨道按真实 consumer 和风险逐步成熟，成熟度阶梯固定为：

```text
W0 inventory
→ W1 validated identity/revision
→ W2 query/projection
→ W3 Delta/Impact
→ W4 governed mutation
→ W5 migration/compatibility
→ W6 fault/recovery
→ W7 product-supported
```

覆盖 Domain 至少包括：

- Repository；
- Documentation；
- Workflow / Gate；
- Agent Operations；
- Evidence；
- Release；
- Product Decision / Portfolio。

Read-only Domain 可以先闭合 W1/W2 提供价值，不要求先实现 W4–W6；但没有 identity/validator 的目录或 ledger 不能冒充 Domain，也不能用只读 inventory 宣称整个 Domain 已产品化。每个 Domain 进入 W3 及以后都必须消费主脊对应的真实 producer/consumer。

## Nexus Conformance 轨道

Nexus Conformance 是 SEC 自身全资产、全机制、全公开面的无遗漏吸收轨道，不是可选的附属演示：

```text
N0 exact repository/artifact census
→ N1 path classification 100%
→ N2 mechanism decisions 100%
→ N3 EPR 29/29 + current Skills + entrypoints + public/deployed surfaces
→ N4 Workspace Domain bindings
→ N5 accepted semantic / diagnostic / effect / failure parity
→ N6 consumer migration + shadow/readback
→ N7 retirement
→ N8 unexplained delta = 0
```

N0–N4 可以只读并行推进，但正式 Adopt/Normalize 必须消费产品主脊的 Observation、Source Model、Impact、Operation、Implementation Resolution、Delta/Compatibility与Verification真值；N 轨道不能以 ledger 文件存在、计数模板或两个外部演示仓库替代完整无遗漏证明。

Nexus 完成门固定为：

```text
unclassified = 0
undecided = 0
missing parity = 0
unexplained delta = 0
unauthorized retirement = 0
```

## Specialized Target / Provider 轨道

专用 Target 与 Provider 是主脊闭合后的受约束扩展轨道，按真实 corpus/architecture 需求进入：

```text
S0 corpus + architecture only
→ S1 physical inventory / provider contract
→ S2 Source Program provider support
→ S3 cross-artifact Impact
→ S4 governed mutation
→ S5 deterministic resolution / binding-delta / lowering / round-trip
→ S6 physical runtime / compatibility / target acceptance
→ S7 supported target / profile / provider
```

长期覆盖目标包括：Web、Node/Bun/Edge、Persistence、Mobile、Native、Systems、Hardware、High Assurance 与 ML/Data。任何 S 轨道进入 S1 前必须先有 corpus/architecture 和 provider contract；进入 S5/S6 前必须消费 R1 Engineering Semantic Model、R6 Delta/Impact、R11 Implementation Resolution 与 R2 Verification truth。

S 轨道不得改变 R1 canonical authority，不得在 TypeScript 主脊未闭合时建立第二 compiler core、第二Implementation Resolver、第二Binding comparator或第二Compatibility evaluator，也不能把语言私有 AST/IR 提升为通用 Engineering IR。

## 三轨与主脊的关系

产品主脊 P（R0–R16）是唯一正式能力主线；Workspace Domain（W）、Nexus Conformance（N）、Specialized Target / Provider（S）是受约束交付轨道，不是平行 authority，也不能任意抢占主脊。任何 W/N/S 结果只有进入唯一主链、owner 无竞争、public contract/migration/retirement 一致并通过真实 Verification/Review 后才算闭合。

## 单包退出规则

Work Package只有在以下全部成立后结束：

- 结果进入唯一主链；
- resolver/comparator/Compatibility/writer等owner无竞争；
- public contract、migration和retirement一致；
- positive/negative/failure/compatibility tests通过；
- required CI/Evidence/independent Review无阻塞；
- 旧Resolver/Comparator/Compatibility path/Provider/Adapter/writer/dependency路径退役或有明确consumer migration；
- new-main readback和cleanup完成。

Proposal、类型、实现提交、单平台测试或PR合并只证明相应成熟度，不能提前关闭现实能力目标。

## 路线执行规则

- TypeScript first，Core language/provider-neutral。
- Observation → Responsibility → Impact → Operation → Mutation 不可颠倒。
- Application/Behavior → Implementation Resolution → Target Program → Backend不可绕过或反向解释。
- Old/New Binding → ImplementationBindingDelta/Impact → Compatibility Decision/Migration不可合并成一个万能Resolver或Upgrade函数。
- Verification truth在所有产品纵切片之前闭合，但后继Evidence平台不能无限阻塞产品线。
- Brownfield和TypedInvocation是早期通用性证明，不是Generator成熟后的附属功能。
- 成熟轮子优先；引入必须有capability census、真实试用、Provider边界和duplicate removal，存在开源项目不自动等于应采用。
- 每次交付一个可合并纵向闭包；Spike默认不合并。
- 外部能力先作为可替换Provider/Adapter；Provider catalog、Block Resolver、Workbench、Backend和Dependency materializer不得复制Implementation Resolution、Binding Delta或Compatibility。
- 阶段顺序表达依赖，不授权第二loader、writer、revision、resolver、comparator、Compatibility evaluator、selector、cache或pipeline。
- 当前能力、目标设计、物理验证、分发和现实支持分别标记。
- 基础设施饥饿保护：每完成一个非 P0/P1 的基础设施包，接下来至少完成两个直接推进 R3–R13 产品主脊的包，除非真实 P0/P1 blocker 打断；格式化、Review 平台、Knowledge Closure、完整 Run Kernel 与完整 Evidence DAG 不得形成基础设施长队。
- 没有真实阻塞时及时merge/close/cleanup，不制造无证据修改。
- 新Evidence推翻上游identity、owner、语义、Implementation/Delta/Compatibility边界或产品假设时，返回相应阶段重算，不在下游追加例外。

## SEC-TS 首个完成边界

SEC-TS MVP至少要求：

1. R1/R2 canonical semantics与Verification truth闭合；
2. R3/R4 对真实TypeScript工程建立可重复Physical/Source模型，并支持无Adapter TypedInvocation；
3. R5 Responsibility candidate与至少一个Adopt闭合；
4. R6 predicted/actual Fact/Binding Delta与Semantic/Implementation Impact可校准，Compatibility保持独立裁决；
5. R7/R8 一个canonical和一个Brownfield operation完成transaction/recovery；
6. R9 两个外部工程完成Attach→Adopt，至少一个Provider进入正式catalog、一个模块Normalize；
7. R10–R12 对同一Contract解析至少两个无关实现，冻结唯一Decision/Binding，产生确定性Binding Delta/Impact并在多类无关业务上不修改Core；
8. R13用户可通过Workbench/CLI声明intent/constraints或pin/custom，理解选择、实际Binding变化、Compatibility和Migration原因并执行主要Operation；
9. R15 clean package、exact Binding closure和至少一个真实部署/rollback；
10. unknown、opaque、unsupported、Eligibility、Delta、Verification、Compatibility和Support层级始终真实可见。
