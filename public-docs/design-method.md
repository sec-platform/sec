# SEC 怎样从现实问题推导设计

SEC 的设计目标不是积累越来越多“听起来正确”的原则，而是把每一项重要架构都追溯到：

```text
现实问题
→ 不可绕过的约束
→ 可观察的失败或需求
→ 候选机制
→ 最强反例
→ 最小必要抽象
→ 真实 consumer
→ 验证与反向读回
```

这篇文章公开这一套方法，让读者能自己检查：**为什么要有这个设计、替代方案是什么、什么时候它反而不该存在。**

它不是对模型私密推理过程的展示；这里只保留任何人都可以复核的事实、机制、计算、反例、边界和裁决依据。

## 1. 第一步不是“想一个架构”，而是固定现实问题

错误起点：

```text
我们应该有一个更强的 IR
我们应该支持所有语言
我们应该加一个知识图谱
我们应该做一个 Agent Runtime
```

这些都先假设了解法。

更好的起点是一个能够被现实检验的问题：

```text
一个已经存在的工程
在不要求用户提供文件级 patch 的情况下
能否完成某项工程变更
并证明应该保持的语义真的保持？
```

现实问题必须包含：

- exact subject；
- 用户可观察目标；
- 不能改变的约束；
- 允许改变的范围；
- 成功/失败怎样被物理观察。

如果问题本身不能被证伪，后面的“架构成功”通常也无法被证明。

## 2. 去锚：把用户措辞和现有实现拆开

假设用户说：

> “把第三方 UUID 库换成浏览器原生实现。”

最直接的代码思维是：

```text
找到 import
→ 换成 crypto.randomUUID()
→ 删除 dependency
→ tests pass
```

SEC 不应该立即接受这个 framing。

先问：

```text
真正被要求替换的是哪个 implementation？
它正在实现什么 responsibility？
哪些 observable semantics 必须保持？
“原生”是硬约束还是偏好？
运行在哪个 environment？
原 provider 是否包含不明显的 fallback？
```

这一步的目标不是把简单任务复杂化，而是避免**把实现词汇误认为需求本身**。

## 3. 第一性约束：一路下探到改变它就会改变结果的条件

还是 UUID 例子。

从源码能直接看到的可能只有：

```text
id = uuidv4()
```

继续追踪 consumer，可以发现这个 ID 会进入评论对象并持久化。

于是要求逐渐变成：

```text
输出是稳定消费者可接受的 UUID-v4 form
随机源不能弱化成 Math.random
调用保持同步
保持 browser-side ownership
不增加 network round trip
持久化后的 ID 仍能被删除/编辑/恢复消费者使用
```

再追踪产品的运行入口，如果 CLI 公开允许非 localhost host，那么浏览器页面可能运行于不同 origin 安全上下文。

这里出现真正控制结果的约束：

```text
crypto.randomUUID()
和
crypto.getRandomValues()
并不是完全相同的 browser availability contract
```

因此“函数都能生成 UUID”还不足以证明实现可互换。

一个因素只有满足以下条件，才应该进入这个问题的关键约束：

1. 不是换词复述最终结论；
2. 改变它会改变候选是否可用；
3. 能形成可检验的作用链；
4. 能指出适用环境和失效条件；
5. 多个约束冲突时能判断谁是真正瓶颈。

## 4. 建立问题空间，而不是一张固定检查表

每个现实任务都从不同方向扩张。

常用发现问题包括：

```text
对象是谁？
生命周期是什么？
谁生产、谁消费？
谁受益、谁承担失败？
状态在哪里？
外部 Effect 是什么？
哪些资源有上限？
有哪些并发 actor？
哪些环境假设没有写出来？
失败以后可以回到哪里？
哪个改变会让结论反转？
```

这些只是发现工具。

如果现实问题暴露一个新轴，就增加新轴；不能因为原模板没有这一栏就把它忽略。

## 5. 区分观察、推断和 authority

反向理解已有项目时，一个最危险的错误是：

```text
工具看到了 X
→ X 自动成为 canonical truth
```

SEC 要求分层：

```text
Observed：物理/工具真正看见的
Derived：由受治理规则确定推出的
Inferred：存在推理但不能唯一确定
Authoritative：被 owning authority 接受的当前真值
Unknown / Ambiguous / Conflict：不能诚实收敛
```

