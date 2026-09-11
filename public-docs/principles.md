# SEC 原则与为什么

本页把 SEC 已经散落在 canonical owner、代码合同、验证体系和工程治理中的高层思想，整理成**可解释的知识投影**。

它不是第二套 architecture authority。每条原则的精确产品语义仍由其 canonical owner 拥有；本页负责回答“为什么”。

## 如何判断一条原则是否合格

原则不能只是一句口号。至少要回答：

```text
Statement      原则是什么
Classification 它属于逻辑约束、经验事实、价值选择、外部规范还是工程 Evidence
Reality Basis  现实里什么问题使它存在
Mechanism      为什么这些事实推出这个原则
Scope          在什么边界成立
Non-goals      它没有声称什么
Counterexample 最强反例是什么
Reversal       什么条件会削弱、失效或反转它
Consequences   它进一步推出哪些规则
Owners         哪些 canonical owner 真正拥有下层语义
Enforcement    哪些机器机制最终应强制它
```

如果不能说明为什么成立，只能叫 heuristic / proposal，不能因为写在文档里就升级为 truth。

---

## 一、元原则

### M0 — 原则可证成、可追溯、可反驳

**原则**：任何 SEC 原则、规则、架构裁决或“最佳实践”都不得仅以结论形式存在；必须能够追溯到现实事实、逻辑约束、产品价值、外部规范、工程 Evidence 或明确授权决策。

**现实依据**：没有理由的规则无法判断适用范围，无法处理冲突，也不知道什么时候过时。

**机制**：

```text
Basis
→ mechanism
→ predicted consequence
→ principle
→ applicability
→ enforcement
```

**最强反例**：某些公理化定义本身就是系统选择，不需要经验论文证明。例如“SEC 选择 correctness 优先于 performance”主要是产品价值排序。

**反转条件**：不会因为某个具体技术变化而消失；但一条具体子原则的 basis 被推翻时必须重新裁决。

**结果**：Principle 页面必须记录依据类型、反例和反转条件。

---

### M1 — 原则作用域不能超过证据作用域

**原则**：一个实验、事故、平台限制或论文只支持它实际覆盖的对象、环境、版本和任务；不能自动推广成宇宙规律。

**现实依据**：软件系统具有版本、平台、配置和 workload 差异；同一机制在不同条件下可能反转。

**机制**：Evidence 必须绑定 subject / revision / environment / task / measurement；超出 closure 的结论只能是推断。

**反例**：形式逻辑恒真式不依赖运行环境。

**结果**：性能、Support、Provider compatibility、模型能力等结论必须显式 scope。

---

### M2 — 原则必须可修订，但不能被流行度随意改写

**原则**：依赖外部现实的原则应随决定性 Evidence 重新验证；没有新证据时不能因为新框架、新模型或流行趋势就切换。

**现实依据**：模型、语言、平台、法律、Provider 与硬件都会变化。

**机制**：稳定原则保存机制和边界；动态参数放 machine profile / Evidence。变化触发 revalidation，而不是手工改一句“现在推荐 X”。

**反例**：纯定义型规则无需周期性 benchmark。

**结果**：动态版本、SHA、PR、模型名不进入稳定原则 identity。

---

### M3 — 原则本身不能自我授权

**原则**：一条被标成 Principle 的句子不能因为这个标签就取得 canonical authority。

**现实依据**：否则 SEC 会犯与“AI confidence = truth”“文档 = reality”同构的错误。

**机制**：Principle projection 只解释和索引；下层规则仍由对应 canonical owner、machine contract 和 Evidence 决定。

**结果**：删除本页不能改变产品行为。

---

## 二、九条根原则

### R1 — Reality Primacy：现实高于叙事

**原则**：实际 canonical/physical state 高于聊天、计划、报告、UI 或历史描述。

**现实依据**：文件、Git、进程、Provider、Runtime 和外部系统会被并发修改、失败、漂移。

**机制**：任何 effectful operation 都必须在必要边界 readback；旧 observation 不能证明 current state。

**最强反例**：对纯数学对象，不存在外部物理漂移。

**派生**：current main、physical workspace、Runtime observation、Evidence identity、post-write readback。

