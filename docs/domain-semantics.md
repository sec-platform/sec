---
title: 可移植领域语义
status: stable
domain: domain-semantics
---

# 可移植领域语义

本文拥有跨目标、跨实现复用的**行为与数学语义合同**：一个已声明类型/主体上的值、求值、控制、状态、关系、流、事务、数值和随机行为分别意味着什么。它不是 SEC 的第七个 Product Domain，也不是一门必须采用的新语言。

边界必须明确：

- canonical Entity/Fact/Assertion/Responsibility 由 [Engineering IR](semantic-model.md) 拥有；
- 跨层 Type identity、normalization、serialization shape 与 Target type mapping 由 [Compiler / Target IR 的 Type Algebra](compiler-target-ir.md) 拥有；
- 作者如何引用 Definition/Subject/Requirement 由 [Authoring Model](authoring-model.md) 拥有；
- 本文只拥有**这些已类型化对象上需要被实现保持的领域语义**，不建立第二 Type Algebra、第二 Engineering IR 或第二作者语法。

## 1. 语义先于表示和后端

同一领域语义可以由结构化作者源、目标语言源码、成熟库、Wasm、原生模块、设备核或经采用的外部 Provider 实现。表示或实现只有在保持相应合同后才取得资格：

```text
Domain semantic obligation
  + canonical Type/Subject refs
  + TargetProfile
  + implementation-specific premises
        ↓
ImplementationRequirement
        ↓
qualified implementation / adapter / target mapping
```

不得从 TS/JS、Rust、SQL、GPU、数据库或某个框架的便利行为反向定义通用语义。目标不支持某项语义时返回 unsupported/unresolved 或改选实现，不能静默改义。

`.sec` 或任何中立计算表示只是一种**可选的实现/校准载体**。没有选择它的工程不需要产生等价 `.sec` 副本；现有目标语言源码也无需先被翻译成它才能进入 SEC。

## 2. 值域语义、相等与边界观察

Type Algebra 决定类型 identity 与正规化表示；本文只规定某些领域合同对这些类型的**值域和观察**有哪些要求。例如：

- Boolean、Text、精确 Int、明确精度/舍入的 Real/Float、bytes；
- nominal enum、record、variant/result、optional、list/map/set/multiset；
- function/async/stream/resource 等带行为或寿命的类型；
- logical subject identity 与普通数据值；
- absent、unknown、null、error、empty collection，不互相代替。

这里的列表不是第二类型注册表。实际 type reference、nullability、recursive shape、serialization 与 Target representation 都引用 Compiler Type Algebra；若某种领域合同需要新的可观察数学性质，则先证明现有 Type Algebra + Contract 无法表达，再演进对应 owner。

相等关系随合同确定：

- 精确数值按声明数学域；
- Text 按声明 Unicode/normalization/collation 合同；
- record/variant 按其已类型化字段/构造子；
- collection 按 set/multiset/list 含义；
- logical subject 按 subject identity，而不是内容相同；
- resource/handle 不默认按内容比较。

目标表示存在溢出、NaN、编码、对象 identity 或排序差异时，adapter/Target mapping 必须证明保持需求；不能把目标限制反写成领域语义。

## 3. 求值、效果、错误与一次求值

一个表达式的 observable contract 可以包括结果、业务错误、Effect、资源、时间/顺序、终止与信息流。不同 Claim 选择不同观察范围，但实现不得自行删除要求已经保护的观察分量。

SEC 将下列概念分开：

```text
ValueResult != BusinessError != RuntimeFault != Cancellation != ResourceExhaustion
```

条件、匹配、分派或优化不能重复求值有 getter、迭代、随机、时钟、状态读取或 Effect 的输入。需要同时用于 guard 与 body 的值先在原程序顺序捕获一次，再由两者消费同一结果。

异常/错误优先级属于合同，不能直接借宿主语言默认顺序。跨目标 lowering 必须显式保持：

- 哪个错误先被观察；
- 是否返回部分结果；
- cleanup 失败与主结果如何组合；
- cancellation 能否撤销已发生 Effect；
- fault 是否可能绕过普通返回路径。

## 4. 函数、闭包、泛型与高阶合同

函数的类型 shape 由 Type Algebra 拥有；函数**领域合同**还可以约束业务前后条件、Effect/Permission、错误、资源和必要调用时序。高阶函数不能因“函数值类型相同”丢失被传入函数的 Effect 或前后条件。

闭包捕获区分：

- 值快照；
- immutable shared value；
- 可变位置/引用；
- resource/handle；
- subject/runtime capability。

作用域结束、对象不可达与资源已关闭不是同一时点。资源必须按真实 owner 和最后访问者结算。

泛型 type construction/normalization 属于 Type Algebra；本文只规定参数化行为合同不能因一个特化成立就外推到全部特化。Target 特化必须受实际 target/profile 与资源界限约束。

## 5. 对象、构造与动态分派

对象语义在需要名义 identity、封装或动态分派时使用，不要求所有业务数据升格为对象。实际 nominal/object type identity 仍由 Type Algebra/semantic owner 提供。

构造行为遵循：

```text
allocate/private state
→ initialize required invariants
→ establish method/interface dispatch state
→ publish identity
```

