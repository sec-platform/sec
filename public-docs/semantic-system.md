# SEC 的工程语义系统：怎样描述一个不断扩张的工程世界

如果只看源代码，一个软件系统似乎由文件、函数、类、类型和调用组成。

但真正做一次工程变更时，人实际关心的是另一组问题：

- 这个对象**负责什么**？
- 哪些行为是不能改变的 **Contract（契约）**？
- 哪些状态由谁拥有，谁可以写？
- 一个操作会产生哪些 **Effect（副作用）**？
- 谁拥有权限，谁只是观察者？
- 当前实现为什么选了这个库、协议或运行环境？
- 换一种实现以后，语义到底有没有变？
- 哪些结论是事实，哪些只是推断？
- 哪些验证真的运行过，针对的是哪个版本？
- 物理世界是否真的和计划一致？

SEC 所说的 **Engineering Semantics（工程语义）**，就是把这些会真正改变工程判断和结果的信息变成可识别、可验证、可追踪、可变更的结构，而不是继续全部藏在人脑、源码习惯、文档和 AI 猜测里。

这篇文章解释 SEC 怎样组织这整个问题，以及为什么“支持所有语义”不能靠不断给一个巨大对象增加字段。

## 1. 先把几个世界分开

一个工程至少同时存在几个互相关联、但不能混成一个的世界。

```text
人的目标 / 产品要求
        ↓
Canonical Engineering Semantics
        ↓
Implementation / Target realization
        ↓
Source / Config / Artifact
        ↓
Physical Runtime Reality
        ↓
Observation / Evidence / Readback
```

还有一条从已有系统向上的链：

```text
Existing physical workspace
        ↓
Physical Observation
        ↓
Source Program Model
        ↓
Candidate interpretation
        ↓
Reconcile / Adopt
        ↓
Canonical Engineering Semantics
```

这里最重要的不是箭头数量，而是**每一层回答的问题不同**。

### Physical Observation：实际有什么字节和对象？

它回答文件、包、配置、模式、物理对象、内容摘要等现实问题。

它可以证明：

> “我在这个 exact revision 看到了这份文件。”

它不能自动证明：

> “这份文件表达的业务含义一定正确。”

### Source Program：这些字节在语言里表示什么？

例如 TypeScript 的 module、symbol、declaration、reference、call site、type signature。

它可以证明某个调用实际绑定到了哪个 symbol，却仍不能自动证明这个 symbol 在产品里承担什么责任。

### Engineering Semantics：工程上它意味着什么？

这里开始出现 Responsibility、State、Operation、Effect、Permission、Policy、Contract、Acceptance 等工程对象。

### Implementation：具体怎样实现？

同一个 Contract 可以由不同 library、provider、adapter、runtime 或 target 实现。

因此：

```text
Semantic identity
!=
Implementation identity
```

如果实现 A 换成实现 B，而 Contract、Effect、Permission、Support 等都没有改变，那么这是 **Implementation Binding Delta**，不应该伪装成业务语义变化。

### Evidence：我们凭什么相信前面的 Claim？

Evidence 不是“又一种事实来源”。它支持或反驳一个 Claim，而且必须说明 exact subject、revision、environment、method 和 freshness。

这也是为什么 SEC 不把“测试曾经绿过”当成永久真理。

## 2. SEC 最小的语义内核是什么

当前 canonical 设计的中心不是一个业务领域表，而是一组能够承载不同领域事实的基本机制。

### Entity

一个具有稳定身份、可以被 Fact 引用的工程对象。

### Fact

一个规范化的语义命题，可以直觉理解为：

```text
subject
-- typed predicate -->
object / value
```

例如：

```text
Operation A -- READS --> State B
Operation A -- PERFORMS_EFFECT --> NetworkEffect C
Responsibility X -- OWNS --> State B
```

### Assertion

Fact 本身只描述“命题是什么”；Assertion 记录**谁在什么条件下声称这个 Fact 成立**。

一个 Assertion 还需要考虑：

```text
authority
confidence
provenance
evidence references
validity / revision
```

所以：

```text
同一个 Fact
可以同时存在：
  authoritative assertion
  observed assertion
  inferred assertion
  conflicting assertion
```

这比把“可信度”塞进 Fact 本身更重要，因为事实身份和认知来源是两件不同的事情。

### Responsibility

Responsibility 不是文件、函数或类的别名。

它表达一个工程义务，并把通常分散在很多地方的内容连接起来：

```text
purpose / obligation
inputs / outputs
state ownership
operations
contracts
permissions
policies
effects
errors
lifecycle
source bindings
verification obligations
```