例如 TypeScript frontend 可以确定：

```text
call site 调用了 package X 的 symbol Y
```

却不能凭类型系统自动证明：

```text
这个调用具有某个安全保证
这个 package 与另一个 package 行为等价
```

所以 Source Program 与 Engineering Semantics 被故意分成不同层。

## 6. 先找现有 owner，再决定是否创造新抽象

每发现一个缺口，SEC 的默认动作不是：

```text
新建一个模块 / registry / state machine
```

而是：

```text
这个责任已有 owner 吗？
        │
        ├─ 有，而且自然包含 → 更新现有 owner
        │
        ├─ 有，但证据冲突 → reconcile
        │
        ├─ 未来才需要 → defer(trigger)
        │
        └─ 真实 current consumer + 确实 ownerless
                            ↓
                    最小 focused owner
```

现实 UUID 任务就是这样暴露出一个真正的中间缺口：

```text
Physical Workspace Observation
        ↓
        ?
        ↓
Responsibility Reconstruction
```

物理层不应该自己拥有 TypeScript symbol/call/type 语义；Responsibility 层又不应该重新解析源码。

因此真正缺少的是**provider-neutral TypeScript Source Program**，而不是“为了这个 UUID 任务写一个专用解析器”。

这个抽象只有因为有真实上下游 consumer 才成立。

## 7. Prior art 的作用是攻击和吸收机制，不是复制品牌

研究成熟系统时，SEC 不问：

> “我们要不要变成 Kubernetes / Terraform / MLIR？”

而问：

> “它解决的不可约问题是什么？这个机制在 SEC 已经被谁拥有？是否暴露当前缺口？”

例如：

### Kubernetes

