# 表达收敛的完整源码工程

`gift.project.json`只激活design/*.module.json。models包含22个完整专业Definition；surface包含8个简写/局部规则定义；unicode-client是实际跨模块中文公开引用；legacy-rule/legacy-use包含旧四种规则声明及真实req:composite使用点的完整候选迁移。before和changes都不进入活动源。

- [准确语义](../../../schema/author/first-layer/SEMANTICS.md)与[结构/供给](../../../schema/author/first-layer/README.md)是这些模型的唯一解释入口。
- [模型源码](design/models.module.json)与[修改后完整源](changes/models-after.module.json)只改变观察映射和一项公开值；原来不同请求的结果不能被旧缓存冒用。
- [旧Rule](before/legacy-rule.before.json)和[旧消费者](before/legacy-use.before.json)是依据真实规范形状创建的本地校准，不是整仓原件；新源分别在design下。

模型、供给、正式解释器和运行资格不同。这是设计源，不是可直接安装的软件包；生产Reader、类型/专业解释、目标和运行尚未接合。原样保存不读取真实账户、时钟、文件或设备，不产生任何权限。