**主要 owner**：`docs/system-architecture.md`、`docs/development-governance.md`、`docs/verification-governance.md`。

---

### R2 — Epistemic Separation：认识状态必须分离

**原则**：Fact、Assertion、Authority、Confidence、Evidence、Provenance、Unknown 不是一个概念。

**现实依据**：高 confidence 可能错；多个来源可能复制同一错误；没观察到不等于不存在。

**机制**：把“世界是什么”“谁声称什么”“为什么相信”“谁有定义权”建成不同对象。

**反例**：极小局部程序里可临时把它们编码在一个结构中，但语义仍必须可区分。

**主要 owner**：`docs/semantic-model.md`、`docs/verification-governance.md`。

---

### R3 — Canonical Authority：一个长期真值一个 owner

**原则**：同一可竞争语义不能长期由多个独立 authority/writer 同时拥有。

**现实依据**：两个 writer 一旦分歧，系统缺少内生规则判断谁是真值。

**机制**：

```text
one truth
→ one canonical owner
→ many projections / replicas
```

**反例**：两个状态如果拥有不同 identity、scope 或 lifecycle，则不是同一个 truth，可以并存。

**主要 owner**：`docs/system-architecture.md`。

---

### R4 — Identity & Revision：先知道“是谁”和“哪一版”

**原则**：名字、路径、顺序、时间和显示标签不能替代稳定 identity；任何会变化的状态必须有 revision/freshness。

**现实依据**：rename、move、reorder、cache 和并发修改都很常见。

**机制**：Identity 回答对象是谁；Revision 回答对象处于哪个状态；Evidence/Binding/Projection 都绑定相应 revision。

**反例**：一次性 ephemeral object 可以使用短生命周期物理 identity，但不能冒充长期 semantic identity。

**主要 owner**：`docs/semantic-model.md`、`docs/system-architecture.md`。

---

### R5 — Deterministic Validated Computation：可机械决定的结果必须可重复

**原则**：相同完整输入、规则、Provider revision 与声明环境应得到相同 canonical result。

**现实依据**：缓存、diff、replay、Verification、distributed execution 和审计都需要 reproducibility。

**机制**：raw → validate → canonicalize → deterministic ordering/tie-break → immutable result。

**反例**：随机算法、wall-clock、Runtime observation 可以不同，但随机种子/时间/环境必须成为显式输入或 Evidence。

**主要 owner**：`docs/semantic-model.md`、`docs/compiler-target-ir.md`、`docs/verification-governance.md`。

---

### R6 — Constraints Before Optimization：合法性先于优化

**原则**：correctness、安全、权限、合同、Target、数据完整性等 hard constraints 失败的候选不能靠性能、流行度或成本加权补回来。

**现实依据**：一个更快但错误、越权或不兼容的实现没有合法 utility。

**机制**：

```text
candidate closure
→ hard eligibility
→ only eligible candidates enter ranking
```

**反例**：多个都是合法候选时可以做多目标优化。

**主要 owner**：`docs/compiler-target-ir.md`、`docs/external-provider-policy.md`、`docs/semantic-mutation.md`。

---

### R7 — Bounded Transactional Change：副作用必须受限并有终态

**原则**：修改必须有明确 scope、precondition、effect、publication、readback 与 recovery terminal。

**现实依据**：crash、disk full、race、partial publication、network uncertainty 都是真实工程状态。

**机制**：

```text
plan
→ authorization
→ CAS / precondition
→ bounded effect
→ readback
→ accepted | rolled-back | recovery-required
```

**反例**：不可逆物理动作可能无法 rollback，但必须显式标 irreversible boundary，并提供 forward recovery。

**主要 owner**：`docs/semantic-mutation.md`、`docs/change-management.md`。

---

### R8 — Independent Verification：声明不能自证

**原则**：candidate、Provider 或 writer 不能同时定义成功标准、验证器和结果并用它给自己授权。

**现实依据**：被测对象若能修改 oracle，“PASS”就失去独立信息价值。

**机制**：Claim/selector/verifier/trust root 与 SUT/candidate 分层，正式 Evidence 绑定可信 producer。

