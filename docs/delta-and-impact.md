---
title: Fact Delta 与 Impact
status: stable
domain: delta-and-impact
last-reviewed: 2026-07-29
---

# Fact Delta 与 Impact

本文拥有 canonical semantic change、影响传播、certainty、unknown frontier 与 Verification recommendation 的稳定含义。精确 union、diagnostic、rule registry、canonical ordering 和 revision payload由 `platform/shared/engineering-ir/delta-types.ts`、Compiler producers及合同测试拥有。

## 不同变化对象

以下对象必须分离：

- **Authoring Delta**：Contract、Plan、Manifest、Policy、Source bytes 等输入变化；
- **Entity Delta**：canonical Entity identity、kind、attributes 或 lifecycle变化；
- **Fact Delta**：Fact triple和Assertions变化；
- **Semantic Impact**：canonical变化可能影响的semantic consumers和Acceptance；
- **Repository/Test Impact**：source/artifact/Gate/test文件与physical owner传播；
- **Artifact Delta**：生成文件、配置、package和release bytes变化；
- **Runtime Observation Delta**：特定环境下观察结果变化；
- **Verification Result**：是否满足某个exact requirement。

它们可以通过stable references连接，但不能把其中一个对象改名为另一个。Changed files不是Fact Delta；planned Impact不是actual Delta；测试绿也不证明Delta符合intent。

## Fact Delta 身份

Fact Delta比较两个transaction-referenced、独立validated semantic endpoints：

```text
from semantic snapshot/revision
→ deterministic comparison
→ to semantic snapshot/revision
```

Delta identity至少绑定from/to graph/app/semantic revisions、comparator contract revision和canonical payload digest。它不绑定branch、PR、UI排序、wall-clock或运行进程。

Producer必须验证两端属于可比较lineage和相同semantic format/app identity；无法证明lineage时拒绝，不按显示名、路径或相似度匹配对象。

## Canonical Fact / Assertion 变化

- 新triple：Fact added；
- 消失triple：Fact removed；
- subject/predicate/object变化：旧Fact removed + 新Fact added；
- 新来源/authority/provenance claim：Assertion added；
- claim撤销或有效区间终止：Assertion removed或明确validity transition；
- 同一Assertion identity的confidence、evidence references或允许更新字段变化：Assertion updated；
- canonical payload完全相同：retained，不产生变化项。

Fact identity不包含authority/confidence/provenance；因此这些变化不能伪装成新triple。反之，object value或target Entity变化必须形成新Fact，不能只改Assertion。

Entity-only变化允许Fact Delta为空。空Fact Delta只表示Fact/Assertion集合未变，不表示Entity、Artifact、Repository、UI、performance或runtime无变化。

## Delta Producer 不变量

Producer必须：

- 只接受validated、deep-frozen endpoints；
- 保留明确from→to方向；
- 不修改、修复或重新normalize输入；
- 对Fact/Assertion identity collision、duplicate和non-canonical order fail closed；
- 对集合变化使用stable identity比较，对有序值保留顺序语义；
- 输出sorted unique、deep-frozen、byte-stable结果；
- 保留provenance到两端对象和transaction/candidate；
- 对unsupported format或rule revision返回diagnostic，不生成空Delta。

Mutation request、AI proposal、Workbench、Review和test selector不能提交或覆盖actual Delta。它们只能声明expectation或消费canonical producer结果。

## Expectation 与 Actual Delta

Mutation计划可以包含预期变化，例如required/forbidden Fact或允许的additional changes。Actual Delta只有在isolated canonical rebuild后由统一producer计算。

判定至少区分：

- exact expected change出现；
- required change缺失；
- forbidden change出现；
- 额外变化在显式allowance内；
- unexplained additional change；
- from/to lineage或source mapping失效。

Unexplained additional change默认阻止发布。不能因为测试通过、文本diff较小或AI称其合理而忽略。

## Impact 输入与输出

Semantic Impact同时消费：

- canonical Delta；
- from/to validated graphs；
- versioned propagation rule registry；
- optional Target/Profile/Repository cross-domain references；
- explicit uncertainty和scope policy。

输出至少表达：

- seed change；
- direct和transitive occurrences；
- impacted Entity/Fact/Responsibility/Scenario/Acceptance；
- certainty与reason；
- canonical witness path；
- unknown frontier和停止原因；
- Verification recommendations；
- rule/graph revisions与completeness diagnostics。

Impact是保守静态推导，不是运行结果或业务风险分数。

## Rule Registry

每种可传播predicate/relationship只有一个版本化规则owner。规则声明：

- 适用change kinds；
- from/to endpoint选择；
- traversal direction；
- subject/object kinds和conditions；
- certainty transformation；
- boundary/stop条件；
- Verification mapping或无mapping；
- negative和cycle tests。

