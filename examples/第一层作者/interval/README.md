# 区间规范化：完整关系源，而非占位库

打开gift.project.json可看到仅design与library属于活动作者范围。design/normalize.module.json选择关系并给出纯调用接口NormalizeApi；library/interval-spec.module.json包含24个实际定义、18个纯解释函数，并完整导出所用类型和两种关系。复杂Definition使用同一compact codec的精确原形分支，不需另存另一份可写源码。

derived/只是移除短写后的/2只读对照，不在活动范围；changes/overlap-only.patch在本目录应用，只将CanonicalTouch改成CanonicalOverlap。normalize-after.module.json为比较结果，不复制进design。项目未放一个虚构Target来假装Library/CLI已存在。

完整规范、证明思路、输入/输出/CLI接口、实现方案和恢复边界由[区间关系与消费](../连续修改与反例.md#interval-machine-relation-closure)拥有。机器定义只判断结果是否满足关系，不是产品Normalize实现；total标记不是终止证明或运行结果。

固定std:IntCompare、std:IntEq、std:IntAdd、std:SeqUncons、std:BoolNot的准确语义来自候选0acb144733f106beefc3609d721817816a2e3e8a的docs/领域/计算基础/文法类型与求值.md。Ordering的Less/Equal/Greater、Option的None/Some和有限Sequence按该合同解释；生产Reader、固定类型/效果解释及Target仍须真正具备相应资格。没有同名任意宿主函数或新隐式Provider。

本轮核对了JSON语法、局部引用、词法绑定、使用点参数个数、公开Meaning/解释签名、模式声明形状、patch及有限数学关系。未运行此Gift程序，未实现其编译器或安装扩展；并非全部官方Schema/类型/目标验证。关系论证及有限计算口径见前述规范；原始运行回执保留在相应离线交付，不作为当前产品能力证据。

## 名义结果接合修订

本次累计修订将CheckOutcome、TouchBody、OverlapBody、CanonicalTouch、CanonicalOverlap的outcome参数统一引用已公开的`local:Outcome`，不再在签名中复制匿名variant。类型形状、关系规则和所有函数主体保持；Goal及接口仍引用同一结果类型。此项修复不等于运行Reader或完整产品类型检查。