**反例**：开发期自测可以作为 advisory Evidence，但不能升级为独立 merge/support authority。

**主要 owner**：`docs/verification-governance.md`。

---

### R9 — Finite Reasoning / Attention Economy：推理资源有限

**原则**：AI、人、CPU、I/O、工具调用、上下文和时间都是有限资源；机器能可靠确定的事实应由确定性机制生产和复用，模型只消费当前任务的最小充分投影并按需展开。

**现实依据**：重复扫描、重复解析、重复推理和巨大上下文都会增加成本；“能放进 context”不等于“没有检索与推理代价”。

**机制**：

```text
full canonical state
→ dependency / owner / impact query
→ minimum sufficient context
→ AI reasoning on unresolved frontier
→ exact expansion when needed
```

**最强反例**：开放探索阶段可能尚不知道哪些信息相关，此时过度裁剪会造成遗漏。

**反转条件**：模型 context 和 compute 成本下降会改变压缩强度，但“不要让昂贵主体反复做已可确定化工作”的机制仍然成立。

**主要 owner**：`docs/agent-and-user-machine-interface.md`、`docs/development-governance.md`。

---

## 三、事实与知识原则

### P01 — 当前现实优先于历史描述

**依据**：外部状态会变化。

**机制**：stale observation 只能说明历史，不能授权 current mutation。

**边界**：历史记录仍可作为 provenance 与事故 Evidence。

**派生**：resume、merge、mutation、Provider 状态都需 freshness/readback。

---

### P02 — Fact 必须绑定 scope 与 revision

**依据**：同一命题在不同版本、Target、Host 或环境下可能真假不同。

**机制**：没有 scope 的 Fact 会被错误推广。

**反例**：逻辑恒真式不需要运行时 revision。

**owner**：`docs/semantic-model.md`。

---

### P03 — Fact 与 Assertion 分离

**依据**：同一事实可以被多个来源独立声明，来源之间可能冲突。

**机制**：Fact 保存命题 identity；Assertion 保存 authority/confidence/provenance/evidence。

**反例**：只有一个永久内置 authority 的极小系统可以物理合并结构，但语义仍应可区分。

**owner**：`docs/semantic-model.md`。

---

### P04 — Authority 与 Confidence 分离

**依据**：推断非常自信仍不代表拥有定义权。

**机制**：confidence 只能描述认知强度；authority 决定谁能定义 canonical fact。

**反例**：同一 authority class 内可以用 confidence 排序候选观测。

**owner**：`docs/semantic-model.md`。

---

### P05 — Provenance 不能被聚合抹掉

**依据**：多个来源可能并不独立，可能复制同一个错误；last-write 也不证明更新值更正确。

**机制**：保留 Assertion/Evidence source，禁止 strongest-wins、majority-vote、last-write-wins 直接取代 authority policy。

**反例**：某些明确规定 quorum/consensus 的分布式协议可以把多数票作为 authority 机制，但那是显式协议，不是通用知识规则。

**owner**：`docs/semantic-model.md`、`docs/verification-governance.md`。

---

### P06 — Unknown / Ambiguous / Conflict / Opaque 是一等状态

**依据**：现实观察和静态分析不可能永远完整。

**机制**：缺少信息时保留不确定性，使后续 Impact、Verification 和 UI 能诚实扩大 frontier。

**反例**：在形式封闭且输入完备的纯函数里，可以不存在 unknown 分支。

**owner**：`docs/semantic-model.md`、`docs/brownfield-import.md`。

---

### P07 — “没发现”只有在 coverage 足够时才是负证据

**依据**：一个没有探测能力的工具看不到对象没有任何证明力。

**机制**：只有当 inventory/provider/verification 本应发现该事实时，absence 才能成为 Evidence；否则是 unknown。

**反例**：形式化枚举完整域后，遍历无结果可以证明不存在。

**owner**：`docs/semantic-model.md`、`docs/verification-governance.md`。

---

### P08 — Verification 只证明 exact Claim / Input / Environment

**依据**：测试结果依赖实现、输入、环境、Provider 和 revision。

**机制**：Evidence identity 绑定完整 closure；任何相关变化使旧结论 stale/invalidated。

