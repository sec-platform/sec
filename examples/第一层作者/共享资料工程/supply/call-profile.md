# 同次调用的保留观察设计合同

本文件固定`profile:retained-call:1`，与[实际声明](calls.d.ts)、[原生选择](calls.selection.json)、[普通selector类型](../call-values.module.json)及[观察定义](../observations.module.json)构成同一设计来源。它消费[原同次调用观察合同](../../../../docs/作者/组合/定义与接口.md#scoped-call-observation)，不建立运行日志系统，也没有已安装的Reader、native adapter或事实采集实现。

## 来源、类型和阶段

RetainedCall是原调用、Effect、access及ownership生产者对一个真实发生c提供的名义保留视图。身份包括实际receiver或构造尝试、c、相位、ObservationUse及所绑定源修订；按`scope:retained-enclosing-call`只提供当前要求所属调用，不按同型、名字或相同返回值搜索另一次调用。它可以由已合格静态模型/证明承担，也可以来自充分的运行观察；两者的适用依据分别保留，不强制为每个调用物化日志。

该profile只接受正常Ok/业务Err完成后的完整区间。绑定先检查来源、完整性、可见性、同次身份及生命周期，再提供RetainedCall；before、Fault、Cancel、未完成或证据不足返回相应Need/不适用/冲突，**不提供一个残缺RetainedCall**。取得合格视图后，下列纯总函数才在其准确值域求值，不把Need藏入Bool或空序列。completeness:closed是待履行义务，不自行构成证据。

私有brand不是宿主属性，应用不能构造RetainedCall、伪造字段或借此访问私有状态。视图及其派生结果保留本次解释范围；允许同次共享只读和临时组合，不进入产品持久状态、公共返回或另一次调用。ObserveCall是有完整body的普通恒等函数，它只保持已取得的视图，不负责采集或签资格。

| 声明中的header类型 | 唯一Gift对应 |
| --- | --- |
| RetainedCall | 原生选择公开的同一名义类型；不提供构造/字段访问 |
| Rows | `module:shared-views-policy/Rows`；每个Row仍是该模块的同一名义Row，Text精化、顺序及重数保持 |
| OperationSelector | `module:component-call-values/Endpoint` |
| ConstructorSelector | `module:component-call-values/Constructor` |
| ErrorConstructorMap | `module:component-call-values/ErrorMap` |
| boolean/bigint/readonly array | 原Bool/Int/有序有限Sequence；string只在已合格Text域解释 |

这些是显式的声明header适配义务，不是靠TS结构相同推断名义等价。profile的依赖类型模块由同一工程源范围捕获，绑定须先解析准确出口再检查签名；缺该适配是生产资格缺项，不另造同形Rows或Any。Endpoint、Constructor及ErrorMap是上述普通作者record/sequence，可以按原值规则构造；原生type选择本身仍不授予opaque类型的构造能力。

## selector与错误注入

Endpoint.componentPath按当前实际组件composition逐级选择成员发生，port/operation必须在其准确接口中存在；空路径选择本组件端口，本例来源选择declared required端。透明连接归一到相同真实端点且不增调用；父操作真实派发到child仍是新的child发生。无法解析、越过未公开边界、错误方向或签名不符在链接时拒绝，不成为运行时“没有调用”。路径是此源修订的定位，C修改还须保持原发生对应，不能仅按名称猜同一实例。

Constructor分别保存moduleId、definition和constructor，避免把可含分隔符的名字拼接成另一个Ref文法。其moduleId/definition必须解析为实际接口的名义错误族，constructor必须存在；ErrorMap逐项声明child E到parent E的注入，源构造唯一且完整覆盖child E，目标构造和payload类型/值保持正确。父错误族可有无原像的Closed。空映射仅在child E为空时成立；本例为unit载荷。非保载荷的转换需要另一个真实有型定义，不能由同名字符串自动转换。

## 五个叶的完整解释

| 函数 | 确定结果与拒绝反例 |
| --- | --- |
| SourceRows(c,e) | 在c完整的直系成员/required端调用集合上判断，恰有一次派发、来自e所选required来源、归一目标正确、接口为Unit→Rows且E为空、输入Unit且正常Ok时，返回实际逻辑Rows的单项序列。其余确定情况返回空；两次相同读取、一次成功再一次失败、额外其他派发均为空。不是先按e筛选再数数，不重读子状态。e的签名/方向先合格，来源不足不能取空。 |
| Forwarded(c,e,m) | c恰有一次直系派发d到e，d接同一逻辑输入；Raw保持原SameValue/对象身份，不先复制/正规化再说同参。两者正常完成；d为Ok时c的Ok按相应准确O值关系相等；d为Err时c为m明确注入的Err。c涉及成员业务状态、访问、借用、写入及持有变化的足迹，只允许该真实d及其合格入口/退出合同所许可的范围；外层仅为该派发选择端点、传递同参、接收结果及纯值封装，不额外观察其他成员、改拥有树或取得/转交/结算成员持有。外层own状态仍由自己的合同约束，本例允许closed守卫。禁止额外派发、不派发而造结果、偷换名义错误或吞并失败。不需要暴露Any型input/result。 |
| NoMemberInteraction(c) | 整个c无成员/required派发、成员handle/state业务读取、借用、写入或调用，也未观察/解码/验证公开raw内容。仅接收/绑定opaque参数不算读取；读取own closed允许。按原custody结算已持有责任不算业务读取，另由下一关系约束。只数调用为0不足以证明它。 |
| SourceBorrowSettled(c,e) | 上述唯一来源调用产生并由c消费的全部借用在正常完成前正确结束，无悬挂、重复结算或向输出逃逸。独立拥有的输出不随其失效；实现若以合格拥有值完成同一逻辑快照，则无对应借用，不强迫制造借用对象。来源及生命周期证据不足不能默认true。 |
| EntryCustodySettled(c) | 原owner在c入口持有的每项H，在c内正确结算恰一次，没有越界或重复结算；已交给调用者的独立值不属于H。H为空时要求没有此类结算事件，因此重复close为零结算。保留事实不要求物理free、全局计数器或关闭后重读子状态。 |

这些解释都只投影真实或合格模型事实，不执行child调用、原生raw观察或释放动作。它们不会让符号公式的implies变成运行短路；实际方法仍须保持Closed先于任何成员/raw观察。访问覆盖、别名/借用及custody须由其真正producer或适用静态证明承担，仅有返回值日志不够。profile没有业务操作名；源中的Endpoint/ErrorMap决定本次采用，抽取组合不修改profile暗藏路由。

Forwarded的足迹封闭与原组件私有状态合同共同排除具体旁路：Workspace调用Store.replace一次并原样返回InvalidInput，却直接写preview.threshold，不能满足该关系和组件访问规则。额外读取其他View、结算未被委托成员持有、先改后恢复子状态也不能因最终值相等而通过。纯目标表示临时值及其词法清理可以存在，但不得变成另一次成员访问或改变原逻辑持有；其资源仍沿真实目标合同计量。这项条件适用于set/read/replace的所有正常分支，不增加一个只为此反例存在的应用谓词。

构造的同一完整见证、成功发布、失败不发布及临时取得部分的清理继续由原组件语义承担；不为这些已有义务增加重复应用predicate。同步、不重入与允许资源前提由本工程接受范围承担；此profile不声称已解决异步开放区间、外部故障或全部运行采集。

## 可实施性与尚未执行的资格

一个有限同步调用的构造性实现可以通过确定的路由、词法作用域、只读借用和一次性清理静态保留上述关系，也可以在必要时提供有界保留记录。SourceRows只需唯一调用结果，Forwarded比较同次输入/结果及已检查错误映射，两个无访问/清理关系沿现有Effect和custody规则证明；无需读所有子状态。这个有限方法路径说明理论可落实，不是已经执行的采集器、证明器或后端。

生产Reader对profile的选择、header名义类型适配、原producer关联、静态证明/实际采集、目标生成及运行均未执行。源声明、这份完整解释和准确实例关系可用于设计审查；不能把它们升级为已安装能力或实测收益。
