# Source Program Model 测试导航

测试与被测 owner 共置；同一 owner 的不同责任使用语义后缀，不按历史修补批次分组。

- `contract.test.ts`：源码输入范围与 production／test／resource 表面分类。
- `repository.test.ts`：仓库模型组装、descriptor exports、能力和 Provider 边界。
- `repository-responsibility.test.ts`：语义责任绑定、issuer／recovery 和 causal readback。
- `typescript-lowering.test.ts`、`typescript-exact-facts.test.ts`：语义 lowering 与精确 compiler generation 的观察资格。
- `typescript-incremental.test.ts`：增量失效、完整编译等价、缓存采用和 workspace 释放后的继续编译。
- `typescript-fact-shards.test.ts`：fact shard 的编码、解析、不可变快照与组装边界。
- `workspace-typescript-project.test.ts`：ProjectInput 配置 containment、根目录和传递依赖；配置解析本身仍在 `workspace-typescript-config.test.ts`。
- `reduction-plans.test.ts`、`reduction-supersession.test.ts`、`reduction-test-retirement.test.ts`：reduction 的计划、替代证据与测试退役。
- `test-disposition-decisions.test.ts`：作者判断、采用资格与精确 relocation 对应关系。

其他测试按同名 owner 或明确责任后缀查找。`test/` 仅放确有多个消费者的 fixture，不注册测试，也不在导入时编译模型或签发证据。跨步骤依赖同一编译代次的观察留在同一测试内。
