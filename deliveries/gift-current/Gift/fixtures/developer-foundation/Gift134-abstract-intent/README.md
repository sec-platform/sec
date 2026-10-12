# Gift134：只包含非计算业务抽象的开发者工程样例（历史研究说明）

## Gift135：无计算Body的业务作者固定值与条件

示例仍使用`gift.project/1`选定`IDEProduct`与`IDEGoal`两个根。`foundation.EditorCapacity.capacityLiteral`为`{ "magnitude": "32", "unitRef": "editor-slot" }`；`interaction.EditingQuality.terms[0].thresholdLiteral`为`{ "magnitude": "1000", "unitRef": "millisecond" }`；`SaveWorkflow`等待条件以`conditionRef: "platform:SaveMeaning"`引用；产品组件声明`capacity`参数槽，并由`IDEProduct.components[0].argumentBindings`显式绑定。这些是**候选`/2`结构**，不含通用计算`Expr`，也没有证明外部设备或编辑器实现存在。

Schema还支持纯业务`workflow:plan`决策节点：条件路由必须用`whenRef`引用专业Meaning、`nextStep`引用当前流程步骤，`onUnknown`明确阻断或交给人工；一个内存构造的分支正例由检查器独立核对。条件重叠、来源未知和实际业务成功仍需正式消费者。

原实验使用入口 `check_noncomputational_author.py`执行项目、模块、导入/导出、两种业务值、参数槽、流程与状态静态检查，并用负例验证严格拒绝。检查结果只证明本地设计结构；外部`ext`供应、Meaning解释、Method、Target和真实读回保留`Needs`。旧`/2`含`Expr`的范本仍用于兼容性检查，不能据此称计算语义已进入本阶段。

原样例从Gift133实际多模块示例精确删除了`core:function`、`core:constant`、`native:implementation`、`data:query`及流程中的计算步骤。保留领域对象、状态机、事件流、容量、文件效果、API、流程、权限、质量、UI和产品根，连同另一个`gift.author-module/1`的六模态Goal。**此操作并不宣称这些定义已经取得业务合格解释，更不声明生成了IDE。**

- `gift.project.json`：选择`module:ide-system / IDEProduct`和`module:ide-goals / IDEGoal`两个同一目标的公开根；按`gift.project/1`声明五份Module及源码范围。
- `design/foundation.module.json`：业务数据对象（`core:type`在本示例只用作名义数据形状）、领域状态与事件、数据持久状态和资源容量。容量里的`literal`是原提案已有的结构取值示例，本阶段**不定义通用计算语义**。
- `design/platform.module.json`：业务保存意义、外部文件作用、公开协议、并发、权限及观察。所用外部`ext:*`服务和Dialect目前仍**未安装/未资格化**。
- `design/interaction.module.json`：只有效果和等待的保存业务流程，以及交互界面、质量要求，不使用函数求值步骤。
- `design/system.module.json`：产品组件、能力和环境要求，仅描述作者希望组合成的软件。
- `design/goals.module.json`：六模态意图与期限、条件。外部Meaning导入保留原候选信息，不被冒称为真实合格Observer。

**设计检查**：原实验采用的`gift.project/1`及当时候选`gift.author-module/2`JSON Schema能对工程/模块做结构验证；原有`/1`Goal继承原例固定字节。不同Module的真正产品级语义联合、Meaning与Method/Target资格不是此样例的验证范围；不要补造`gift.lock.json`、编译后源码或运行结果。

**源码规模不是验收条件**。业务源允许引用已有专业定义；未给出专业定义时必须保留未决状态，不强迫开发者用普通函数填补解释的空白。
