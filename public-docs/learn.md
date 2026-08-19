# SEC 学习路线

SEC 不适合用“先背完所有名词再开始”的方式学习。

推荐按问题逐层深入。

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

## L1：理解完整工程流

先建立生成方向：

```text
Intent
→ Engineering Semantic Model
→ Implementation Resolution
→ Target Program
→ Artifact
→ Verification
→ Evidence
```

再建立变化方向：

```text
Mutation
→ Delta
→ Impact
→ Compatibility / Migration
→ Re-Verification
```

对应 canonical owner：

- `docs/semantic-model.md`
- `docs/compiler-target-ir.md`
- `docs/semantic-mutation.md`
- `docs/delta-and-impact.md`
- `docs/change-management.md`
- `docs/verification-governance.md`

## L2：理解已有工程 / Brownfield

重点：

```text
Attach
→ Observe Source Program
→ Lift
→ Reconcile
→ Adopt
→ Normalize
```

阅读：`docs/brownfield-import.md`。

最重要的边界：无法完整理解的动态、反射、native 或第三方区域可以保持 unknown / opaque；SEC 不应为了“覆盖率漂亮”伪造语义。

## L3：理解能力复用与实现选择

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

## L4：理解物理世界

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

## L5：理解人与 AI 怎样操作

阅读：`docs/workbench-and-ai-operations.md`。

重点记住：

```text
View / Projection
!=
Canonical State
```

AI 的上下文也只是 revision-bound projection；AI 输出默认是 proposal，不是 authority。

## L6：理解 SEC 自己怎样被开发

阅读：

- `docs/development-governance.md`
- `docs/verification-governance.md`
- `AGENTS.md`

这一层面向 contributor，不是普通用户前置。

## 图形化学习

完整的 Beginner → Engineering → Architect 多层图形体系进入：

- [架构学习](architecture.md)

图是 projection；精确语义仍回到 canonical owner。