一个函数可以承载多个 Responsibility facet；一个 Responsibility 也可以跨越多个文件、配置和运行对象。

## 3. “全部语义”为什么不能是一张无限大的字段表

最直觉的设计可能是：

```text
EngineeringObject {
  route?
  table?
  transaction?
  permission?
  hardwareRegister?
  cssSelector?
  deployment?
  ...
}
```

它最初看起来很统一，后来会出现三个问题。

### 问题一：未知世界必须提前被猜出来

未来总会出现今天没有想到的工程对象。把所有未来领域预编码成 optional 字段，只是在延迟下一次 schema 爆炸。

### 问题二：所有通用算法都被迫认识所有领域

最终容易出现：

```text
if web ...
else if database ...
else if distributed ...
else if hardware ...
```

新增一个领域就修改 Core，说明所谓“通用”其实只是一个越来越大的 switch。

### 问题三：名字相同不代表语义相同

“state”“resource”“transaction”“event”在不同领域可能拥有不同约束。过度压平会制造虚假的统一。

因此，SEC 更合理的长期方向是：

```text
极小的不可约 semantic kernel
+
版本化的 domain semantics
+
通用 semantic interfaces
+
显式 cross-domain bindings
```

**状态说明：**前面的 Entity / Fact / Assertion / Responsibility、typed predicate、authority、unknown、validated boundary 已属于 canonical 架构；下面的可扩展 Domain Dialect / Interface 形态仍在用跨领域现实案例持续验证，不能把它当成已经完成的产品能力。

## 4. Domain Semantic Extension：领域拥有具体意义，Core 只拥有通用协议

一个未来的领域扩展可以把自己的类型留在自己的 namespace：

```text
web.route
web.dom-element
data.table
data.transaction
distributed.replica
security.trust-boundary
workflow.decision
hardware.register
```

关键不是这些名字，而是它们都通过同一个基础协议获得：

```text
stable identity
revision
validatable type / predicate
Assertion authority
provenance
unknown / conflict
migration / retirement
```

外部先例说明这种方向是可行的，但不能直接照搬：

