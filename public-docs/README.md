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

按这个顺序读：

1. [从零认识 SEC](start-here.md)
2. [最短 Quickstart](quickstart.md)
3. [学习路线](learn.md)
4. [核心概念](concepts.md)
5. [术语表](glossary.md)

## 想知道为什么这样设计

- [原则与为什么](principles.md)
- [设计、成熟度与证据](decisions-and-evidence.md)

## 要完成真实任务

- [指南](guides.md)
- [故障排查](troubleshooting.md)

## 要查精确接口

- [Reference](reference.md)

## 要理解完整架构

- [架构学习路线](learn.md)

## 要开发 SEC 本身

- [贡献 SEC](contributing.md)

## 真值边界

`public-docs/**` 是面向读者的投影层，不是产品/架构 authority。

真正的 canonical 领域文档位于 `docs/**`，入口为 `docs/README.md`。如果公共页面和 canonical owner 冲突，以 canonical owner 为准。

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
