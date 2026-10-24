# 从专业模型到实际require的完整源码工程

这是一份设计校准工程，不是已编译的服务。所有活动源在design/library；changes及model-cases.json不在活动范围。

- [模型及数学候选](library/models.module.json)：RecoverySpec、RecoveryRemoved、RecoveryForced；ChoiceSpec、OnlyZero、OnlyOne。候选没有自签自己的所求公式。
- [原Rule角色的专业声明](library/contracts.module.json)：明确主体类型、准确规范引用与公式；由原sem:Interpret按profile返回Rule声明。
- [恢复要求的真实消费者](design/recovery.module.json)：通过req:composite的require/fields绑定一个service。
- [同一主体的两个要求](design/both-options.module.json)：两项要求必须由同一service满足。
- [后继源](changes/recovery-after.module.json)与[补丁](changes/inevitable-recovery.patch)：仅更改同一require发生点的公开引用。
- [数学比较输入](model-cases.json)：完整状态关系和所求公式，非生产UseBinding、证据或作者协议。

语义由[同一规范](../../../schema/author/first-layer/SEMANTICS.md#model-contract-use)拥有。库声明不代签已取得Method；源模型的true不代签真实产品；前向模拟也不代签全部高阶性质。应用作者没有新增必须手填的IR、状态映射或证明账本。
