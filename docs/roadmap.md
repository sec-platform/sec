---
title: 稳定交付路线
status: active
domain: roadmap
last-reviewed: 2026-08-04
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
R9  Brownfield Adoption
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

R9 与 R10–R12 不是两套产品：Brownfield governance 与 deterministic generation 共用 R1 的 Engineering Semantic Model、R5 的 Responsibility、R6 的 Impact、R7 的 Operation 和 R2 的 Verification truth。

## 横切不变量

以下能力不是独立“治理主线”，而是在出现真实 consumer 时随阶段闭合：

```text
Determinism / canonical ordering
Identity / revision / source binding
Provenance / Explain / Evidence references
Security / Permission / Trust boundary
Compatibility / Migration / Retirement
Transaction / Fault / Recovery
Incrementality / Performance / Resource governance
Documentation / Development governance
Host / Toolchain / Provider / Distribution
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
- Target/Host、transaction rollback/migration recovery、Responsibility、Verification/Compatibility/Support、Role/Operation/Skill 边界唯一；
- Proposal、Evidence、archive、rolling plan 和 Work Package 不竞争长期 authority；
- 当前能力与目标设计显式区分。

### 退出 Evidence

- registry/ownership/consumer graph 无 duplicate、missing owner 或 cycle；
- stable docs 无动态 SHA/PR/run；
- current-control 不定义长期架构；
- 旧 proposal、阶段计划和 Draft PR 有明确 adopt/adapt/reject/defer/retire disposition；
- docs doctor、repository audit 和独立 Review闭合。

### 反转条件

若后续真实实现证明核心对象边界、authority 或两条主链无法共用同一语义模型，必须返回 R0/R1 重算；禁止在下游新增第二模型掩盖冲突。

## R1 — Canonical Engineering Semantic Kernel

### 目标

建立语言与目标无关的 canonical engineering semantics。

### 必须具备

- stable Entity / Fact / Assertion identity；
- authority、confidence、provenance、evidence reference 和 validity；
- Semantic Contract；
- Responsibility、State、Operation、Policy、Permission、Effect、Scenario、Acceptance；
- deterministic normalization、canonical ordering、semantic revision；
- raw → validated → deep-frozen single boundary；
- conflict、ambiguous、unknown 和 opaque；
-统一 Pipeline Kernel、transaction/journal/recovery基础设施仅作为真实 producer 的执行内核；
- Projection、Scenario cache、Explain 都可重建且不反向写事实。

### 退出 Evidence

- 同输入 canonical graph byte-stable；
- consumer只接受统一 validated boundary；
- 不存在第二 identity、revision、writer、loader 或 pipeline coordinator；
- Responsibility具有稳定 identity 和 facets，不由文件/Block/UI默认替代；
- 至少一个真实 Contract/Authoring Source 进入 Engineering IR 并产生可验证消费者结果；
- 三组无关语义模型不修改 Core 业务分支。

### 禁止提前建设

- 无 consumer 的完整 Application/Behavior/Target IR 宇宙；
- 把 Source Program Model、AST、代码图或 AI Knowledge Graph 提升为 Engineering IR；
- 用 path/display name/random UUID 代替 stable identity。

## R2 — Verification Truth Kernel

### 目标

让所有后续“成功”建立在不可假绿的统一 Requirement、Gate、Result、Claim 与 Aggregate 真值上。

### 必须具备

- `passed | failed | not-run | unsupported | invalidated`；
- executed/reused/not-executed、applicability、owning environment；
- order-independent claim lattice；
- duplicate/missing/unknown gate/claim fail closed；
- not-applicable 与 required-but-not-run 分离；
- zero-test / unresolved selection 不得 passed；
- canonical writer profile、artifact readback 重算和 exact structural comparison；
- blocked prerequisite 与普通物理 failure 分离；
- candidate不能用自身新增 verifier/selector/merge rule授权自身；
- exact input/environment/command/artifact/cleanup/revision binding。

### 退出 Evidence

- product writer、artifact validator、Mutation adapter 和 merge/CI consumer 对同一 truth一致；
- wrong environment、stale Evidence、empty selection、unknown identity、cleanup失败和 self-proof 均无法产生 PASS；
- physical integration 覆盖成功、失败、invalidated、unsupported、not-run 和 blocked；
- old boolean/three-state authority被迁移或明确降为 non-authoritative projection。

### 后继边界

Execution Ledger、Evidence DAG、Run Journal、CI Evidence 新版本、flake平台和完整 Hermetic Runtime只有在真实 R3–R9 consumer需要时增量实现，不作为离开 R2 的无限前置。

## R3 — Physical Workspace Observation

### 目标

在不执行不受信项目代码的前提下，对 exact workspace revision 建立完整、可重复的物理事实。

### 必须具备

- repository/workspace/package/build-target/file/config/test/workflow/resource/artifact inventory；
- Git/object/content/mode/encoding identity；
- tracked/untracked/ignored、generated/vendor/binary/secret/protected/temporary/opaque；
- symlink、junction/reparse、hardlink、case、Unicode 和 path containment；
- package/lock/toolchain/build-system evidence；
- owner、public/release surface 和 unreadable/unsupported/unresolved frontier；
- raw/validated observation snapshot 与 deterministic revision。

### 退出 Evidence

- exact revision 的 tracked/declared physical inventory 无未解释遗漏；
- repeated clean observation byte-stable；
- unknown/read failure 不被解释为不存在；
- source、control、cache、runtime materialization 和 recovery state 生命周期可机器分类；
-至少三个无关 TypeScript fixture 和 SEC 自身通过。

### 禁止提前建设

- 读取路径即获得 semantic identity；
- 默认执行 install/build/test/browser/network；
- 一个巨型 Workspace Snapshot 复制所有 domain object。

## R4 — TypeScript Source Program Model

### 目标

把 R3 物理事实提升为 TypeScript 语言级 observed/derived 模型，而不越权成为业务语义。

### 分层交付

1. file/module/symbol/declaration/source span/import/export/definition/reference；
2. normalized type、call/reference candidate、module/package resolution、ambiguity；
3. minimal control/data flow、state/effect/error/permission/framework/config candidate；
4. provider coverage、conflict、dynamic/unknown/opaque frontier。

### 必须具备

- independent identity、revision、validator、canonical order、digest 和 freeze；
- TypeScript Compiler API 等 primary frontend作为首要语法/类型 authority，其他 Provider只补 Evidence；
- rename/move、overload、declaration merge、generated source、conditional exports、multi-package 和 version skew策略；
- source span与 physical revision binding；
- Provider identity、scope、coverage、freshness、diagnostic、resource/network boundary。

### 退出 Evidence

- 三个无关 fixture + SEC 三个不相关子系统输出可重复模型；
- unsupported/ambiguous/dynamic边界显式；
- move/rename不会仅因路径变化无条件丢失identity，也不会靠模型相似度擅自延续；
- Provider冲突保留，不多数票升格；
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
-至少一个真实 source region完成Reconcile→Adopt并建立owner、Contract、Acceptance和writable boundary。

### 反转条件

若 Responsibility 只能通过业务名称或人工逐文件硬编码建立，返回 R1/R4 重算 identity、predicate 和 Source Model。

## R6 — Semantic Delta / Impact

### 目标

对计划和实际变化产生统一、可解释、保守并可校准的影响结果。

### 必须具备

- Authoring/Entity/Fact/Assertion/Source/Artifact/Runtime/Evidence Delta分离；
- independently validated from/to endpoints；
- `READS / WRITES / MUTATES / IMPLEMENTS / DEPENDS_ON / REQUIRES / PERFORMS_EFFECT / REQUIRES_PERMISSION / VERIFIED_BY / LOWERS_TO / CONSUMES / PUBLISHES / OWNS` 等真实关系；
- versioned propagation rule registry；
- definite/possible/unknown certainty；
- canonical witness、cycle/fixpoint、unknown frontier；
- predicted Impact 与 apply 后 actual Impact分离；
- Verification recommendation但不拥有物理 command/test path；
- predicted vs actual/full omission记录。

### 退出 Evidence

- 三组无关模型和一个 Brownfield opaque 场景；
- cycles收敛且witness稳定；
- unknown predicate/reference/coverage不被当作无影响；
- clean/incremental结果等价；
-至少一段真实历史变化用 predicted/actual/full 校准 precision、recall 和 unknown。

## R7 — Operation / Authorization / Planning

### 目标

把用户、Workbench、AI 和 CLI 的意图收敛为同一个版本化、受限、可计划的 Engineering Operation。

### 必须具备

- Operation Registry：target kinds、caller inputs、required predicates、Effects、Permissions、must-preserve、forbidden、expected Delta、minimum Verification、idempotency、rollback/recovery；
- authorization交集：caller capability ∩ operation ∩ target ∩ source owner ∩ path/region ∩ policy ∩ provider ∩ verification ∩ current revision；
- unique Source Ownership Resolver 和 path proof；
- plan/dry-run严格只读；
- isolated deterministic transform；
- preview canonical rebuild、Delta、Impact、Verification union；
- immutable plan identity、expiry 和 equivalence；
- unknown/ambiguous/stale/conflicted时拒绝或blocked。

### 退出 Evidence

- caller无法提交derived path、owner、Delta、Impact、risk、Verification、rollback或terminal；
-同一输入产生byte-stable plan；
-CLI/Workbench/AI对同一request绑定同一canonical plan；
-至少一个真实semantic operation和一个Brownfield governed-source operation完成plan而不写live workspace。

## R8 — Transactional Controlled Mutation

### 目标

把 R7 的合法 plan安全发布为 canonical transition。

### 必须具备

- unique writer authority / lease；
- apply内重读、re-resolve owner/path、re-plan；
- source-byte + semantic CAS；
- durable journal、staging、prior-state/recovery material；
- pre-publication Verification；
- atomic或journaled publication；
- live canonical rebuild；
- actual Delta/Impact；
- post-publication/readback Verification；
- accepted/rejected/rolled-back/recovery-required；
- crash/fault/TOCTOU、cleanup receipt、retention/compaction。

### 退出 Evidence

- 一个 canonical operation完整通过并发、crash、CAS、publish、rollback和recovery physical proof；
- 一个 Brownfield governed-source operation保留unowned region、comments和format；
- stale plan确定性拒绝；
- publish前失败无live变化；publish后失败只能exact rollback或recovery-required；
- terminal replay不重复副作用。

### 禁止降级

不能用“修改一个 TypeScript 常量”冒充产品级 Semantic Mutation，除非该常量本身是明确 Authoring Source、Operation target和canonical contract owner。

## R9 — Brownfield Adoption

### 目标

让真实既有 TypeScript 工程在不被强制重写为 Block/SEC 模型的情况下进入可观察、可拥有、可操作和可逐步 Normalize 的治理闭环。

### 生命周期

```text
Attach → Lift → Reconcile → Adopt → Govern → Normalize
```

### 必须具备

- R3 Physical Inventory；
- R4 Source Program Model；
- R5 Responsibility candidate / Adopt；
- R6 Impact；
- R7/R8 governed operations；
- generated/governed/extension/opaque分类；
- formatting/comment/unowned-region preservation；
- Provider不越权；
- Normalize前完整语义、round-trip、runtime/Acceptance parity、consumer migration、rollback和old-writer retirement。

### 退出 Evidence

- 至少两个与 SEC reference business 无关的真实 TypeScript 仓库完成 Attach→Adopt；
-至少一个完整模块完成 Governed Mutation；
-至少一个完整可表示模块完成 Normalize、round-trip、Mutation和rollback；
- source move/change产生deterministic delta census；
- Core不增加业务名称分支。

## R10 — Target Profile / Type Algebra

### 目标

建立生成目标的 canonical capability输入和跨层类型语义。

### 必须具备

- Compiler authority唯一拥有 Target Profile；
- language/runtime/module/delivery/package manager/persistence/database/UI/verification/deployment/capabilities显式；
- Host、Toolchain、Target、Runtime Environment正交；
- primitive/nominal/enum/optional/list/map/record/union/result/async/stream等Type Algebra；
- identity、normalization、compatibility、serialization、target mapping和unsupported；
- recursion/cycle、union discrimination、nullability、map key、async/stream nesting；
-未知组合在emit前拒绝。

### 退出 Evidence

- profile/type revisions byte-stable；
-不从Host/cwd/ambient executable推断Target；
-三组无关模型通过；
-至少一个真实R11 consumer证明该抽象必要。

## R11 — Application / Behavior / Target Program Lowering

### 目标

按真实 Generator/Backend migration建立目标无关到目标程序的合法化链。

### 必须具备

-每层一个producer、raw/validated boundary、identity/revision、ordering、validator、deep-freeze、diagnostic和source map；
- Application IR表达module/service/data/state/operation/policy/effect/verification；
- Behavior IR只表达可完整验证和lowering的受限行为；
-复杂算法进入 Governed Extension/Opaque Boundary；
- Target Program IR表达目标语言程序结构；
- Backend只负责AST/printer/formatter/typecheck/package/config/bytes；
- progressive legality：partial/full/analysis conversion，unsupported-before-emit；
- legacy writer read-only shadow → parity → consumer switch → old writer deletion。

### 退出 Evidence

-至少一个真实artifact migration闭合bytes、diagnostics、effects、runtime和consumer parity；
-无竞争writer；
-Backend不重新解释业务语义或类型兼容；
-三组无关模型不修改Core。

## R12 — General TypeScript Engineering Compiler

### 目标

形成非业务特化、可增量、可发布的 TypeScript 工程编译闭环。

### 必须具备

-多类业务：state/lifecycle、reservation/concurrency、approval/policy、Governed Extension；
-完整Source/Test/Config/Artifact generation；
-positive、negative、failure、upgrade、round-trip场景；
-clean deterministic compilation基准；
-Compiler Incremental Graph：content/revision/pass/profile/provider key、unknown扩大失效、clean/incremental byte parity；
-cancellation、resource、memory、queue、cache和critical path可观察；
-TaskEnvelope/Generator test selection由Acceptance/Impact/ownership派生，无Customer/Ticket硬编码。

### 退出 Evidence

-常见新业务能力主要增加Contract/Block/Adapter，不增加Core业务分支；
-生成物无TODO/空实现；
-typecheck/runtime Acceptance/negative/source mapping闭合；
-clean/incremental byte-equivalent；
-至少两个外部工程验证反特化。

## R13 — Workbench / AI Semantic Operator

### 目标

把 canonical state、Impact、Plan、Evidence 和受控 Operation 形成用户可理解的产品面。

### 必须具备

- Architecture、Scenario、Data、State、Contract、Effect/Permission/Trust、Impact、Evidence投影；
-统一Inspector和stable references；
-unknown/opaque/stale/conflict/成熟度可见；
-Context Packet从语义到必要源码渐进装载；
-Task/Operation view只是typed Operation Envelope投影；
-CLI/Workbench/AI消费同一plan/apply/query/recover adapter；
-local transport Host/Origin/capability安全；
-AI只能提交proposal，不能扩大permission/path/effect/verification；
-accepted后从canonical revision重载，不使用UI本地patch。

### 退出 Evidence

-主要View可相互下钻；
-CLI与Workbench对同一proposal得到等价plan；
-accepted/rejected/rolled-back/recovery-required稳定；
-跨站、越权、stale context和更宽AI proposal均被拒绝；
-真实用户可以不理解内部脚本判断工程状态和下一动作。

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
-Context compression/restart从authority重算同一next transition；
-candidate Agent/Skill不能自证trust migration；
-旧17-Skill compatibility projection和完整retirement。

### 进入条件

R3–R8 已有真实 Observation、Impact、Operation、Mutation、Verification产物。禁止只用治理fixture自我证明 Run Kernel。

### 退出 Evidence

-真实产品Work Package完成orient→implement→review→integrate→readback；
-恢复不依赖聊天；
-每阶段context输入有上限；
-Skill重复owner和冲突为零；
-失败/重跑/merge transition由typed result决定。

## R15 — Release / Deployment / Operations

### 目标

从 exact canonical revision 构建、验证、发布、部署和运营可追踪产品。

### 必须具备

- clean tracked-tree release workspace，禁止live-worktree copy和force-push重写历史；
- package/public projection、exports、entry、runtime assets、dependency/license/native/install-script closure；
- SBOM、checksums、signing/attestation、publication receipt；
-每个声明Host/Target/platform的clean install/runtime Evidence；
- Deployment/config/secrets/migration/feature flag/canary/rollback/observability/SLO/incident；
- Support maturity与Verification/Compatibility分离；
-yank/deprecation/consumer migration；
-发布、部署、健康、回滚和事故状态来自唯一Release/Operations truth。

### 退出 Evidence

-可重复package/public artifact；
-跨Host canonical parity；
-至少一个真实部署和回滚；
-secret/privacy/supply-chain边界闭合；
-支持声明可因EOL、incident或physical regression失效。

## R16 — Registry Ecosystem / Additional Languages

### 目标

在 TypeScript纵切片、Brownfield、Mutation、Release和Provider contract现实闭合后扩展资产生态与语言覆盖。

### Registry 必须具备

- identity、content digest、signing/trust、Effect/Permission；
-compatibility、Verification、Migration、revocation/yank和supply-chain Evidence；
- official/private/community source显式policy；
-Block/Contract/Generator/Protocol版本分域；
-消费者升级、退役和历史解释。

### 新语言必须具备

- Language Frontend；
- Source Analysis Provider；
- Target Backend；
- Build/Runtime Adapter；
- cross-language Contract/FFI/RPC/schema/artifact boundary；
-不能把语言私有AST/IR提升为通用Engineering IR。

### 进入条件

R12/R15闭合。否则扩大Registry或语言只会放大Core缺口。

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

N0–N4 可以只读并行推进，但正式 Adopt/Normalize 必须消费产品主脊的 Observation、Source Model、Impact、Operation 与 Verification 真值；N 轨道不能以 ledger 文件存在、计数模板或两个外部演示仓库替代完整无遗漏证明。

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
→ S5 deterministic lowering / round-trip
→ S6 physical runtime / target acceptance
→ S7 supported target / profile
```

