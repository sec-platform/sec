# 最终第一层候选：完整引用、精确根与第二次修改

本工程是[最终候选文法](../../../docs/作者/紧凑结构与同源编辑.md#final-first-layer-codec)的完整有限设计输入。它检验名称能否从完整/短作者Body经过导入、转导、项目选择和后继修改保持到同一公开出口；没有提供生产Reader、Target实现、安装包或运行结果。

## 一份作者源中的责任

| 文件 | 唯一责任 |
|---|---|
| [项目](gift.project.json) | 以`gift.project/design-converged`捕获design和library；默认只选择named目标的`审核/发布`出口。 |
| [应用](design/app.module.json) | 原input与outcome相等的Goal，引用准确中文库名；公开`审核/发布`、空名及`需求`三个不同出口。完整Goal中的typeRef与meaningRef都采用结构Ref。 |
| [库](library/logic.module.json) | Bool类型、真实纯回传函数、相等关系判定和Meaning。它是同一codec的短类型与完整函数/Meaning，所有引用可在本工程定位。 |
| [选择反例](selector-cases.json) | 缺席、空名、中文名、未解析出口及普通数据/词法名字边界的数学期望；不进入sourceScopes，不是产品请求协议。 |
| [结构向量](schema-cases.json) | Name/Ref、项目/包/原生选择、名称编辑、直接运行及递归被动输入的正向/负向结构边界；结果不证明名称解析或运行资格。 |
| [完整底座向量](complete-base-cases.json) | 参数化后原/2完整模块与递归Body的正反例，包含perform操作、Requirement/shared及Pattern/Intent选择器；缺角色绑定、原串解释或外部库时仍不具有语义资格。向量不进入sourceScopes。 |
| [短形展开与完整Body向量](codec-cases.json) | 独立给定S2/S3展开等式及S4正反期望；覆盖四类Requirement、递归字段、六模态、Type/Field、数据隔离、状态转移和歧义拒绝。纯展开测试与成熟Schema引擎分别消费；不证明S0词元无损、名义成员/方法资格或产品运行。 |
| [开发面边界向量](developer-surface-cases.json) | Exists递归Type、控制/供给精确名称、preview/check请求身份、会话主体及生成物完整后像的独立结构期望，保留旧Reader对照；roundtripWitness仅给I-R1完整后像等式，实际来源、作用域冻结、恢复和逆向回源须由各owner验证。 |
| [完整词法边界向量](lexical-boundary-cases.json) | Identifier、数字、编码、摘要和Pointer等19种原域的正常/拒绝值及98个真实节点；防止验证后端尾LF语义误收，保留Pointer内部换行、空bytes/base64及Name，不表示全工程等价。 |
| [第二次修改](changes/rename-public.patch) | 共同修改公开名和项目selector，保持模块、被引Definition、rootId及其他出口；不在活动源里再保存一个后像工程。 |

应用作者表达“输入是什么就返回什么”及公开出口选择；系统可以在已有库合同下形成这些结构。相等关系函数只判定给定input/outcome，回传函数才产生outcome；二者的正确关系可在固定Bool域逐值推导，但名称相近或同在一个文件不构成Method绑定。`需求`仍是独立Goal，选择函数根不自动证明系统已按Goal完成供给创作；若请求按Goal生成，需真实UseBinding、合格Method和相交证据。

开发面边界向量的`noControlStringContracts`列出原Schema中326个实际非空/C0+DEL排除节点，`noControlStringCases`给共同机制的11种独立字符边界。消费者逐引用验证，并检查候选图中仍保留该域的对应节点；已被Name替换的选择器按Name验证，不错误施加旧限制。这是同一字符串约束的消费者覆盖，不是326项独立业务保证；不得按PASS数量推断整个语言或运行符合性。

## 根选择的正向结果

named目标只选`审核/发布`，empty目标只选空名`""`。它们转导同一个纯函数，但公开出口及根发生身份仍各自存在。省略export会选择全部三个出口，其中包括Goal；不能在不支持Goal根时只生成两个函数门面却称整个集合成功。空串不是省略，找不到指定出口也不能回退到全部。

`profileRef`请求`design:ts-esm-exact-export`修订1，其有限设计合同是：消费已检查的纯Bool函数根；保持输入、输出、总终止和空效果合同；以原Target成员组合器交付对应的TS ESM源、声明、准确工具配置及SourceMap；外部运行依赖为空。公开出口以字符串别名保存准确Name，私有符号由原布局owner卫生分配，两个同函数别名可共享实现而不合并来源/根身份。这里的函数仅有参数读取及有限if，无运行资源；扩大构造支持仍回原Target，而非把此校准画像当通用编译器。

在支持任意模块标识符的TS/ESM工具链中，`export { privateName as "审核/发布" }`及空字符串别名具备语言层表达；实际Profile还须固定工具版本、输出模块制度、消费者及完整成员。该有限Target合同尚未有实现绑定，所以当前真正执行生成请求应保留Target/Method资格缺项；本工程不会因声明一个profileRef就得到假的ArtifactSet。源码选择、语言语法可行、实际生成及运行分别判断。

## 第二次修改与恢复

新要求仅将公开名`审核/发布`改为`审核/发布 v2`。在准确原候选上运行原R0—R5设计算法，subject必须定位到公开出口，不能只给一个文本搜索词。`changes/rename-public.patch`是该有限源码后像的对照：应用exports键和named目标selector同组改变，rootId仍为public，empty目标及空出口不变，函数和Goal含义不变。公开客户端的导入名是相交兼容义务，未取得的外部消费者不能宣称已更新。

真实跨客户端动作使用[名称修改payload](../../../schema/tools/source-name-edit-1.schema.json)，经原semantic-change/1 typed extension协商、固定base及可信binding；普通文本补丁本身不携带身份保持证明。只有SourceOwner已持有真实EditPlan与映射时，才可将它直接物化为files/edits。没有能力时仍可保全普通源码候选，不能把删除/新建猜成rename。

并发有人改了公开出口、项目根或引用集合时，旧补丁不直接覆盖。保留B/L/U并重算相交绑定、名称冲突和接受；相同文本或相同函数体不恢复旧身份。保存需同一实际写边界上的前像/恢复能力，缓冲文本修改、落盘、正式采用和已发生操作分别结算。

## 设计出口与证据边界

该例给出完整本地源、两个准确目标选择、完整调用/声明引用、明确Target差额及后继变更；它不依赖聊天补定义。Schema与静态源对应核对只证明所检查结构和此有限见证，不证明完整候选Reader、所有专业类型或目标运行。最终实现从同一源继续，不要求用户永久维护展开JSON、IR、目标代码或一份额外意图副本。