- [MLIR Dialects](https://mlir.llvm.org/docs/Dialects/) 允许不同抽象层的 dialect 共存；
- [MLIR Interfaces](https://mlir.llvm.org/docs/Interfaces/) 专门用于让 transformation/analysis 不必硬编码每一种 operation 或 dialect；
- [SysML v2](https://www.omg.org/spec/SysML/) 使用正式系统模型并提供可机器读取的系统/分析等 library；
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/) 按领域定义稳定性不同的语义约定。

这些只能证明一种机制有现实先例，不能证明 SEC 应复制它们的 metamodel。

## 5. Semantic Interface：通用算法只依赖它真正需要的能力

假设 Impact 分析只需要知道一个对象是否拥有可读写状态。

它不应该问：

```text
“你是不是数据库表？”
```

而应该问一个更小的问题：

```text
“你是否实现了可被这个 pass 消费的 State / Read / Write interface？”
```

概念上可能出现：

```text
Ownable
Stateful
Callable
Effectful
Permissioned
Containable
LifecycleManaged
Verifiable
Lowerable
ResourceBound
```

真正集合必须由现实 consumer 收敛，而不是一次脑补冻结。

这形成一个重要规则：

> **新领域优先增加自己的 domain semantics；只有多个独立领域反复需要同一个不可约机制时，才考虑把机制提升为 Core semantic interface。**

## 6. 一组“发现维度”比固定领域列表更有用

为了发现语义遗漏，可以从这些方向攻击一个现实问题：

| 发现维度 | 问题 |
| --- | --- |
| Identity | 它到底是哪一个对象？换名、移动、复制后还是它吗？ |
| Structure | 它由什么组成？包含、引用、依赖是否被混淆？ |
| Behavior | 输入经过什么行为产生输出？ |
| State | 有哪些状态、状态转移和不变量？ |
| Effect | 它实际会修改什么外部世界？ |
| Authority | 谁有权声明、决定和执行？ |
| Permission / Trust | 谁可以做什么？跨越了什么安全边界？ |
| Resource | CPU、内存、时间、网络、配额等约束是什么？ |
| Implementation | 哪个具体机制实现同一要求？ |
| Target / Environment | 哪些假设只在特定平台、浏览器、OS、硬件成立？ |
| Change | 哪些变化改变语义，哪些只改变实现？ |
| Compatibility / Migration | 旧消费者怎样继续工作，状态怎样迁移？ |
| Failure / Recovery | 哪一步能失败？失败后现实世界处于什么状态？ |
| Observation / Evidence | 我们实际观察到什么？什么还没有被证明？ |
| Time / Concurrency | 状态会不会在计划和执行之间变化？多个 actor 会不会竞争？ |

这些只是 **discovery axes**，不是固定 schema。

如果未来一个真实系统暴露完全不同的控制变量，就应该扩展发现方法，并回头攻击旧设计。

## 7. Unknown 不是缺陷，而是语义的一部分

看见一段代码：

```text
if age < 18 -> reject
```

可以非常强地恢复行为：

```text
age < 18 时拒绝
```

但单凭代码无法知道 18 来自：

- 法律；
- 公司政策；
- 第三方平台；
- 历史兼容；
- 临时实验；
- 错误。

如果这些解释在现有 Evidence 下不可区分，那么正确状态不是“挑一个最像的”，而是：

```text
candidate / inferred / ambiguous / unknown
```

SEC 的反向工程目标不是虚构失去的信息，而是：

> **把当前 Evidence 能支持的最高层工程语义尽量恢复出来，同时保留仍不可辨识的边界。**

更多解释见 [设计方法](design-method.md)。

## 8. Cross-domain：真实工程从来不会只属于一个领域

一个 HTTP 请求可能同时跨越：

```text
Web Route
→ Authentication
→ Authorization Policy
→ Business Operation
→ Database Transaction
→ Message Publish
→ External Network Effect
→ Runtime Resource
→ Telemetry
```

如果这些领域各自维护自己的第二份“用户是谁”“operation 是什么”“状态是谁拥有”的真值，系统最终一定产生漂移。

因此跨域关系需要：

```text
stable identity
+ typed relation
+ exact revision
+ explicit owner
```

而不是靠：

```text
文件路径相同
字段名字相同
AI 觉得像
自由字符串恰好相等
```

## 9. Provenance 也必须有语义

“source: AI”或“来自某文件”并不足够。

[W3C PROV](https://www.w3.org/TR/prov-constraints/) 是一个重要先例：provenance 自己具有 entity、activity、agent、derivation、event ordering、validity 和 equivalence 等约束。

SEC 不需要复制 PROV，但得到一个重要结论：

> **Provenance 不是装饰 metadata；如果它影响我们是否相信一个 Assertion，它自己就必须具有身份、结构、验证和失效规则。**

## 10. 一个设计怎样证明自己真的“通用”

不是看它能不能画出很多领域的类图。

而是进行反特化测试：

```text
领域 A
领域 B
领域 C
...
```

不断加入彼此差异巨大的现实对象，并检查：

1. 是否只增加 domain-specific semantics，而无需修改通用 Core 业务分支；
2. 同一个 generic consumer 能否通过 interface 消费不同 domain；
3. unsupported/unknown 是否保持诚实；
4. extension 升级是否不会静默重新解释旧 snapshot；
5. 跨域关系是否仍由 typed identity 连接；
6. 如果必须修改 Core，新 primitive 是否真的跨多个独立领域不可约。

真实事故和成熟系统会持续作为这种攻击输入，见 [现实案例](case-studies.md)。

## 11. 最终不是“一张万能模型”，而是一个可持续扩张的语义体系

可以把目标压缩成：

```text
                         ┌─ Web semantics
                         ├─ Data semantics
                         ├─ Security semantics
Minimal Semantic Kernel ├─ Distributed semantics
        + Interfaces     ├─ Workflow semantics
                         ├─ Hardware semantics
                         └─ future domains
             │
             ▼
      one validated graph
             │
      ┌──────┼─────────┐
      ▼      ▼         ▼
   Impact  Mutation  Verification
      │      │         │
      └──────┼─────────┘
             ▼
       Implementation
             ▼
       Physical Reality
             ▼
          Evidence
```

这里真正统一的不是世界上所有名词。

统一的是：

> **任何工程语义进入系统以后，都必须回答“它是谁、它声称什么、谁有权声称、根据什么、在哪个 revision 有效、怎样变化、怎样验证、什么仍未知”。**

具体业务和技术领域仍然保留自己的精确意义。

这比“做一个万能 schema”更难，但也更有机会随着现实世界持续扩展，而不是每多支持一个领域就重写一次核心。

继续阅读：

- [SEC 怎样从现实问题推导设计](design-method.md)
- [现实案例：为什么这些语义不能省略](case-studies.md)
- [原则与为什么](principles.md)
- [架构学习](architecture.md)
