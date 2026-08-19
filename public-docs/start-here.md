# 从零认识 SEC

## 先看现实问题

大型软件工程真正困难的部分，通常不是“能不能写出某段代码”，而是：

- 谁定义这个需求；
- 哪个事实是真实来源；
- 同一个能力到底由哪个实现承担；
- 改一个地方会影响哪里；
- 哪些状态只是缓存、UI 或 AI 的理解；
- 哪些验证真的适用；
- 失败后如何恢复；
- Windows、Linux、Node、Bun、Target 与目标程序 Runtime 如何区分；
- 旧路径什么时候能删；
- AI 能提出什么、不能擅自决定什么。

如果这些问题只存在于人的脑子、聊天、README、PR 描述和临时脚本里，工程规模越大，状态越容易互相矛盾。

SEC 的基本做法是：

```text
现实输入
→ 结构化工程事实
→ 唯一 authority
→ 明确 identity / revision
→ 确定性计划
→ 受控执行
→ 物理验证
→ Evidence
→ 正式状态
```

## SEC 与普通代码生成器的差别

普通代码生成器重点是：

```text
输入
→ 生成代码
```

SEC 的目标是持续工程闭环：

```text
产品意图
+ 已有源码
+ 工程合同
+ Provider / Target / Host 事实
        ↓
Engineering Semantic Model
        ↓
Implementation Resolution
        ↓
Target Program
        ↓
源码 / Artifact
        ↓
Verification / Evidence
        ↓
后续变化继续回到同一个工程模型
```

生成不是终点。

## 为什么源码本身还不够

源码非常重要，但源码并不会天然告诉系统：

- 这段实现对应哪个产品责任；
- 某个类库为什么被选择；
- 哪个行为是合同，哪个只是当前实现细节；
- 一个变化是否破坏兼容；
- 一个测试为什么适用；
- 某个未知是否可以安全忽略。

SEC 不否定源码，而是在源码之上建立明确的 engineering semantics，并允许 Brownfield 项目逐步被观察、提升、采用和治理。

## 为什么不能让 AI 直接成为 authority

AI 很适合：

- 理解模糊意图；
- 提出候选设计；
- 发现异常；
- 生成受限实现；
- 解释 Evidence；
- 处理仍不可机械化的开放问题。

但“模型觉得对”不能自动成为：

- 产品事实；
- 权限；
- Implementation Binding；
- Verification PASS；
- merge authority；
- Support Claim。

所以 SEC 的 AI 方向是 **bounded proposal（受限提议）**：

```text
Human / AI
→ proposal
→ canonical validation
→ plan
→ authorization
→ apply
→ physical verification
```

## 为什么 Evidence 与 Authority 必须分开

观察到一个结果，只能证明“发生了什么”，不能自动证明“应该怎样”。

例如：

```text
一次测试通过
```

不能推出：

```text
所有平台都支持
```

同样：

```text
一个外部工具说这里没有依赖
```

不能推出：

```text
这段代码可以安全删除
```

因此 SEC 区分 canonical authority、observation、Evidence、Verification 与 projection。

## 为什么 Unknown 不能被抹掉

工程系统经常只能看到世界的一部分。

没有观察到动态依赖，不代表没有动态依赖；没有找到某个配置，不代表它不存在；Provider 没报告 Effect，不代表 Effect 为零。

所以：

```text
unknown != false
not-run != pass
unsupported != pass
stale != current
```

这是 SEC 保守性的核心来源之一。

## 下一步

- 想先跑起来：[Quickstart](quickstart.md)
- 想建立完整心智模型：[学习路线](learn.md)
- 术语看不懂：[术语表](glossary.md)
- 想知道“为什么这样设计”：[原则与为什么](principles.md)