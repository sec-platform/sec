# SEC 原则与为什么

本页是 canonical owner 的**公共解释投影**，不是第二套 Architecture Authority。每条原则只保留现实依据、机制、失败模式、反转条件和当前 owner；精确字段、算法、状态机与 Evidence 仍回到对应 `docs/**` owner。

## P01 — 结果高于实现

**原则**：先冻结用户可观察 outcome/non-goal，再比较实现。

**机制**：当前路径、框架、代码量和历史投入都只是候选约束；只有 accepted outcome 能决定它们是否值得保留。

**最强反例**：某实现不可替代地承载外部/持久兼容合同。此时它由该合同而不是“已经写了很多”获得保留资格。

**owner**：`docs/product.md`、`docs/design-calculus.md`。

## P02 — Truth、Decision、Authorization、Evidence 分型

**原则**：观察到什么、决定什么、允许做什么、证明了什么不能互相冒充。

**机制**：不同 statement kind 有独立 issuer、consumer、freshness 与 failure semantics。

**失败**：把 exit code、AI 建议、管理员权限或 PR 状态直接升级成产品 truth。

**owner**：`docs/design-calculus.md`、`docs/system-architecture.md`、`docs/verification-governance.md`。

## P03 — Semantic Identity 不等于 Address

**原则**：同一语义对象移动文件、改标题、换 Provider、换进程时仍是同一 identity；同一路径发生 ABA 替换时必须是不同 physical binding。

**机制**：Subject/Document/Clause 等 stable ref 与 path/heading/PID/version label 分域。

**owner**：`docs/system-architecture/lifecycle-proof-and-evolution.md`、`docs/documentation-system/reference-and-identity.md`。

## P04 — 一个 meaning 一个 owner

**原则**：每项不可重算 meaning、writer、parser、resolver、linearization point 只有一个 active owner。

**机制**：其他模块只引用 owner result；projection、test、Roadmap、cache 与 interface 不复制定义。

**失败**：两个 validator 各自“差不多”实现同一规则，最终一个拒绝、一个通过。

**owner**：`docs/engineering-constitution.md`、`docs/system-architecture.md`。

## P05 — Unknown 是一等状态

**原则**：未观察、能力不足、超预算、动态/opaque、冲突都不能降成 false/absent/success。

**机制**：unknown 携 affected closure 与 closure predicate；新信息只关闭相关 frontier。

**owner**：`docs/engineering-constitution.md`、`docs/system-architecture/operations-and-resources.md`。

## P06 — Pure Plan 与 Live Admission 分离

**原则**：计划描述“应做什么”；Grant、Provider、Allocation、deadline、physical preimage 描述“现在能否这样执行”。

**机制**：live 条件变化只重新 admission；只有 immutable semantic/source inputs 改变才重新 plan。

**现实收益**：credential refresh、Provider restart、resource rebalance 不再让 Delta/plan/设计全部失效。

**owner**：`docs/system-architecture/operations-and-resources.md`、`docs/semantic-mutation/planning-and-admission.md`。

## P07 — Effect 前必须有 prepared intent

**原则**：不可逆/持久 Effect 前先记录 exact intent、preimage、authority、binding、allocation 与 recovery obligation。

**机制**：lost handle 或响应丢失后靠 readback/journal 收敛，而不是盲重发。

**owner**：`docs/semantic-mutation.md`、`docs/implementation-architecture/execution-and-materialization.md`。

## P08 — Resource 先分 accounting mode

**原则**：CPU time、lock、memory、rate-limit、external quota 不是一种资源状态机。

**机制**：`Consumable | Lease | Gauge | ReplenishingRate | ExternalQuota` 各自拥有 reserve/measure/release/settle law。

**失败**：把 process slot 当不可返还累计消耗，或把 peak memory 当 reservation。

**owner**：`docs/system-architecture/resource-accounting.md`。

## P09 — ActionKey 只绑定实际因果输入

**原则**：局部计算 identity 由实际 reachable semantic/content/config/provider closure 决定，而不是“它恰好属于哪个全局 generation”。

**机制**：global generation 默认只进入 provenance；无关 sibling 变化保持 ActionKey 与结果不变。

**失败**：一篇无关文档或一个无关文件变化导致全仓 cache miss。

**owner**：`docs/system-architecture/derivation-locality.md`。

