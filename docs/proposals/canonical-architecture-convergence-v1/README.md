---
title: SEC Converged Architecture Baseline V1
status: proposal
domain: proposal
tracking: issue-232
exact-main: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
authority: none
merge-policy: spike-default-no-merge
---

# SEC Converged Architecture Baseline V1

> 这是 Issue #232 Phase A 的非权威设计收敛基线，不是已证明的“全局最优”或不可变化的“最终设计”。它综合当前 canonical authority、Issue #222/#224、PR #226/#229/#231、现有实现反例与 PR #233 对抗审查。正式采用必须从届时 latest `main` 迁入唯一 canonical owners；本目录随后退役。

## 1. 本目录的唯一作用

本目录把多套并列未来设计压缩为五种互补产物：

- 本文：人类可读的决策入口；
- `constraints.yaml`：不可退让约束、证据化默认、实验和拒绝项；
- `decision-ledger.yaml`：逐项 adopt/adapt/reject/defer/experimental 裁决；
- `assembly.yaml`：无权威的机器关系投影；
- `implementation-dag.yaml`：真实依赖与最短产品路径；
- `migration-and-retirement.md`：文档压缩、吸收和退役。

相同算法、schema、状态或未来路线不得在这些文件之间重复维护。约束以 `constraints.yaml` 为索引；实现细节最终进入代码合同和领域 owner。

## 2. 产品定义

SEC 是：

> **确定性的、多领域工程语义编译器，以及建立在同一 canonical state、查询面和 Mutation facade 上的受治理工程变更平台。**

它把产品意图、受权威输入、已有源码、配置、测试、运行观察和工程政策编译为 validated Engineering Workspace；再产生源码、测试、文档、Gate、Agent、Release、Explain、Impact 与 Workbench 投影。变化必须经过授权、source owner、actual Delta、Impact、Verification、发布和恢复。

它不是万能 AST/IR、代码知识图、模板市场、低代码私有运行时、任意整仓 AI patcher，亦不声称自动恢复任意程序的全部业务语义。

## 3. 收敛总装

```text
Minimal Federation Kernel
→ independent shared protocol domains
→ domain-owned typed canonical snapshots
→ rebuildable Engineering Fact/Assertion projection
→ validated Workspace Snapshot of domain revisions and references
→ one Query / Mutation / Verification truth per owner
```

### Minimal Federation Kernel

只拥有：

- domain、typed reference 和 revision reference 的公共 shape；
- authority/producer reference；
- validated snapshot、coverage、unknown frontier 和 migration envelope；
- 唯一 cross-domain reference-closure validation contract。

Reference closure 必须统一检查：目标存在、revision 兼容、owner 唯一、禁止的 authority cycle 不存在、unresolved frontier 未被吞掉。该 trust-root candidate 必须由 base-side 或独立 verifier 证明。

Kernel 不拥有领域字段、Type/Effect 算法、Verification status、Mutation terminal、Agent lifecycle、Compatibility decision、Support enablement 或业务名称。

### Shared protocol domains

相互独立：

- Contract protocol；
- Type Algebra；
- Effect / Resource / Capability；
- Condition / Freshness；
- Compatibility；
- Support Claim。

Compatibility 与 Support 永久分离：前者判断指定维度和方向是否兼容；后者声明 `proposed → contract-frozen → implemented-in-main → physically-verified → packaged-deployed → product-supported` 的成熟度与 owning Evidence。

### Typed domain snapshots

Source Program、Responsibility、Repository、Documentation、Workflow/Gate、Agent、Release、Compilation、Delta/Impact、Mutation、Verification/Evidence、Runtime 和 Development/Integration 各自拥有 raw/validated boundary、identity/revision、producer、validator、writer 和 state machine。

Engineering Fact/Assertion 只做跨域 assertion、query 和 provenance projection，不能反向覆盖 typed domain state。Workspace Snapshot 只聚合 domain revisions 和经过 reference-closure 验证的引用。

## 4. 永久产品边界

- Authority、canonical state、Evidence、projection 分离。
- Unknown、ambiguous、conflicted、stale、unsupported、opaque 显式。
- 每个 canonical identity/state/writer/validator/selector 一个 owner。
- 相同 validated inputs 产生确定性结果；incremental 与 clean 等价。
- AI/Provider 只产生 proposal、observation 或 Evidence。
- Candidate 不自证；missing/skipped/unsupported/stale/cleanup failure 不 PASS。
- Mutation 无 partial success；只有 accepted、rejected、rolled-back、recovery-required。
- Core 不按业务、语言、框架或工具品牌增加特化分支。
- Canonical writes 使用 single writer + CAS；CRDT 仅限非权威协作表面。
- 复杂算法可长期位于 Governed Extension 或 Opaque Boundary，不强塞进 Behavior IR。

完整机器约束见 `constraints.yaml`。

## 5. Source、Responsibility 与编译主链

```text
exact bytes/mode
→ lossless syntax
→ language semantics
→ Source Program dialect
→ candidates and reconciliation
→ typed semantic snapshots
→ Target Profile + Type Algebra
→ Application IR
→ bounded Behavior IR / Governed Extension
→ Target Program IR
→ Backend + provenance
```