**反例**：数学证明可覆盖无限输入域，但它仍只证明其形式化假设下的命题。

**owner**：`docs/verification-governance.md`。

---

## 四、Authority、Owner 与 Identity 原则

### P09 — 每个长期 truth 一个 canonical owner

**依据**：避免 competing truth。

**机制**：consumer 始终知道读哪里、改哪里；其他表示可重建。

**边界**：replica/cache 可以很多。

**owner**：`docs/system-architecture.md`。

---

### P10 — 每个 derived fact / state machine 一个 producer/owner

**依据**：两套独立算法会产生分歧和 invalidation 漂移。

**机制**：一个 producer 负责 derived identity、revision、freshness，多个 consumer 复用。

**反例**：独立 cross-check 可以存在，但它是 Verification/Evidence，不是第二 canonical producer。

**owner**：`docs/system-architecture.md`。

---

### P11 — 每个竞争 mutable state 一个 writer

**依据**：并发 writer 会造成 race、lost update、ABA 和 partial ordering 问题。

**机制**：single-writer 或通过 transaction/conflict proof 证明资源正交后并行。

**反例**：CRDT/consensus 等协议可以允许多 writer，但必须有明确 conflict semantics；不能靠“大家都写同一个 JSON”实现。

**owner**：`docs/system-architecture.md`、`docs/semantic-mutation.md`。

---

### P12 — Projection / Cache / UI / Artifact 不能反向取得 Authority

**依据**：这些表示可能过滤、聚合、延迟、损坏或为某读者定制。

**机制**：projection 从 canonical state 派生，可删除、可重建；修改必须回到 canonical Operation。

**反例**：如果某 UI 本身就是合法 canonical writer，它需要通过明确 Operation/Authority，而不是因为“这是 UI”获得权力。

**owner**：`docs/system-architecture.md`、`docs/agent-and-user-machine-interface.md`。

---

### P13 — 稳定 Identity 不依赖 Path / Name / Order / Wall-clock

**依据**：这些 presentation/physical attributes 会变。

**机制**：semantic identity 与 physical binding 分离；rename/move 不等于语义对象死亡。

**反例**：某些 Artifact identity 可以明确包含 path/content，但不能冒充 Engineering Semantic identity。

**owner**：`docs/semantic-model.md`、`docs/system-architecture.md`。

---

### P14 — Derived State 必须有 Freshness / Invalidation

**依据**：上游变化后旧 cache、Impact、Binding、Evidence 可能错误。

**机制**：derived result 记录 input/revision closure；任何 relevant input 变化精确失效。

**反例**：真正 immutable content-addressed result 在输入 identity 不变时可永久复用。

**owner**：多个 domain owner；具体 invalidation 由各生产者拥有。

---

### P15 — 跨领域关系必须用 Stable Reference，不靠名字相似

**依据**：同名、相邻路径、相同 label 都不证明语义关系。

**机制**：显式 typed identity reference + validator。

**反例**：Parser 可以从 source name 观察候选关系，但必须经过 owning reconciliation 才能变成 canonical relation。

**owner**：`docs/system-architecture.md`。

---

## 五、计算、推导与实现原则

### P16 — Raw / Untrusted 与 Validated / Frozen 分层

**依据**：Parser、Provider、AI、文件和网络输入都可能错误或被污染。

**机制**：

```text
raw
→ schema/semantic validation
→ canonicalization
→ immutable validated boundary
→ trusted consumer
```

**反例**：内部 pure function 已经只接受 branded validated type 时不必重复 validate。

**owner**：`docs/semantic-model.md`、各 domain contract。

---

### P17 — Semantic Contract 与 Implementation 分离

**依据**：一个行为通常有多个实现；实现技术会变化，但产品语义可能稳定。

**机制**：先定义“必须满足什么”，再解析“由谁、怎样实现”。

**反例**：某能力若本质就是指定实现技术，例如用户明确 pin 某 Provider，则实现选择成为显式 constraint，但仍不能绕过 eligibility。

**owner**：`docs/semantic-model.md`、`docs/implementation-architecture/model-and-boundaries.md`、`docs/compiler-target-ir.md`。

---

### P18 — Hard Constraints 不能被 Soft Optimization 抵消