## P10 — Eliminate → Reuse → Incremental → Parallel → Faster

**原则**：先删不必要工作，再复用 exact result，再增量，再并行，最后才优化单次机制。

**机制**：重复 scanner、第二 truth、机械全测通常比“换更快语言”更先成为瓶颈。

**owner**：`docs/engineering-constitution/proof-and-evolution.md`。

## P11 — One snapshot, shared facts

**原则**：同一 exact workspace view 只生产一套 canonical language/source facts；typecheck、Impact、audit、architecture、Agent query 消费同一 shards。

**机制**：frontend/provider只拥有其能证明的 fact kinds；consumer 不重复建 AST/resolver/cache truth。

**owner**：`docs/implementation-architecture/source-observation-and-incrementality.md`、`docs/brownfield-import.md`。

## P12 — Overlay observation 与 writeback 必须对齐

**原则**：如果 effective source 是 unsaved editor buffer，而 writer 只能改 disk，不能直接把 editor 语义计划覆盖到 disk preimage。

**机制**：`WritableSourceLayerBinding` 明确 observed layer、writable layer、preimage 与 reconciliation policy。

**owner**：`docs/semantic-mutation/planning-and-admission.md`。

## P13 — Hard Constraint 不能被软分抵消

**原则**：identity、authority、security、data integrity、required semantics 等 hard failure 一项即可拒绝。

**机制**：soft preference 只比较全部 hard-valid 的候选。

**owner**：`docs/design-calculus/constraints-and-decision.md`、`docs/compiler-target-ir.md`。

## P14 — Claim 不都能变成 Decidable Constraint

**原则**：Temporal、Statistical、Robustness、Relational Claim 需要各自 proof obligation；不能为了自动化谎称所有现实性质都可判定。

**机制**：Claim lowering 到 decidable constraint、bounded model check、measurement、statistical evidence、relational trace 或 bounded frontier。

**owner**：`docs/design-calculus/constraints-and-decision.md`、`docs/verification-governance.md`。

## P15 — Cost 是有量纲向量

**原则**：50ms、3 个文件、2 个 owner、10KB 不能直接相加。

**机制**：候选使用带 unit/provenance/uncertainty 的 LifecycleCostVector，默认 Pareto；只有有权 policy 才 scalarize。

**owner**：`docs/design-calculus/constraints-and-decision.md`。

## P16 — Responsibility-first Placement

**原则**：源码/package 边界来自 Responsibility、state/effect/lifecycle、visibility、trust、co-change，而不是行数、团队或品牌。

**机制**：地址、import/export/test/docs 都从 placement graph 派生；常规单责任变化尽量只修改一个不可推导 owner point。

**owner**：`docs/implementation-architecture/placement-and-locality.md`。

## P17 — Capability 语义与实现载体分离

**原则**：Capability/Contract 说明“需要什么”；Port/Requirement/Candidate/Binding 说明“如何连接和实现”；Distribution Package 只在真实分发生命周期存在时出现。

**机制**：旧 `Block/Slot` 可以作为 current migration input，但不能重新成为 target canonical primitive。

**反例**：用户明确要求某特定实现技术时，它进入 Requirement/Constraint/Preference；仍不能绕过 hard eligibility。

**owner**：`docs/semantic-model.md`、`docs/implementation-architecture/model-and-boundaries.md`、`docs/compiler-target-ir.md`、`docs/runtime-and-distribution/distribution-and-support.md`。

## P18 — Provider 供应能力，不拥有业务 truth

**原则**：外部 compiler、SDK、MCP、container、cloud service 可以供应 Provision/Evidence，不能因为执行成功取得 SEC Definition、Resolution、Verification 或 Support authority。

**机制**：physical adoption → semantic session → domain operation → independent readback。

**owner**：`docs/external-provider-policy.md`。

## P19 — Brownfield 是 Candidate/Evidence 支线，不是 Target 前置

**原则**：Target Profile / Type Algebra 可以独立定义；Brownfield/Provider adoption 给 Resolution 提供候选和校准 Evidence。

**机制**：Capability edge 分为 hard prerequisite、SuppliesCandidate、RequiresEvidence、CalibratedBy 等。

**owner**：`docs/roadmap/capability-relations.md`、`docs/brownfield-import.md`、`docs/compiler-target-ir.md`。

## P20 — Roadmap 不复制领域本体