构造完成以前不得把尚未满足 invariant 的 `this` 暴露给未知回调、共享 registry 或并发消费者。覆盖方法必须满足公共合同的前置/后置/Effect/资源约束；“同签名”不证明可替换。

静态数据、模块实例、应用全局状态与对象实例是不同 identity/lifetime 域，不能因为都能在宿主中实现成 object 就合并。

## 6. 控制流、退出与存储寿命

结构化控制至少区分顺序、分支、循环、match、break/continue/return、错误传播、defer/finally 和异步退出。这些是 Behavior/Contract 的语义义务，不要求作者使用某套固定文本语法。

控制退出先到其所属边界，然后执行规定的 cleanup；**退出发生不等于全部资源已经释放**。需要保持：

- 当前结果/错误；
- 必须执行的清理；
- cleanup 自身失败；
- 仍在途的异步/设备/回调工作；
- 已经发生且不可撤销的外部 Effect。

托管内存是默认安全实现路径，但确定资源仍需要 scope/lifetime contract。底层 borrow/arena/native/GPU memory 只在有真实收益和可验证边界时启用，不把整个语言表面一起变成不安全。

## 7. 并发、任务与异步

任务 identity 与其 Promise/Future/线程/进程句柄分开。接受、开始、结果结算、提供者停止访问、资源释放和调用方观察可以发生在不同时间。

一个可取消任务至少明确：

- 谁拥有取消请求；
- 取消能否阻止尚未开始的工作；
- 运行中的工作是否支持协作停止；
- 取消后是否仍会回调/返回清理结果；
- 已转移资源由谁结算；
- deadline 到期但 Effect terminal 未知时如何恢复。

共享状态需要真实内存模型/同步；`readonly` 类型、对象冻结或强引用不自动提供跨线程 happens-before。

## 8. 状态、关系、流、事务与数值

这些机制共享既有 Type/Subject/Effect identity，但不能互相化约成“普通函数”：

- **State machine**：稳定配置、事件选择、退出/转移/进入、history、活动、计时器和宏步进展；
- **Relation/query**：set/multiset、join、group、ordering、snapshot、pagination、递归与增量维护；
- **Stream**：source position、backpressure/credit、event time、watermark/frontier、late data、checkpoint/acknowledgement；
- **Transaction**：读写集合、原子提交、授权时点、隔离/一致性、外部交付和恢复；
- **Numeric/AD**：精度、舍入、可微性、forward/reverse residual、complex/implicit derivative 前提；
- **Random/probability**：随机源 identity、联合分布、相关性、独立样本与统计误差。

它们的完整合同见 [State, Stream and Numeric Semantics](domain-semantics/state-stream-numeric.md)。

## 9. 语义扩展

新能力按以下顺序处理：

1. 先判断现有 Type Algebra + Value/Effect/State/Relation/Stream/Contract 能否表达；
2. 能表达则增加普通 Definition/Library/Provider，不扩展 meta-model；
3. 只有出现不可表示、且有真实 producer/consumer 的新观察维度时，才向**拥有该缺口的现有 owner**提出新 construct；
4. 同时定义 identity、composition、failure、Target mapping、evolution、verification 与旧 consumer 影响；
5. 没有实现/证据时保持 unsupported/frontier，不以 token 名称宣称支持。

扩展语义不能建立第二 Engineering IR、第二 Type Algebra、第二 Effect 系统或某技术品牌专属核心。

## 10. 可实现性、可判定性与通用计算

SEC 不以“所有程序性质可静态判定”为目标。通用计算能力与可判定的工程检查通过**有界合同**共存：

- 可完整静态证明的部分给出 proof/derived result；
- 需运行观察的部分形成 Verification obligation；
- opaque/external 区域保留其未知 ceiling；
- 无法在给定预算内求解的 synthesis/search 返回 budget/unresolved，不改写要求。

有限语法、类型系统或结构化作者源不意味着所有实现搜索都是有限廉价的；实现发现、优化和程序性质保持由 Compiler/Verification 分别承担。

## 11. Target 保持责任

本文不拥有 Target type representation 或 Backend mapping 算法；它只定义**哪些领域观察必须被 Target mapping 保持**。Compiler/Adapter 在 exact Target Profile 下至少核对：

- 值域/溢出/编码是否保持；
- Type/ABI/layout 映射是否满足既有 Type Algebra 和 public contract；
- error/exception/cancellation 观察；
- memory/resource ownership；
- concurrency/runtime model；
- host capabilities；
- public consumer contract。

如果目标没有直接原语，可以采用保持语义的 runtime/library/adapter；不能保持则该候选不合格。Backend 只在语义和 Binding 已冻结后决定具体 AST/bytes。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

SEC 的可移植领域语义只拥有已类型化对象上的行为与数学合同，不拥有第二 Type Algebra、第二 Engineering IR 或第二作者语言。原生实现、成熟库和可选中立表示都只能作为满足这些合同的供给；状态、关系、流、事务、数值与随机行为保持各自必要的 ordering、Effect、resource、failure 与 verification 维度，不被一个“通用函数”或某后端便利行为吞并。
