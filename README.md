# Engineering Compiler

SEC 是本地优先的 Engineering Workspace Compiler：把产品意图、结构化工程语义、受治理源码与既有工程证据，确定性地编译为源码、测试、文档、Gate、Agent、Release 与 Evidence 投影。

SEC 不是低代码运行时、模板市场或自由式整仓 AI 编码器。Canonical 工程事实由编译器与受验证合同重建；Workbench、AI、图工具和报告只能读取投影或提交受限 proposal。

## 阅读入口

1. [产品与边界](docs/product.md)
2. [系统架构](docs/system-architecture.md)
3. [语义模型](docs/semantic-model.md)
4. [编译与目标 IR](docs/compiler-target-ir.md)
5. [文档导航](docs/README.md)

## 开发入口

```bash
bun install
bun run check:affected --plan
bun run check:affected
```

当前 Git、PR、CI、Review 与活动 Work Package 由 `sec-repository-orientation` 通过受信 resolver 实时解析；README 不保存命令实现、SHA、PR、完成能力清单或当前 blocker。
