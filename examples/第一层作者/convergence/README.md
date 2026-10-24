# 表达收敛的完整源码工程

`gift.project.json`只激活design/*.module.json。models包含22个完整专业Definition；surface包含8个简写/局部规则定义；unicode-client是实际跨模块中文公开引用；legacy-rule/legacy-use包含旧四种规则声明及真实req:composite使用点的完整候选迁移。before和changes都不进入活动源。

- [准确语义](../../../schema/author/first-layer/SEMANTICS.md)与[结构/供给](../../../schema/author/first-layer/README.md)是这些模型的唯一解释入口。
- [模型源码](design/models.module.json)与[修改后完整源](changes/models-after.module.json)只改变观察映射和一项公开值；原来不同请求的结果不能被旧缓存冒用。
- [旧Rule](before/legacy-rule.before.json)和[旧消费者](before/legacy-use.before.json)是依据真实规范形状创建的本地校准，不是整仓原件；新源分别在design下。

模型、供给、正式解释器和运行资格不同。这是设计源，不是可直接安装的软件包；生产Reader、类型/专业解释、目标和运行尚未接合。原样保存不读取真实账户、时钟、文件或设备，不产生任何权限。


## 精确专业边界与原例的共同继续

原models的22个定义和surface的8个定义保留；其供给分别固定到`design-semantic-boundaries`与`design-surface-boundaries`。原后继源仍只改变HiddenGuess观察及Noninterference的一项公开输出，补丁与前后源共同保持。选择政策的准确标签为`hard-feasible-not-proven-dominated`，它不把缺测候选认证为真实Pareto前沿。

[boundaries.module.json](design/boundaries.module.json)新增六个正常定义：显式声明但始终为假的命题；嵌套CTL从当前状态起算；三元积的第二成员投影；空程序的一个空稳定模型；完整信息的数学策略但不授予真实观察；urgent相对非urgent的明确优先。它们使用同一候选容器及原Interpret入口，不建立另一作者协议或目标服务。

[semantic-boundaries.json](semantic-boundaries.json)给出28个专业payload边界和3个选择政策输入，逐项保留期望阶段、正常对照和区别。它位于design之外，不因含负例而使活动项目非法，也不成为生产测试注册表。形状接纳不能代替名称/类型/模型资格：未知命题、混合公式、越界投影和未受控递归可以结构合法而在语义阶段拒绝。数学false、条件化未定义、策略成立但缺现实观察又是不同结果。有限计算与结构核对由交付回执报告，不把期望字段当已运行证据。
