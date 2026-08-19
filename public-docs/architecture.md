# SEC 架构学习

这里承载 SEC 的多层架构学习投影。

## 三层深度

每个主题按三个深度展开：

```text
L0 Beginner
  不要求编译器背景，先回答“为什么存在”

L1 Engineering Process
  谁输入、谁生产、谁消费、失败去哪、最终什么成为正式状态

L2 Architect / Contract
  identity / revision / authority / invalidation / failure / source / tests
```

复杂主题继续增加：

- sequence；
- state machine；
- failure / recovery；
- authority flow；
- physical topology；
- worked example。

## 十六个顶级主题

1. SEC 整体到底是什么；
2. 谁有权决定什么，什么才算正式事实；
3. SEC 眼里的一个工程怎样表示；
4. 把已有代码项目接入 SEC 会发生什么；
5. 可复用能力如何发布、连接和升级；
6. 同一个功能有很多实现时怎样选择；
7. 一个工程意图怎样编译到 Target Program；
8. 用户或 AI 修改工程时怎样避免乱改；
9. 一个变化怎样变成 Delta / Impact / Compatibility / Migration；
10. SEC 怎样证明“真的正确”；
11. Host、Toolchain、Target、Runtime、OS、ISA、filesystem 的关系；
12. 用户与 AI 怎样通过 Workbench 操作；
13. SEC 自己怎样持续开发；
14. Identity Ladder 与 Effect Purity；
15. SEC 为什么按 Capability Roadmap DAG 演进；
16. 一个设计怎样从提出走到真正采用和旧路径退役。

## 图形不是 Authority

所有图只做 projection。

例如一条图边如果表示：

```text
Implementation Requirement
→ Implementation Binding
```

精确 Eligibility、Decision、Binding 语义仍由 `docs/compiler-target-ir.md` 拥有。

如果图和 canonical owner 冲突，图必须修。

## 图形验收

一个 L1 流程图至少应让读者回答：

1. 谁发起；
2. 输入是什么；
3. 第一步做什么；
4. 产生什么新 object/state；
5. 为什么不能跳过；
6. 下一步由谁消费；
7. 成功是什么；
8. failure / unknown / unsupported / blocked 是什么；
9. 怎样 retry / recover；
10. 最终什么成为 canonical result。

一个核心概念至少应回答：

```text
它是什么
为什么存在
谁生产
谁消费
它不是什么
具体例子
没有它会发生什么错误
```

## 中文术语

第一次出现专业词时优先：

```text
平台正式认可的唯一标准状态
Canonical State

直觉：其他模块都以它为准，不能各自保存另一份“自己的真相”。
```

不要在 Beginner 图里连续堆 Entity / Assertion / Eligibility / Binding / Evidence / Projection 等未解释词。