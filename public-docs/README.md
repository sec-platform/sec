# SEC 中文公共文档

SEC 是一个 **Engineering Workspace Compiler（工程工作区编译器）**。

它试图把产品意图、结构化工程语义、已有源码事实、实现选择、验证证据和运行环境放进受治理的工程模型，再确定性地投影为源码、测试、文档、Gate、Agent 上下文、Release 与 Evidence。

它不是：

- 让 AI 随意修改整个仓库的自由式编码器；
- 用图形界面取代源码的低代码运行时；
- 模板市场；
- 把所有外部工具吞进一个万能框架；
- 一份静态“最佳实践大全”。

## 第一次来这里

如果你完全不了解 SEC，建议先建立直觉，再进入完整体系：

1. [从零认识 SEC](start-here.md)
2. [SEC 的完整工程语义系统](semantic-system.md)
3. [SEC 怎样从现实问题推导设计](design-method.md)
4. [现实案例：为什么这些语义不能省略](case-studies.md)
5. [最短 Quickstart](quickstart.md)
6. [学习路线](learn.md)
7. [核心概念](concepts.md)
8. [术语表](glossary.md)

不需要按顺序读完；如果你已经知道自己要解决什么，可以直接跳到对应任务页面。

## 想知道“为什么这样设计”

先看现实依据和推导，再看浓缩原则：

- [SEC 怎样从现实问题推导设计](design-method.md)
- [现实案例：为什么这些语义不能省略](case-studies.md)
- [原则与为什么](principles.md)
- [设计、成熟度与证据](decisions-and-evidence.md)

重要设计不只回答“是什么”，还应该尽量回答：现实问题、机制、替代方案、tradeoff、失败边界、unknown、recovery、Evidence 和 maturity。

## 想理解“SEC 最终怎样容纳完整工程世界”

- [完整工程语义系统](semantic-system.md)：从 Reality / Source Program / Engineering Semantics / Implementation / Evidence 一路解释到跨领域扩展；
- [架构学习](architecture.md)：从不同读者问题进入架构图和 owner；
- [核心概念](concepts.md)：查 Entity、Fact、Assertion、Responsibility 等概念的直觉关系。

公共文档会明确区分：

```text
canonical architecture
!=
正在验证的 design direction
!=
已经 implemented / verified 的现实能力
```

## 要完成真实任务

- [指南](guides.md)
- [故障排查](troubleshooting.md)

## 要查精确接口

- [Reference](reference.md)

## 要开发 SEC 本身

- [贡献 SEC](contributing.md)

## 这套公共文档也用于反向审查 SEC 自己

如果一个设计无法向初学者回答：

```text
它解决什么现实问题？
为什么现有机制不够？
真正不可绕过的约束是什么？
最强替代方案和反例是什么？
什么时候它会失效？
凭什么相信它？
现实做到哪一步？
```

那么需要检查的不一定只是文档，也可能是设计本身还没有真正收敛。

但“容易解释”不能成为删除真实复杂度的理由；权限、unknown、failure、recovery、physical reality 等必要边界不能为了故事简单被省略。

## 真值边界

`public-docs/**` 是面向读者的投影层，不是产品/架构 authority。

真正的 canonical 领域文档位于 `docs/**`，入口为 `docs/README.md`。如果公共页面和 canonical owner 冲突，以 canonical owner 为准。

外部标准、事故和成熟系统只作为设计 Evidence / prior-art mechanism；它们不会因为出现在案例页，就自动改变 SEC architecture。

## “文档里有”不等于“已经完成”

SEC 明确区分：

```text
提出
→ 接受
→ 规范化
→ 实现
→ 验证
→ 强制
→ 采用
→ 旧路径退役
```

因此公共文档不会因为一个设计写得很完整，就把它展示成已经可用。现实状态最终应由 machine maturity 与 Evidence 投影。