TypeScript 首先使用 TypeScript Compiler API 作为 symbol/type/module authority，full-fidelity layer 负责 comment、format 和 unowned-region preservation。Tree-sitter、ts-morph、CodeQL、runtime trace 和 AI 都只能是显式 Provider。

Responsibility 是工程 obligation，不是函数、文件或 Block。Function、source binding、Responsibility 与 Block 都是多对多。至少区分 Computation、Decision、State、Effect、Authority、Transaction、Lifecycle、Error、Orchestration 和 Projection facets。

每层使用 `raw builder → validator → immutable snapshot → deterministic consumer`。Demand-driven Query 只能在 clean correctness 稳定后作为优化；Compiler Query DAG 与 Evidence DAG 永久分离。

## 6. Delta、Impact、Mutation 与 Verification

Delta 分离 Authoring、Source、Engineering、Compilation、Artifact、Runtime 和 Support 层。Impact 使用 definite/possible/unknown 单调传播、stable witness 和 unknown frontier。

Mutation 固定为：

```text
typed intent
→ authorization intersection
→ read-only plan
→ isolated candidate
→ actual Delta / Impact / minimum Verification
→ apply under lease and CAS
→ journaled publish / readback / recovery
```

Verification 固定拆分 Requirement、Applicability、Gate Definition、Execution、Result、Claim、Evidence 与 Aggregate。Action Key 正确前不得复用结果；failure 可复用来停止确定性重跑，但不成为 positive Evidence。

## 7. 开发与 Agent

```text
Ready Issue
→ trusted orientation
→ Task Capsule
→ Change Closure
→ authorized operation
→ advisory incremental feedback
→ frozen candidate
→ exact Review and Evidence
→ Integration Epoch
→ expected-head publication
→ main readback / cleanup / replan
```

Work selection、Capsule、Closure、Candidate/Failure、Trusted Bootstrap、Evidence/Run、Test Impact、Automatic Feedback、Compiler Query、Integration 和 Mutation 必须分别由 `implementation-dag.yaml` 中的唯一 owner 承担。

Agent 采用 Role + typed Operation Envelope + exactly one Primary Skill + deterministic services + typed outcome。Skill 数量和名称不是架构不变量；Skill prose 不拥有权限、状态机、Impact 或 Gate 真值。

## 8. 最短产品路径

Release credential 修复和 architecture projection 可以并行，但不能阻塞首个产品纵切片。真实关键路径是：

```text
#227 closure
→ Verification aggregate truth
→ select one real SEC subsystem
→ TypeScript Source Program
→ Responsibility self-observation
→ Responsibility Delta / Impact / Explain
→ minimal Effect/Resource/Capability subset
→ one governed Mutation with rollback
→ minimal Target/Type/IR
→ three unrelated TypeScript models
→ real Brownfield Adopt/Normalize
```

Optional Evidence、daemon、remote CAS、virtual merge、Web、更多语言和生态必须由真实 consumer 激活，不得抢占该路径。精确 DAG 见 `implementation-dag.yaml`。

## 9. 未来内容和文档压缩

当前未来设计偏复杂且重复。综合 Spike 已产生约 42 个 proposal 文件和 1.7 万行以上内容。它们必须被吸收和退役，不能长期共存为 architecture/Skill/throughput 的多个“最终版本”。

正式文档规则：

- `docs/system-architecture.md` 保持唯一 architecture authority；Assembly 只是 generated/navigation projection，`owns: []`。
- 稳定含义进入唯一 domain doc；字段和算法进入代码合同；动态事实进入 machine registry；测量进入 Evidence；未决问题进入 Issue；历史进入 archive。
- 每个 proposal 必须有 canonical target、activation trigger、experimental Evidence、reject/reversal 或 retirement target。
- 没有真实 consumer，只记录 invariant、owner、trigger、proof、migration 和 retirement，不提前写完整实现规格。
- 迁入新 owner 时同步删除、归档或标记 superseded 的旧 active 表述。

详细处置见 `migration-and-retirement.md`。

## 10. 为什么不能叫“最终最优”

架构一致性不等于全局最优。只有具备下列证据，才允许升级该术语：

- 当前性能和失败基线；
- 代表性 workload corpus；
- 至少两个竞争方案的比较；
- 正确性与安全边界不退化；
- 多个真实 Work Package 的稳定结果；
- 文档和旧路径完成退役。

因此当前正式名称是 **Converged Architecture Baseline V1**。它是最完整的一致裁决候选，但仍允许被测量、反例和现实产品结果修正。

## 11. Phase A 完成条件

- PR #233 所有 P1/P2 对抗 finding 已修复并重新 Review；
- `constraints.yaml`、decision ledger、assembly projection、DAG 和 retirement plan 相互一致；
- 每项输入设计都有 disposition；
- 无 canonical authority、control plane 或产品能力修改；
- 正式 Phase B 只从 latest main 提炼 focused owner changes；
- 本 proposal 不整体合并，并在迁移结束后归档。
