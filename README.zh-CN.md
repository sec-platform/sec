# Engineering Workspace Compiler

本仓库沿用早期历史名称 `sec`；该名称不作为当前项目定义或缩写。项目后来已经收敛为更准确的定位：**Engineering Workspace Compiler（工程工作区编译器）**。

它以本地优先方式，把产品意图、结构化工程语义、受治理源码事实、实现决策、验证证据与目标环境约束，转化为对真实软件工作区的受控变化。长期方向是让人和 AI 主要工作在意图、语义、约束、责任、效果与验证层，而让传统编程语言源码越来越成为类似汇编的较低层实现/编译目标，而不是唯一最高层的工程表达。

这并不意味着现有编程语言将被淘汰。它们仍然是重要的目标、互操作界面和可检查实现层。

## 核心边界

本项目不是低代码运行时、模板市场，也不是自由式整仓 AI 编码器。Canonical 工程事实需要通过明确的语义、authority、identity、effect、readback 与 evidence 合同建立；CLI、AI、图工具和报告只能读取投影、提出受限 proposal，或在已授予权限内执行操作。

## 阅读入口

1. [面向所有人的中文文档](public-docs/README.md)
2. [公开架构总览](ARCHITECTURE.md)
3. [当前项目状态](PROJECT_STATUS.md)
4. [产品与边界](docs/product.md)
5. [文档知识系统](docs/documentation-system.md)
6. [设计演算与原则语言](docs/design-calculus.md)
7. [通用工程设计宪法](docs/engineering-constitution.md)
8. [通用 Agent 行为宪法](docs/agent-constitution.md)
9. [系统架构](docs/system-architecture.md)
10. [实现架构与意图编译](docs/implementation-architecture.md)
11. [语义模型](docs/semantic-model.md)
12. [编译与目标 IR](docs/compiler-target-ir.md)
13. [Canonical 文档导航](docs/README.md)

公共文档是面向读者的知识投影，不取得第二套产品或架构 authority；精确语义仍以 `docs/authority.json` 定位的 canonical owner 为准。

## 开源

本仓库正在准备以 **MIT License** 公开发布。项目自有的实现代码、规范、架构与设计文档、测试以及其他可版权工程材料，计划统一按该许可证发布；这些材料所承载的工程知识也将因此公开可检查、可学习并可在许可证及适用第三方声明的范围内复用。

公开仓库不等于宣告所有设计已经实现、接口已经稳定或产品已经达到生产就绪状态。

## 开发入口

从 [仓库开发入口](AGENTS.md) 进入。当前 Git、PR、CI、Review 与活动 Work Package 由 document control plane 的受信 resolver 实时解析；Verification 执行集合是 selector 投影 `RequiredClosure ∩ MissingOrStale`。README 是导航，不保存命令实现、SHA、PR、完成能力清单或当前 blocker。