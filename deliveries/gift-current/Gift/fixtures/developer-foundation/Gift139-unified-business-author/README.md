# 业务作者模块的历史案例：单一产品根（设计级示例）（历史研究说明）

本文是 Gift139 **参考输入的说明**，不是第二份规范、生产编译器或已经建成的 IDE。原 Gift137 四根示例在自己的历史目录保持不变。

- 一个 `gift.project/1` 工程清单，所有五份 `design/*.module.json` 都使用候选 `gift.author-module/2`。
- `intent:goal` 使用同一 `/2` 容器；其 `body.representation` 仍为 `gift.intent-body/1`。模块版本与 Body 版本独立。
- 仅选择 `IDEProduct` 一个目标根。`IDEProduct.requirements → goals:IDEGoal`、`workflowRefs → interaction:SaveWorkflow`、`policyRefs → platform:SaveAuditObligation`（两者按`DefinitionUse`明确绑定`document`角色），其余组件经 `components` 绑定；这些都是**不同种类的关系**。
- 引用必须解析到模块公开出口、确定 Definition kind、正确角色绑定；引用名碰巧相同不代表拥有Method或运行权限。
- `ext:*`、Meaning 的 interpretation、Observer 及 TypeScript/Electron Target 仍属外部候选；没有真实锁与资格。不得生成虚构 `gift.lock.json`、Stub服务或宣称IDE已经能运行。
- 原实验使用入口 `verify_unified_example.py` 运行原实验目录的**设计级**类型化引用与反例检查。

为避免作者双写：新业务模块只选择当前 `/2` 设计格式；原 `/1` 保留为历史读取来源，若确需迁移，必须提供显式身份映射、来源前像和可验语义保持，不得修改历史源码后假称它原本是 `/2`。