长期覆盖目标包括：Web、Node/Bun/Edge、Persistence、Mobile、Native、Systems、Hardware、High Assurance 与 ML/Data。任何 S 轨道进入 S1 前必须先有 corpus/architecture 和 provider contract；进入 S5/S6 前必须消费 R1 Engineering Semantic Model、R6 Impact 与 R2 Verification truth。

S 轨道不得改变 R1 canonical authority，不得在 TypeScript 主脊未闭合时建立第二 compiler core，也不能把语言私有 AST/IR 提升为通用 Engineering IR。

## 三轨与主脊的关系

产品主脊 P（R0–R16）是唯一正式能力主线；Workspace Domain（W）、Nexus Conformance（N）、Specialized Target / Provider（S）是受约束交付轨道，不是平行 authority，也不能任意抢占主脊。任何 W/N/S 结果只有进入唯一主链、owner 无竞争、public contract/migration/retirement 一致并通过真实 Verification/Review 后才算闭合。

## 单包退出规则

Work Package只有在以下全部成立后结束：

-结果进入唯一主链；
-owner无竞争；
-public contract、migration和retirement一致；
-positive/negative/failure/compatibility tests通过；
-required CI/Evidence/Review无阻塞；
-旧路径退役或有明确consumer migration；
-new-main readback和cleanup完成。