**依据**：错误/越权候选没有合法优化空间。

**机制**：eligibility first, ranking second。

**反例**：合法候选之间可以按性能、成本、existing-stack 等 policy 排序。

**owner**：`docs/compiler-target-ir.md`。

---

### P19 — 不存在脱离完整上下文的“宇宙唯一最优实现”

**依据**：Target、Host、license、security、maintenance、performance、existing stack 和用户 constraint 会改变最优解。

**机制**：最优只在冻结 requirement + policy + evidence + environment 下有意义。

**反例**：某些局部问题可能有数学 dominance 解，但仍需要证明其适用条件。

**owner**：`docs/compiler-target-ir.md`。

---

### P20 — 冻结完整输入后，Decision / Binding / Output 必须 Deterministic

**依据**：避免枚举顺序、Map insertion、locale 或 filesystem 顺序导致实现漂移。

**机制**：stable key、canonical ordering、deterministic tie-break。

**反例**：显式随机策略必须把 seed/policy 纳入输入。

**owner**：`docs/compiler-target-ir.md`。

---

### P21 — Downstream 只能消费 Upstream 冻结结果，不能重新解释

**依据**：如果 Backend、Runtime、CLI projection、Adapter 都重新选实现，会出现多个隐式 Resolver。

**机制**：typed frozen output 逐层 lowering；下层不能回头重定义上层语义。

**反例**：发现 input stale 时可以 invalidated 并回到 owning upstream 重算，不是 downstream silent fallback。

**owner**：`docs/compiler-target-ir.md`、`docs/runtime-and-distribution.md`。

---

### P22 — Predicted 与 Actual 必须分离

**依据**：Plan 时只能预测 Impact/Delta；执行中可能出现新事实、race 或 Provider failure。

**机制**：apply 前有 predicted result，apply/readback 后重新计算 actual result，并比较偏差。

**反例**：纯函数、immutable input 下 predicted 与 actual 可以结构相同，但仍是不同阶段身份。

**owner**：`docs/delta-and-impact.md`、`docs/semantic-mutation.md`。

---

## 六、权限、修改与恢复原则

### P23 — Authorization 是多个边界的交集

**依据**：caller 有权限不代表可以改任意 target；path 可写也不代表语义允许。

**机制**：

```text
caller capability
∩ operation
∩ semantic target
∩ canonical owner
∩ writable path/region
∩ policy
∩ effect
∩ provider capability
∩ verification requirement
∩ current revision
```

任一必要项 unknown/forbidden 都不能被其他权限覆盖。

**owner**：`docs/semantic-mutation.md`。

---

### P24 — Plan / Dry-run 与 Apply 必须分离

**依据**：边规划边写会让 Review、Impact 和 rollback 失去稳定对象。

**机制**：Plan 只读并确定 desired transition；Apply 独立授权。

**反例**：纯只读查询没有 Apply 阶段。

**owner**：`docs/semantic-mutation.md`。

---

### P25 — Effect 前必须重读 Live State 并 CAS / Re-plan

**依据**：TOCTOU、并发用户修改和 Provider drift 真实存在。

**机制**：Plan 绑定 precondition/revision；Apply 时不一致则 stale/replan，不把旧计划硬写到新世界。

**反例**：完全 immutable target 不需要 CAS，但必须证明 immutable。

**owner**：`docs/semantic-mutation.md`。

---

### P26 — 产品事务没有“半成功但算完成”

**依据**：partial publication 会产生不同 consumer 看见不同真相。

**机制**：terminal 至少区分 accepted / rejected / rolled-back / recovery-required；不确定不能投影 completed。

**反例**：分布式 saga 可以分阶段成功，但每阶段必须有明确 durable state，不能把中间态冒充全局完成。

**owner**：`docs/semantic-mutation.md`、`docs/change-management.md`。

---

### P27 — Publication 不确定时必须保持不确定

**依据**：process exit 0、syscall return、API 200 都不一定证明 durable readback。

**机制**：写后重新观察 exact target；无法确认进入 recovery-required / unknown。

**反例**：某些纯内存单线程操作的 publication 与计算是同一原子步骤。

