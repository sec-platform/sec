# SEC 设计、成熟度与证据

这一部分回答两个不同问题：

> 为什么这样设计？

以及：

> 这项设计现实中究竟做到哪一步？

二者不能混成一句“已经完成”。

## 三类信息必须分开

### Canonical Decision

稳定设计本身。

来源是对应 domain owner，例如：

- Semantic Model → `docs/semantic-model.md`；
- Compiler / Resolution → `docs/compiler-target-ir.md`；
- Verification → `docs/verification-governance.md`；
- Runtime / Support → `docs/runtime-and-distribution.md`。

### Rationale / Principle

为什么选择这个设计：

- 现实问题；
- Basis / Evidence；
- 作用机制；
- 替代方案；
- tradeoff；
- 最强反例；
- 反转条件。

详见 [原则与为什么](principles.md)。

### Maturity / Evidence

现实实现状态至少需要区分：

```text
proposed
accepted
specified
implemented
verified
enforced
adopted
retired
```

并允许：

```text
blocked
regressed
superseded
rejected
```

## 为什么必须分开

否则会产生两种相反错误。

第一种：

```text
设计写得很完整
→ 误以为已经实现
```

第二种：

```text
代码里碰巧存在某个机制
→ 误以为它已经成为架构规则
```

SEC 必须同时保存：

```text
what should be true
what is implemented
what was physically observed
what is enforced
what real consumers have adopted
```

## Reality Card

最终重大能力页面应由 machine truth 生成类似视图：

```text
能力：Implementation Resolution

Canonical owner: ...
Specified: yes/no/unknown
Implemented: yes/no/partial
Verified environments: ...
Enforced entrypoints: ...
Known bypasses: ...
Adopted consumers: ...
Retirement gaps: ...
Next maturity condition: ...
```

不能手写一个绿色 `Supported` badge 代替全部维度。

## Evidence 也有作用域

一次 Evidence 至少要知道：

```text
claim
subject / revision
input closure
environment
provider / verifier
result
producer
freshness
```

不能把：

```text
Linux/x86_64 成功
```

直接投影成：

```text
Windows/ARM64 supported
```

也不能把：

```text
source tests pass
```

直接投影成：

```text
packed distribution works
```

## 设计历史怎样保留

历史研究、旧 proposal、事故和 prior art 可以非常有价值，但它们默认是 Evidence / historical source，不是 current authority。

正确方向：

```text
historical source
→ durable claim extraction
→ current canonical owner / machine contract
→ historical exact ref retained for provenance
```

而不是把旧大文档整个恢复回来。

## 世界级/最佳等比较性主张

“世界顶级”“最先进”“最快”“最安全”等不是可以靠文档写出来的状态。

它们需要明确：

- 比较对象；
- workload；
- correctness boundary；
- measurement method；
- environment；
- independent Evidence；
- uncertainty。

没有这些内容时，只能说目标或假设，不能说已经证明。