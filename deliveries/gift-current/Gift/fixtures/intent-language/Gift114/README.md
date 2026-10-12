# Gift114：意图 → 联合有限规划 → 本地持久 TypeScript 应用（历史研究说明）

**研究对象**：原本地模型装配参考；不执行外部世界效果，不是生产 Gift Compiler、Grant 或 Provider。复用 **Gift112 原意图结构**、**Gift113 联合规划代码**、现有 Meaning/Method 库和 Schema；没有用业务名称决定模板的代码分支。

原实验主入口：`build_app.py`。生成代码：`runtime_template.ts`；自动生成的 `contract.json` 必须与编译时的 SHA-256 相同，才会打开数据库。业务 Meaning 和方法引用在构建时检查；运行时类型化重评估已锁定的方法前提、目标和所有维持约束，过期前像拒绝，不因编译时模拟通过便跳过执行时检查。

原实验在完整源码根运行，环境要求（已安装 Python `jsonschema`、Node 22.16、TypeScript 和 Node typings）：

第二种能力：联合提交病床请求和 GPU 类请求所共享的有限容量（把两个 module 都放进 `--module`，模型用 `Gift113/model-shared-pool-2.json`）；容量 1 的同源模型则不能生成可完成双方的方案。

第三种真正新领域：`create_document_fixture.py` 生成/保留 `meaning-document.json`、`intent-document.module.json`、`methods-document.json` 以及不同输入快照。构建时直接引用这些文件，实现已批准文档的本地 `published=true` 事务，**不对外发布文档**。

测试：原实验入口 `fixtures/intent-language/Gift114/test_generated_app.py`。它重新生成代码，在 `--strict` 下构建、跨进程运行、用原生 SQLite 客户端独立检查结果、注入 SQL 中途错误检查回滚、验证语义/前像/幂等/篡改拒绝。需已安装的 `tsc` 和 `@types/node`；该测试脚本可通过 `GIFT114_NODE_TYPES=/path/to/@types/node` 指定严格构建依赖（不会联网）。

自举/生产边界：单次计划只能应用于编译时的原始模型修订（或用相同操作 ID 重放 receipt），否则必须对新模型重新编译与资格化；不会把模型当作现实医院、云账户、网络事务。Node 22 的 `node:sqlite` 属实验接口，原实验未证明生产吞吐和长期 ABI。