**原则**：Roadmap 只保存 capability identity、typed capability relations、entry/exit/reversal refs。

**机制**：Claim/Gate/Result、Grant、Resource、Mutation、Provider 等内部拓扑回到 owner；owner 模型变化不要求同步改 Roadmap prose。

**owner**：`docs/roadmap/capability-dag.md`。

## P21 — Implementation Admission 是独立 Gate

**原则**：DesignClosed 不等于现在可以写代码。

**机制**：`ImplementationWorkAdmitted` 组合 design、target implementation、current observation、owner/change-locality、Scope、Capability、Resource、Evolution、Verification 与 MainHealth refs。

**owner**：`docs/development-governance/implementation-admission.md`。

## P22 — Universal Law 与 Project Adoption 分离

**原则**：Product 可以决定 SEC 采用某个 Engineering/Agent/Design law revision，但不因此拥有该 universal law 的定义。

**机制**：Authority Root 分为 UniversalLaw、ProjectLawAdoption、ProductOutcome、DomainDefinition、RepositoryGovernance、ExternalAuthority、CompoundIssuer。

**owner**：`docs/system-architecture/authority-roots.md`。

## P23 — Delegation 按 mode 判定

**原则**：只读分析、实现写入、独立 Review、外部 Observation 的 independence 条件不同。

**机制**：共同保证 child authority 不扩大、输入输出/资源有界；write overlap/producer independence按 mode 单独判断。

**owner**：`docs/agent-constitution/delegation-modes.md`。

## P24 — Projection 不能创造 meaning

**原则**：README、public-docs、UI、图、Agent context、report、cache 都只能投影已存在的 refs。

**机制**：canonical locator 与 Markdown fragment 都必须解析；正文不能形成绕过 manifest 的第二引用通道。

**owner**：`docs/documentation-system.md`、`docs/documentation-system/reference-and-identity.md`。

## P25 — Heading/Path 不决定 Clause Identity

**原则**：翻译标题、reparent、拆目录只是 Address/Presentation 变化；稳定规则 identity 使用显式 ClauseRef。

**机制**：`sec-clause` 可携稳定 `id`；heading-derived identity只作为 legacy migration carrier。

**owner**：`docs/documentation-system/reference-and-identity.md`。

## P26 — Public 文档必须随 canonical owner 原子切换

**原则**：删除/迁移 canonical owner 后，public manifest、正文 refs、index 与链接必须同 generation更新；不能继续教旧本体。

**机制**：projection scanner同时验证 manifest refs、正文 canonical refs、target fragments。

**owner**：`docs/documentation-system/reference-and-identity.md`。

## P27 — Verification 不等于命令成功

**原则**：green command ≠ Result PASS ≠ Claim PASS ≠ Merge/Release/Support decision。

**机制**：Claim/Gate identity、applicability、environment、execution/reuse、settlement/readback、Evidence independence、aggregate必须逐层成立。

**owner**：`docs/verification-governance.md`。

## P28 — Producer 不能充分自证

**原则**：candidate 不能选择/修改 verifier 后用结果给自己授权；producer report 也不能直接成为独立 Review。

**机制**：trusted base/independent owner 决定 Claim、selector、Review 与 merge admission。

**owner**：`docs/verification-governance/evidence-and-integration.md`。

## P29 — Same input deterministic failure 也应复用

**原则**：复用不是只复用 PASS；完全相同 causal input 下的 deterministic failure 重跑没有新增信息。

**机制**：retry 需要 observable cause/input/admission 变化；started-without-terminal先 readback/join/recover。

**owner**：`docs/verification-governance/execution-and-session.md`、`docs/agent-constitution/execution-and-recovery.md`。

## P30 — Version 只服务真实双态 consumer

**原则**：数字、Vn 后缀、fixture、API 名称不会自动产生 version semantics。

**机制**：只有 durable/external grammar 或 rolling support 真有多个可观察状态且 reader/migration实际分支时才保留 version；最后一个旧 consumer 退役时 old parser/tests 同批删除。

**owner**：`docs/change-management.md`、`docs/engineering-constitution/operation-runtime.md`。

## P31 — Compatibility 不是 Boolean

**原则**：source/binary/schema/wire/behavior/semantic、backward/forward、read/write/execute、environment/deployment 都可能独立兼容或不兼容。