**owner**：`docs/semantic-mutation.md`、Runtime/Release owning contracts。

---

### P28 — Unknown Effect / Stale / Ambiguous 在需要安全证明时 Fail Closed

**依据**：错误放行可能产生不可逆变化或伪造 PASS。

**机制**：安全性、authority、data-integrity 所需事实 unknown 时阻断；非关键只读展示可显式 degraded。

**反例**：fail-open 可能是某些高可用业务的明确产品策略，但必须由 owning policy 显式选择，不能由基础设施擅自决定。

**owner**：`docs/semantic-mutation.md`、`docs/verification-governance.md`。

---

## 七、Verification 与成熟度原则

### P29 — Candidate 不得自证

**依据**：自定义 oracle 可以让任何 candidate PASS。

**机制**：trusted base、independent verifier、external oracle 或不可被 candidate 改写的 authority。

**反例**：candidate 单元测试可作为开发反馈，但不是独立授权 Evidence。

**owner**：`docs/verification-governance.md`。

---

### P30 — 能力成熟度不得跳级

**依据**：文档、代码、测试、部署和真实 adoption 是不同事实。

**机制**：至少区分 proposed / accepted / specified / implemented / verified / enforced / adopted / retired，并允许 regressed。

**反例**：极小内部工具可合并某些阶段，但不能因此宣称未经 Evidence 的阶段已成立。

**owner**：Roadmap + architecture maturity machine owner；公共文档只投影。

---

### P31 — Compatibility 不能由表面相似推出

**依据**：同 API、类型检查、semver 或绿色测试仍可能改变 timeout、retry、error、Effect、wire schema 或 data semantics。

**机制**：Compatibility Decision 消费 exact old/new contract、Binding Delta、migration capability 与 Evidence。

**反例**：形式等价证明可以直接证明某类 compatibility，但仍要说明证明覆盖的维度。

**owner**：`docs/change-management.md`。

---

## 八、演进与复杂度原则

### P32 — 新 Owner 接管旧 Owner 必须 Shadow → Parity → Cutover → Retire

**依据**：长期 dual writer 会重新形成第二 authority。

**机制**：新路径先只产 Evidence；证明 parity 后切换 consumer；最后 old consumer-zero 并删除旧 writer。

**反例**：灾备 replica 可长期存在，但它不能与 primary 同时独立决定 canonical state。

**owner**：`docs/change-management.md`、各迁移 domain。

---

### P33 — Incremental / Cache 只是优化，Clean / Reference 是语义裁判

**依据**：cache 会丢、坏、stale；incremental selector 可能漏 dependency。

**机制**：cache off/cold/warm/corrupt 与 incremental/full 需要等价或有明确允许差异；cache absence 只能损失速度。

**反例**：如果系统定义的唯一正式计算本身就是增量状态机，则需要另一个独立 reference/spec oracle；仍不能让 cache 状态成为未经验证的 truth。

**owner**：Compiler、Verification、Development 各 owning contract。

---

### P34 — 没有真实 Producer / Consumer，不物理建设抽象宇宙

**依据**：没有 consumer 时无法验证 schema、边界和 lifecycle 是否合理，容易过度设计。

**机制**：可以记录 proposal/deferred(trigger)，只有真实 use case 才建立最小 typed object。

**反例**：标准化公共协议有时需要先定义接口再等生态 consumer，但这也是明确产品战略和外部 contract，不是“可能以后有用”。

**owner**：`docs/roadmap/capability-dag.md`、`docs/system-architecture.md`。

---

### P35 — Wheel-first，但不 Wheel-owned

**依据**：Git、TypeScript、Prettier、成熟 parser/DB/toolchain 已经解决大量机械问题；重复自研扩大 bug、性能和维护面积。

**机制**：SEC 保留 semantic contract / identity / authority / lifecycle；第三方 Provider 只实现机械 capability，经 Adapter/Conformance 隔离。

**最强反例**：外部轮子缺少安全性、license、性能、平台或真实能力时，自研可能更合理；但必须由 Evidence 证明，而不是“我们喜欢自己写”。

**owner**：`docs/external-provider-policy.md`。

---

## 九、AI 与信息治理原则

