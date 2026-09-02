# Engineering Compiler

SEC 是本地优先的 Engineering Workspace Compiler：把产品意图、结构化工程语义、受治理源码与既有工程证据，确定性地编译为源码、测试、文档、Gate、Agent、Release 与 Evidence 投影。

SEC 不是低代码运行时、模板市场或自由式整仓 AI 编码器。Canonical 工程事实由编译器与受验证合同重建；CLI、AI、图工具和报告只能读取投影或提交受限 proposal。

## 阅读入口

1. [面向所有人的中文文档](public-docs/README.md)
2. [产品与边界](docs/product.md)
3. [设计演算与原则语言](docs/design-calculus.md)
4. [通用工程设计宪法](docs/engineering-constitution.md)
5. [通用 Agent 行为宪法](docs/agent-constitution.md)
6. [SEC 系统架构](docs/system-architecture.md)
7. [SEC 实现架构与意图编译](docs/implementation-architecture.md)
8. [语义模型](docs/semantic-model.md)
9. [编译与目标 IR](docs/compiler-target-ir.md)
10. [Canonical 文档导航](docs/README.md)

公共文档是面向读者的知识投影，不取得第二套产品或架构 authority；精确语义仍以 `docs/authority.json` 定位的 canonical owner 为准。

## 开发入口

从 [仓库开发入口](AGENTS.md) 进入。当前 Git、PR、CI、Review 与活动 Work Package 由
document control plane 的受信 resolver 实时解析；Verification 执行集合是 selector 投影
`RequiredClosure ∩ MissingOrStale`。README 是导航，不保存命令实现、SHA、PR、完成能力清单
或当前 blocker。