Predicate signature只定义合法shape，不拥有Impact方向。UI edge direction、源码调用方向和semantic dependency方向可能不同，不能按名称猜测。

未注册active predicate、unsupported object、missing reference或rule conflict形成unknown frontier；不得默认为不传播。

## Addition、Removal 与 Update

- Addition主要在新端传播，因为新依赖/行为只存在于to graph；
- Removal主要在旧端传播，以发现失去的consumer/guarantee；
- Assertion update需要根据authority、validity、confidence/evidence语义选择旧端、新端或双端；
- Entity replacement需要显式replacement/migration relation，不能按同名拼接两端；
- 同一change可能生成多个occurrences，但canonical summary按identity去重。

## Certainty

Impact至少区分：

- **definite**：由authoritative/derived canonical relation和确定规则传播；
- **possible**：依赖observed/inferred、optional route、dynamic dispatch或不完备coverage；
- **unknown**：缺rule、coverage、reference、Provider freshness或存在冲突，无法安全判断。

Inferred/observed-only relation不能升级为definite transitive edge。多个possible路径一致也不能多数票升格。Definite路径遇到unknown boundary时，已证明前缀保持definite，但边界后的结论仍unknown。

Risk、severity、priority和business cost是独立决策层，不得塞进certainty字段。

## Cycle 与 Fixpoint

Engineering graph可以有cycle。Impact必须使用visited state和monotone certainty/fact lattice收敛到有限fixpoint：

- 不因cycle无限展开；
- 同一occurrence选择最短、稳定、可解释的canonical witness；
- 多条路径可保留计数或references，但不复制相同impact item；
- rule产生非单调状态或无限新identity时validator拒绝；
- cutoff/预算耗尽必须形成unknown frontier，不能返回“完整”。

## Verification Recommendation

Impact可以推荐Acceptance、semantic selector、Gate capability或cross-domain owner，但不拥有测试文件路径、command、execution result或merge decision。

Recommendation来源必须可解释：哪条change、哪条rule、哪个consumer/Acceptance导致。最终可执行计划由Verification/Gate/Test Impact owner结合Repository、platform、Target和Evidence重算。

没有推荐不等于无需验证；只有Impact完整、相关rule明确声明无Verification requirement且其他domain无影响时，才可支持not-run判断。

## Cross-domain Impact

Semantic Delta可以通过stable references触发：

- source owner和generated Artifact；
- Documentation contract/projection；
- Workflow/Gate applicability；
- Agent Operation/Task Envelope；
- Release/public API/deployment；
- Product Decision/metric；
- Evidence freshness/invalidation。

跨域传播由相应domain rule/adapter拥有。Semantic Impact不能直接扫描changed files建立第二Repository graph；Repository Test Impact也不能从import graph推断semantic authority。

## Predicted、Actual 与 Runtime

- **Predicted Impact**：apply前对计划和当前graph的保守推导；
- **Actual Semantic Impact**：isolated/live rebuild后对actual Delta的推导；
- **Artifact/Runtime Impact**：生成物和物理Acceptance结果；
- **Residual Impact**：验证后仍未消除的unknown、unsupported或risk。

Apply后必须重新计算actual而非沿用predicted。Predicted遗漏、actual出现额外change或runtime反例都要求更新rule/owner/coverage；不能只在UI追加warning。

## 性能与增量

Impact可以有incremental index和cache，但clean full computation是语义基准。Cache key绑定graph/rule revisions和input closure；unknown dependency只扩大失效。Incremental/clean结果必须canonical等价，cache缺失或损坏回到clean，不返回旧结果。

性能优化不能缩短unknown frontier、限制图深度而仍声明complete，或只保留一个偶然路径丢失独立consumer。

## 消费者边界

Workbench、Review、Mutation、Compiler Incremental Graph、changed-file test selection、Release planner和AI Context Packet都消费统一Delta/Impact结果。消费者可以过滤、聚合和投影，但必须保留source change、certainty、witness、unknown和revision references；不得建立第二comparator、传播switch或“最高风险”真值。

## 验收

- 同一validated endpoints/rules产生byte-stable Delta/Impact；
- added/removed/assertion update/entity-only变化方向正确；
- authority/confidence/provenance不被strongest-wins压缩；
- unknown predicate/reference/coverage fail closed；
- cycles收敛且canonical witness稳定；
- inferred/observed不升格为definite；
- predicted与actual分离，额外Delta可阻止publish；
- clean/incremental等价；
- consumer不能提交或重算canonical结果；
-至少三组无关业务模型和一个Brownfield unknown/opaque场景验证反特化。
