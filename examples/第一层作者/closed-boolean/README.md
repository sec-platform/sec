# 有完整本地引用的有限关系作者样本

这是设计源码，不是可运行产品、生成器实现或已经安装的库。它沿候选修订的既有 `gift.project/2`、`gift.author-module/2` 和 `intent:goal` 字段写成，没有扩充 Schema。

## 第一层输入与准确含义

第一次：只有同时被选中且可用时才保留；其他情况不保留。只计算决定，不执行删除、移动、通知或任何外部动作。

三个角色均为准确 Bool。本例的消费合同把 selected/available 作为一次调用输入、keep 作为正常输出，要求 keep ⇔ (selected ∧ available)。角色方向在此消费合同中明确；Goal 的角色名字或参数顺序本身不产生运行调用、输出根或求解许可。

`design/choice.module.json` 含 Bool、RelationBody、KeepRelation、KeepGoal 四个真实局部定义。RelationBody 判定一个已给定三元组是否满足关系；它不是业务实现，也不选择/产生 keep。其 literal/var/if 只定义有限的纯 Bool 关系，if 字段为 condition/then/otherwise。`termination:total` 只是需要合格接纳的声明；非递归有限分支给出此结构的数学终止理由，不证明任何生产读取器已经执行。

所有 local 引用都能定位到本文件的真实定义；解释函数参数、Meaning 角色和 Goal bindings 一一对应。这里没有导入、标准库函数、原生依赖或未提供的外部模块。

## 第二次修改

第二次：被选中或可用，只要至少一个成立就保留。关系改为 keep ⇔ (selected ∨ available)。`second-change.patch` 修改同一个文件中的解释函数主体，保持 moduleId、全部 Definition ID、角色、条款及导出身份。解释修订发生变化，相交的绑定与证据必须重核。

| selected | available | AND 的 keep | OR 的 keep |
|---|---|---|---|
| false | false | false | false |
| false | true | false | true |
| true | false | false | true |
| true | true | true | true |

这是有限数学定义的结果表，不是运行记录。对于每一行，RelationBody 对与该列相同的 keep 应返回 true，对相反 keep 应返回 false。仅生产一个恒 false 的结果不能满足完整要求。

源码项目仅纳入 `design/*.module.json`，补丁、说明和交付元数据不属于活动作者源。只保留 AND 一个活动前像，不把 OR 后像作为另一份同时生效的作者源放入项目。

## 已核对与未取得的资格

本交付核对 JSON 语法和重复键、本地 Ref/导出/词法变量、三处角色集合及对应 Bool 形状、同源补丁与保存内容；没有执行 RelationBody、产品解码器、目标编译、求解器或产品测试，也没有完整加载全部官方 Schema 做符合性验证。字段与分支依据固定修订的原 Schema 对照。

实际采用还要取得真实 Reader、专业解释资格、所选方法和目标。此项目没有声明产品输出根、构建配置或运行实例，不能把“没有输出目标”报成整个软件交付成功。它只关闭本样本的局部命名/引用缺口，不证明任意一般关系都可有效求实现，更不替代区间工具的专业机器定义、两个产品根或真实运行。

完整规范归属[结构载体](../../../docs/作者/紧凑结构与同源编辑.md#first-layer-closed-meaning-carrier)与[连续修改范本](../连续修改与反例.md#first-layer-closed-boolean-example)。开发者输入上面的两次需求，机械形成这些定义与 JSON 是系统应承担的工作，不是新增的手填表。