Proposal、类型、实现提交、单平台测试或PR合并只证明相应成熟度，不能提前关闭现实能力目标。

## 路线执行规则

- TypeScript first，Core language-neutral。
- Observation → Responsibility → Impact → Operation → Mutation 不可颠倒。
- Verification truth在所有产品纵切片之前闭合，但后继Evidence平台不能无限阻塞产品线。
- Brownfield是早期通用性证明，不是Generator成熟后的附属功能。
-每次交付一个可合并纵向闭包；Spike默认不合并。
- 外部能力先作为可替换Provider/Adapter；引入必须删除或阻止重复实现。
- 阶段顺序表达依赖，不授权第二loader、writer、revision、selector、cache或pipeline。
- 当前能力、目标设计、物理验证、分发和现实支持分别标记。
- 基础设施饥饿保护：每完成一个非 P0/P1 的基础设施包，接下来至少完成两个直接推进 R3–R9 产品主脊的包，除非真实 P0/P1 blocker 打断；格式化、Review 平台、Knowledge Closure、完整 Run Kernel 与完整 Evidence DAG 不得形成基础设施长队。
- 没有真实阻塞时及时merge/close/cleanup，不制造无证据修改。
- 新Evidence推翻上游identity、owner、语义或产品假设时，返回相应阶段重算，不在下游追加例外。

## SEC-TS 首个完成边界

SEC-TS MVP至少要求：

1. R1/R2 canonical semantics与Verification truth闭合；
2. R3/R4 对真实TypeScript工程建立可重复Physical/Source模型；
3. R5 Responsibility candidate与至少一个Adopt闭合；
4. R6 predicted/actual Impact可校准；
5. R7/R8 一个canonical和一个Brownfield operation完成transaction/recovery；
6. R9 两个外部工程完成Attach→Adopt，至少一个模块Normalize；
7. R10–R12 多类无关业务不修改Core且deterministic lowering闭合；
8. R13用户可通过Workbench/CLI理解和执行主要Operation；
9. R15 clean package和至少一个真实部署/rollback；
10. unknown、opaque、unsupported、Verification、Compatibility和Support层级始终真实可见。
