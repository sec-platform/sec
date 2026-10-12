# Gift136 业务源码关系与角色绑定范本（历史研究说明）

原范本是对 `gift.author-module/2` **候选结构**的独立设计验证，不是已发布编译器或完整 IDE。六个模块仍沿用 Gift134 的身份和 Root；新增的只是作者可见的**限定、已绑定谓词使用和产品实例连接**，不是计算表达式、算法或新的 Definition Kind。

- `interaction.module.json`: 在 Workflow 中声明 `contextRoles.document`；`conditionUse` 将 `platform:SaveMeaning` 的 `document` 角色绑定到这次工作流的上下文角色。`routes[].whenUse` 复用同一谓词而不复制 Meaning；未知分支不是 `otherwise`。
- `platform.module.json`: `SaveMeaning` 显式声明角色基数；`EditorPermission.qualifiers` 引用外部权威及工作区范围，但**不授予**现实执行权限。
- `system.module.json`: 实例 `Storage` 的 `FilePort` 明确连接实例 `Editor` 的 `FilePort`。仅有两个组件引用同一个端口名字并不能推导出系统拓扑。
- 完整 `product:system` / 目标源码 / Method / Provider / Grant 仍为未取得的产品资格。领域 Interpreter、外部锁和部署Target缺席时必须返回 Need，不能把这个范本说成已生成IDE。

`verify_composition.py` 对设计结构与本地有权声明进行有限检查，包括角色数目、类型、实例、方向和负例；**不会**执行 Meaning 求值、政策法律解释、资源求解或目标源码生成。

原例复制旧范本的工程根及必要模块只是为了构造一个可独立读取的最小交叉引用环境；不复制旧20KB的检查器或历史结论。只有原例的 `verify_composition.py` 负责原例的有限回归。