**机制**：Compatibility Decision 消费 exact Delta、consumer、adapter、deployment、unknown，不由 semver 或 green tests决定。

**owner**：`docs/change-management.md`。

## P32 — 一次语义时刻只有一个 active generation

**原则**：proposal/history 可以多代并存，正常 writer/parser/resolver 对同 identity 只能一个 active generation。

**机制**：shadow compare → independent validation → atomic cutover → old consumer-zero → retirement。

**owner**：`docs/system-architecture/lifecycle-proof-and-evolution.md`、`docs/change-management.md`。

## P33 — Future Obligation 不等于 Active 空壳

**原则**：已接受但未激活的未来能力保留为带 issuer/trigger/reversal/expiry 的 obligation，不物化空 package、facade、version、runtime。

**owner**：`docs/design-calculus/freeze-and-evolution.md`、`docs/change-management.md`。

## P34 — 新信息只局部失效

**原则**：发现缺失事实 x 时，只给真正依赖 x 的 closure 增 typed edge，并 invalidates `reverseReachable(x)`。

**禁止**：给全部 ActionKey/文档/设计加一个 globalXRevision，迫使全仓重算。

**owner**：`docs/system-architecture/derivation-locality.md`。

## P35 — 新实例扩 Binding，不扩 Core

**原则**：新语言、新 Provider、新数据库、新 OS、新部署形态默认只是新 Requirement/Provision/Binding/Target profile 实例。

**反转条件**：出现现有 algebra 无法表达、且具有新的独立 admission/authority/lifecycle/failure semantics 的真实需求。

**owner**：`docs/engineering-constitution.md`、`docs/compiler-target-ir.md`。

## P36 — 外部 Effect 丢响应只 Readback

**原则**：网络/Provider 响应丢失不能证明没执行；重复调用可能制造双 Effect。

**机制**：OperationKey + journal + provider/domain readback → applied / not-applied / partial/unknown。

**owner**：`docs/implementation-architecture/execution-and-materialization.md`。

## P37 — Cleanup 失败不抹掉主失败

**原则**：primary failure 与 cleanup/residue分别保留；cleanup unknown 不能把 operation 投影成成功或完全失败后可安全重试。

**owner**：`docs/engineering-constitution/operation-runtime.md`、`docs/verification-governance.md`。

## P38 — Human/AI Context 是 Projection

**原则**：聊天摘要、memory、README、Skill、Context Packet 只能定位 canonical refs；context loss 后重新绑定 durable/live facts。

**owner**：`docs/agent-constitution.md`、`docs/agent-and-user-machine-interface.md`。

## P39 — Skill 只保留不可机器化 frontier

**原则**：可由 exact inputs 决定的规则迁入 type/schema/compiler/gate；Skill 只保留暂不可计算的判断程序，并有 trigger/stop/reversal。

**owner**：`docs/agent-constitution/execution-and-recovery.md`、`docs/development-governance.md`。

## P40 — 反例要修根模型，不是追加 patch

**原则**：新 counterexample 先最小化 property trace，再定位所有必要因果边界；若根前提错，使 reverse closure stale 并重新合成系统方案。

**owner**：`docs/design-calculus/compilation.md`、`docs/agent-constitution/self-correction.md`。

## P41 — Current、Target、Evidence、Terminal 必须分开说

**原则**：设计冻结不等于实现，代码存在不等于 verified，PASS不等于merge，merge不等于deployment/support。

**机制**：每层 statement kind/identity/owner 独立。

**owner**：`docs/agent-constitution.md`、`docs/verification-governance.md`。

## P42 — “完美”定义为局部可演进，不是预知未来

**原则**：无法预先知道所有语言、Provider、故障、法律和用户需求；可追求的是：未知以 typed frontier存在，新信息通过新 fact/edge/variant/binding进入，只让实际依赖闭包变化。

**验收**：未来新增一个独立事实通常只需要：

```text
new typed fact / relation / binding
→ existing owner/compiler consumes it
→ reverse-reachable closure stale
→ unaffected identities/ActionKeys/projections remain byte-stable
```

只有新事实证明现有 algebra 缺少不可替代语义时，才演进 root model，并通过 explicit migration 保留旧 expressible subset。

**owner**：`docs/design-calculus.md`、`docs/system-architecture/derivation-locality.md`、`docs/documentation-system/reference-and-identity.md`。