### P36 — AI 是 Bounded Proposer，不是 Truth Authority

**依据**：模型是概率系统，输出受模型、提示、上下文和采样影响。

**机制**：AI 负责 proposal / reasoning；平台重新 validate、resolve、authorize、apply、verify。

**反例**：纯创作、非治理任务可以直接使用模型输出；一旦输出要成为 canonical engineering state，必须进入正式 Operation。

**owner**：`docs/agent-and-user-machine-interface.md`。

---

### P37 — Canonical Truth 必须 Full-fidelity，不为 Prompt 有损降级

**依据**：完整工程模型服务整个生命周期，而 Prompt 只服务一次任务；两个目标函数不同。

**机制**：

```text
full canonical state
→ task-specific projection
→ model context
```

禁止把一次自然语言摘要反向覆盖完整 canonical state。

**反例**：canonical representation 本身可以做无损规范化、dedup、content-addressing；禁止的是丢失会改变工程语义的信息。

**owner**：`docs/semantic-model.md`、`docs/agent-and-user-machine-interface.md`。

---

### P38 — Context Compression 的目标是 Decision-preserving，不是“看起来语义相似”

**依据**：一个摘要可以整体意思接近，却删掉唯一会改变 eligibility、permission 或 failure 的异常条件。

**机制**：只有删除后不会改变 candidate set、hard constraints、authority、Impact、Verification、unknown frontier 或 final decision 的信息，才能对该任务视为冗余。

**反例**：开放探索任务尚未知道什么会影响结论，需要更保守的初始 coverage。

**owner**：`docs/agent-and-user-machine-interface.md`。

---

### P39 — Progressive Disclosure：最小充分起步，沿 Unresolved Frontier 展开

**依据**：全仓一次性输入会增加检索和定位工作；过度裁剪又会遗漏关键边界。

**机制**：

```text
minimal sufficient packet
→ unresolved refs
→ exact expansion
→ recompute
```

security、authority、must-preserve 等 mandatory context 不能等待模型自己想到后才补。

**反例**：非常小的工程可以一次加载完整上下文，仍然不违反原则，因为“完整”本身就是最小充分。

**owner**：`docs/agent-and-user-machine-interface.md`。

---

### P40 — Externalize Deterministic Cognition：可机械认知不反复消耗 AI

**依据**：dependency closure、owner resolution、schema validation、test selection、Git identity 等都可以由确定性程序更稳定地产生。

**机制**：

```text
machine computes
→ stable identity / receipt
→ AI consumes result
```

而不是让模型每次从原始源码重新猜。

**反例**：机器算法 coverage 不完整时，AI 可以作为补充分析，但输出仍是 Evidence/proposal，不升级为 canonical truth。

**owner**：`docs/development-governance.md`、`docs/agent-and-user-machine-interface.md`。

---

### P41 — Context Coverage 必须显式；“给了一些相关信息”不等于“充分”

**依据**：过度压缩最危险的不是文字少，而是系统不知道删掉了什么重要事实。

**机制**：Context Packet 最终应能够投影 required / present / missing / stale / unknown / intentionally omitted，并绑定其 coverage source。

**反例**：完全封闭且输入固定的小任务可隐式知道 coverage，但跨仓库/跨 Provider/跨 runtime 的任务不应依赖这种假设。

**owner**：`docs/agent-and-user-machine-interface.md`、相关 Impact/Verification owner。

---

## 十、这些原则怎样落到工程，而不是停在文档

原则本身不是完成状态。

完整链条应该是：

```text
现实 / Evidence / 产品目标
        ↓
Principle rationale
        ↓
Canonical domain rule
        ↓
Type / Schema / Validator / Algorithm / State Machine
        ↓
Negative / Property / Physical Verification
        ↓
Enforcement
        ↓
Real Consumer Adoption
        ↓
Old Path Retirement
```

所以以后看到一句“SEC 原则是 X”，应该继续追问：

1. X 的 basis 是什么？
2. 哪个 canonical owner 真正拥有下层规则？
3. 哪些路径已经 machine enforce？
4. 哪些只是 specified？
5. 什么 Evidence 能推翻或削弱它？

只有这样，原则才是工程知识，而不是口号。
