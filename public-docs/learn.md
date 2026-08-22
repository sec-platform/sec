# SEC 学习路线

SEC 不适合用“先背完所有名词再开始”的方式学习。

更有效的方法是：**先看现实问题，再理解负责解决它的语义层，最后下钻到精确 contract。**

## L0：先建立直觉

先回答五个问题：

1. SEC 是什么？
2. 为什么普通源码还不够？
3. 什么才是 canonical truth？
4. AI 为什么只能做 bounded proposal？
5. Verification 为什么不等于“跑了一次测试”？

阅读：

- [从零认识 SEC](start-here.md)
- [原则与为什么](principles.md)

如果这里已经不清楚，不建议先去背 IR、Provider、Work Package 等更多名词。

## L1：建立完整工程语义地图

先读：

- [SEC 的完整工程语义系统](semantic-system.md)

目标是理解以下层级为什么必须分开：

```text
Reality / Intent
→ Physical Observation
→ Source Program
→ Candidate Interpretation
→ Canonical Engineering Semantics
→ Implementation / Target
→ Artifact / Runtime
→ Evidence / Readback
```

重点掌握：

```text
Fact != Assertion
Semantic identity != Implementation identity
Observed != Authoritative
Unknown != False
Evidence != Authority
Projection != Canonical State
```

这一层建立之后，再看单个名词才不容易把它们当孤立的数据结构。

## L2：理解完整工程流

生成方向：

```text
Intent
→ Engineering Semantic Model
→ Implementation Resolution
→ Target Program
→ Artifact
→ Verification
→ Evidence
```

变化方向：

```text
Operation
→ Mutation
→ Delta
→ Impact
→ Compatibility / Migration
→ Re-Verification
→ Readback
```

对应 canonical owner：

- `docs/semantic-model.md`
- `docs/compiler-target-ir.md`
- `docs/semantic-mutation.md`
- `docs/delta-and-impact.md`
- `docs/change-management.md`
- `docs/verification-governance.md`

## L3：理解已有工程 / Brownfield

重点：

```text
Attach
→ Observe
→ Source Program
→ Lift
→ Reconcile
→ Adopt
→ Normalize
```

阅读：`docs/brownfield-import.md`。

最重要的边界：无法完整理解的动态、反射、native、第三方或缺失历史信息可以保持 unknown / opaque；SEC 不应为了“覆盖率漂亮”伪造语义。

然后读：

- [SEC 怎样从现实问题推导设计](design-method.md)

它会展示为什么一个真实 Brownfield 问题经常反过来暴露新的 Source Program、Responsibility、Target 或 Verification 缺口。

## L4：理解能力复用与实现选择

重点区分：

- Responsibility；
- Capability；
- Block；
- Contract；
- Port；
- Slot；
- Implementation Candidate；
- Eligibility；
- Resolution Decision；
- Implementation Binding；
- Provider；
- Adapter。

阅读：

- `docs/capability-and-block-model.md`
- `docs/compiler-target-ir.md`
- `docs/external-provider-policy.md`

然后用 [现实案例](case-studies.md) 中的 Provider replacement、Ariane 5 等例子检查自己是否真正理解：

```text
“可以调用”
!=
“符合完整实现要求”
```

## L5：理解物理世界

区分：

- Semantic Core；
- Host；
- Toolchain；
- Target；
- Runtime Environment；
- Distribution；
- Support。

阅读：`docs/runtime-and-distribution.md`。

一个轴成功不能自动证明另一个轴成功。

建议配合 [现实案例](case-studies.md) 阅读 Terraform、Kubernetes、Cloudflare、GitLab：这些案例分别攻击 drift、partial apply、resource exhaustion 和 recovery truth。

## L6：理解 Verification、Evidence 与失败

这一层不要只记住“要多跑测试”。

重点理解：

```text
Claim
+ exact subject/revision
+ applicable environment
+ independent method
→ Evidence
→ Verification Result
```

并继续追问：

```text
没运行？
不适用？
失败？
stale？
测试覆盖了哪个 failure space？
```

阅读：

- [设计、成熟度与证据](decisions-and-evidence.md)
- [现实案例](case-studies.md)
- `docs/verification-governance.md`

## L7：理解人与 AI 怎样操作

阅读：`docs/workbench-and-ai-operations.md`。

重点记住：

```text
View / Projection
!=
Canonical State
```

AI 的上下文也只是 revision-bound projection；AI 输出默认是 proposal，不是 authority。

模型更聪明可以提高 reconstruction / synthesis / search 能力，但不能自动取代 authority、permission、exact revision、physical effect 和 Evidence 这些现实边界。

## L8：理解 SEC 怎样持续扩展到新领域

再次阅读 [工程语义系统](semantic-system.md) 中的 Domain Semantic Extension 与 Semantic Interface 部分。

这里要特别区分：

### 已经 canonical 的基础

- Entity / Fact / Assertion / Responsibility；
- authority / provenance / unknown；
- typed predicate/signature；
- raw → validated boundary；
- Semantic / Implementation 分离。

### 仍在持续攻击的扩展方向

```text
minimal Core
+ versioned domain semantics
+ generic semantic interfaces
+ typed cross-domain bindings
```

不要把“设计方向写进公共文档”误读成已经 implemented。

跨领域现实挑战会继续用 Web、Data、Distributed、Security、Workflow、Hardware 等完全不同问题攻击这个方向。

## L9：理解 SEC 自己怎样被开发

阅读：

- `docs/development-governance.md`
- `docs/verification-governance.md`
- `AGENTS.md`

这一层面向 contributor，不是普通用户前置。

重点不是学习一堆内部流程，而是理解 SEC 为什么要求自己的开发也遵守：

```text
exact reality
→ bounded operation
→ independent verification
→ readback
```

## 按现实案例学习

如果你更喜欢从事故和真实系统出发，可以直接读：

- [现实案例：为什么这些语义不能省略](case-studies.md)

然后对每个案例自己回答：

```text
真正控制结果的约束是什么？
缺少的是哪种语义？
SEC 已有哪个 owner？
这个案例能证明什么？
它不能证明什么？
```

## 图形化学习

Beginner → Engineering → Architect 的图形入口：

- [架构学习](architecture.md)

图是 projection；精确语义仍回到 canonical owner。