[Kubernetes controller](https://kubernetes.io/docs/concepts/architecture/controller/) 持续比较 desired state 和 current state，并反复 reconcile。

可以吸收的机制是：

```text
desired != observed
一次成功 effect != 永久收敛
现实会继续漂移
```

不是把 Kubernetes resource schema 搬进 SEC。

### Terraform

[`terraform plan`](https://developer.hashicorp.com/terraform/cli/commands/plan) 把计划和实际 effect 分开，也明确提醒 target system 在计划后发生变化会影响最终效果。

[`terraform apply`](https://developer.hashicorp.com/terraform/tutorials/cli/apply) 的错误处理又说明部分 apply 后基础设施可能处于 invalid state，而且 Terraform 不承诺自动回滚所有部分完成操作。

这给 SEC 的结论不是“照抄 Terraform”，而是：

```text
Plan
!=
Effect
!=
Actual Delta
!=
Recovery
```

这些状态必须分别拥有真值。

### MLIR

[MLIR Interfaces](https://mlir.llvm.org/docs/Interfaces/) 的价值不是语法，而是证明一个通用 pass 可以依赖 interface，不需要知道每一种 dialect operation。

这直接攻击“每加入一个 SEC domain 就修改所有通用 pass”的错误扩展方式。

## 8. 必须主动构造最强反例

在形成“当前最佳设计”以后，马上攻击它。

UUID 例子一开始可能得到：

```text
直接使用 crypto.randomUUID() 最简单
```

最强反例不是代码风格，而是：

```text
如果原应用支持一个 randomUUID 不可用、但 getRandomValues 可用的 browser context 呢？
```

接着必须检查旧 Provider 的真实实现。

如果旧 Provider 本来也只依赖 `randomUUID()`，这个反例就被证伪。

如果旧 Provider 有 CSPRNG fallback，直接替换就真的可能缩小 support surface。

因此正确方法是：

```text
提出反例
→ 回到真实 provider/source/runtime 查证
→ 若反例成立，重算候选
→ 若不成立，删除它
```

不是为了显得谨慎永久保留所有假设。

## 9. “历史人工解”不是 golden diff

真实世界已有修改记录非常有价值，但它只能是 oracle / comparison evidence。

如果把历史 patch 提前交给系统：

```text
SEC 复现了历史 patch
```

只能证明模仿能力。

更强实验是：

```text
冻结历史变更前的真实 repository
        ↓
只给用户级目标和 must-preserve constraints
        ↓
SEC 独立分析、选择、修改、验证
        ↓
冻结 candidate
        ↓
最后才揭示历史人工解
```

比较的不是“字节相不相同”，而是：

```text
谁发现了更多真实 support / failure boundary？
谁修改得更少但没有漏掉必要 closure？
谁能解释为什么？
谁能证明 actual semantic delta？
```

SEC 完全允许一个 byte-different 解比历史 patch 更正确。

## 10. Candidate 必须比较完整实现闭包

“Provider A 和 Provider B 哪个更好”不能只比较 package 名。

候选至少要把对这个 requirement 真正有影响的闭包带进来：

```text
contract conformance
target / environment
permission / effect
resource requirements
dependency / install
support boundary
security / license where applicable
migration / retirement
verification requirements
```

顺序固定为：

```text
hard eligibility
        ↓
eligible candidates only
        ↓
policy optimization / preference
        ↓
deterministic tie-break
        ↓
exact Binding
```

一个 hard-ineligible 候选不能因为“更快”“更流行”“依赖更少”被加权救回来。

## 11. 计划阶段不能自己证明执行成功

正确闭环是：

```text
Request
→ semantic target
→ expected Delta / must-preserve
→ Impact / required Verification
→ Plan
→ transactionally apply
→ physical readback
→ rebuild Source Program / Semantics
→ Actual Delta
→ compare Expected vs Actual
→ Evidence
```

如果 plan 说：

> “我只会改变实现，不会改变语义。”

然后系统就把这个句子当结果，那根本没有验证。

**计划只能声明预期；结果必须重新从现实世界观察。**

## 12. 测试绿色不是唯一终点

测试本身只有它覆盖的 failure space。

[Cloudflare 2019 WAF outage](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/) 是一个极强例子：常规功能测试通过，但没有覆盖 runaway CPU；规则随后在全球快速部署并造成 CPU 耗尽。

因此一个 Verification Claim 必须问：

```text
它到底证明哪个性质？
在什么 environment？
针对哪个 revision？
哪些重要维度根本没有测？
```

这也是为什么 SEC 将：

```text
Test
Evidence
Verification Result
Product truth
```

分开。

## 13. 设计成熟度必须独立于“设计写得多完整”

一个架构可以拥有非常完整的 Issue、文档和类型草案，但现实仍可能只处于：

```text
proposed
accepted
specified
```

只有出现真实 producer/consumer、验证、不可绕过入口和旧路径退役以后，才能继续提升：

```text
implemented
verified
enforced
adopted
retired
```

这可以防止一个常见错误：

> 文档已经描述终态 → 误以为系统已经拥有终态。

## 14. 公共文档反过来攻击设计质量

如果一个架构无法回答：

```text
它解决什么现实问题？
为什么现有机制不够？
它的最小责任是什么？
最强替代方案是什么？
最强反例是什么？
哪种情况它应该失效？
现实证据在哪里？
```

那么有两种可能：

1. 文档写得不好；
2. 设计本身还没有真正收敛。

所以公共文档不是最后才做的包装。

它也是一种架构压力测试。

但反过来同样成立：为了让故事简单，不能删掉真实需要的 unknown、failure、recovery、authority 等复杂性。

## 15. SEC 的设计循环

最终可以把整个方法压成一个不断重复的循环：

```text
             ┌───────────────────────────┐
             │       Real Problem        │
             └─────────────┬─────────────┘
                           ▼
                Observe exact reality
                           ▼
             Reconstruct first principles
                           ▼
              Discover missing dimensions
                           ▼
              Compare external mechanisms
                           ▼
               Attack strongest solution
                           ▼
                 Map existing owners
                           ▼
            Smallest required architecture
                           ▼
                Real consumer / mutation
                           ▼
               Physical verification
                           ▼
                 Readback / Evidence
                           ▼
              ┌── conclusion survives? ──┐
              │                          │
             yes                        no
              │                          │
              ▼                          └──→ 回到上游重算
        canonical adoption
              │
              ▼
          public rationale
```

这意味着 SEC 的“完整体系”不是一次坐在桌前穷举出来。

它应该通过**越来越广的现实挑战不断收敛**：每一次新问题都优先复用既有语义；只有真正出现无法容纳的新机制，才增加最小新抽象。

继续阅读：

- [工程语义系统地图](semantic-system.md)
- [现实案例库](case-studies.md)
- [原则与为什么](principles.md)
- [设计、成熟度与证据](decisions-and-evidence.md)
