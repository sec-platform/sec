# 检索工程要求的完整解释

本文是engineering.module.json中semantics.source指向的设计含义拥有者。每节对应其准确section；implementation=unbound表示方法未实现，不表示规则含义为空。它们消费同一次SourceSnapshot、实际SourceModel主体、准确Binding/公开合同与任务输入；不引入未知脚本解释器、运行阶段或新的数据平台。

## inputs

名义SourceModel主体从真实节点及其完整origin/basis发行。原始输入类别及实际资格由../README.md固定。规则声明的每个字段按同名subject取得同一主体；没有输入不能当空、false或成功。源图、运行方案、将来Artifact和已观测现实分别解释。需要实际代码/运行事实的方法在原inputContract/reads中声明准确来源与覆盖；未取得只使依赖保证未决。

## formation

project是当前同一捕获候选。command/querylib/admin分别是其rust/command、rust/querylib、ts/admin真实输出声明。kernel/entry/data分别是command/CommandLine中的queryKernel/serviceEntry/dataAccess实际ComponentUse，ui是admin/AdminUI实际组件根。所给组件必须与source selector结果相同，不由相同模板或同型Subject替换。querylib明确选public/QueryLibrary系统门面；其唯一queryKernel子成员采用同一私有QueryKernel Definition并取得该根自己的self/business。门面公开真实QueryPort并保留真实StrategyPort需求，是独立库消费边界，非服务kernel运行对象。CLI原三成员及四功能角色不因门面新增而重选。

serviceNode为entryNode方案节点；kernelNode、entryNode、dataNode准确指3成员，全部replicas=1。deployment.environmentRef必须选本画像的纯ServiceEnvironment常量，3个placementRef逐字匹配其processKey，nodeIds集合恰为这3节点；UI的target/root必须与排除项一致且不属于此共同进程。完整有限环境解释见units-and-environment.md，不把未知Definition Kind或相似URI当环境。数据路径从DataAccess公开IndexPort到ServiceEntry，查询路径从QueryKernel公开QueryPort到ServiceEntry，UI通过ServicePort精确宿主进口到此服务边界。必要端口不允许多供给、隐式宿主或未说明的传输。实际Target必须建立上述作者对应及QueryLibrary公共/私有贡献对应，不从拓扑名猜可执行入口。

## business-and-api

base、business、publicAPI固定原需求/原公开边界与来源。候选共同满足business全部已承诺合法输入和环境下的结果、错误、效果、取消、寿命及进展；实现不得通过缩输入域、增加未知错误或无限等待通过。publicAPI兼容按原观察/调用域判断，包含输入接受、返回/错误、允许效果和寿命；新增回调输入或公开返回变体分别核旧消费者，不只比较名称/结构签名。所有条款指同一候选实现。

## assets

unmanagedAssets是base准确捕获的完整非受管成员及其目标输出对应。每个要求保全成员保持原字节及原合同要求元数据；格式化、重编码/正规化后文本相等不算原字节保持。未知覆盖、权限失败或未读取成员不是缺席；不允许把它们从集合删去。受管生成成员按各自生成owner，不以本规则获得覆盖原手工源权限。

## dependencies

P固定当前候选及本次真实所选Binding闭包。I(P)是全部实际采用/链接/初始化的实现出现，含原有与新引入供给，保留准确职责及身份。Forbidden(P)恰为I(P)中真实职责包含UI呈现/交互、网络外部通信或存储访问实现的成员，非作者可挑自由变量。

从kernel的实际选定Definition/实现开始，沿本用途真正编译依赖边取得最小可达闭包Reach(P,kernel)。边种类包含所选语言/Binding定义下进入该边界的类型、值、初始化、原生链接及构造依赖；不以目录名/grep近似签完备，不略掉混合供给内部耦合。要求kernel本身无上述禁止职责，且Reach与Forbidden不相交。

给定有限捕获图，可达等于有限路径闭包；该定义唯一，新增供给、边或职责会使准确读集/负依赖失效。缺完整I、边或职责来源时缺对应覆盖，不能填空集通过。不是要求当前实现一个图算法。

## runtime-boundary

kernel接收的查询/快照为business给定值，运行可用本体纯计算和所声明StrategyPort。所有其他可观察运行调用必须通过该次公开值/策略边界，不能经getter、闭包捕获、初始化、回调或原生绑定暗取网络/UI/存储能力。编译依赖合格不自动证明运行边界。策略若使用允许外部能力，其效果须在原business/公开边界已接受；不能把委托变成逃避纯核约束的后门。

## index-owner

business指定的全部可变索引状态，不只当前已见几个字段，其真实写入owner是data。服务/UI可以请求公开索引操作，但写Effect/事务/状态改变的实际实施主体必须映射为data，不能另有私有绕写。实际读合同不授写权限；source-model组件身份不授真实存储Grant。若原业务允许其他独立状态，精确不属于该索引集合，不按字段相似扩大/缩小。

## process-budget

budget必须恰为data的serviceMemory owner ResourceUse，所用resource:model为ServiceMemory；其唯一capacityLiteral提供上限，单位解释见units-and-environment.md。kernel、entry、data方案节点必须属于同一ServiceProcess，3者全部实际进程占用归此同一预算，不各复制一份容量。索引、缓存、输出缓冲、基础运行与共享页按memoryMeasure计量，成员/临时/委托策略不能从范围漏掉。

对workload允许的全部执行/测量时域，按memoryMeasure已接受不确定性和完整覆盖解释，共同峰值不超过该预算容量。单组件各小于上限不足以推出整体；未经接受不能偷偷串行化查询、缩小数据或改变取消/响应合同。容量是设计约束，不是已获物理额度；实际预留/准入仍由原资源owner与运行资格承担。缺方法/观测不能被当成零占用。

## cancellation

对每个business承接查询，其取消完成观察点必须已结算该查询独占临时资源，不留在途领取/使用责任。请求取消、用户停止等待或超时不能冒充完成；释放失败保留未完成及准确失败。共享资源不因一个查询取消而误回收，原正常错误、宿主故障与未知分支仍各守原合同。

## shared-index

索引仍有合格使用者时不得回收；最后使用者退出后，在business/环境的已接受进展前提下最终履行共享回收和资源结算。逻辑引用数为0、发出release请求或关闭某个库消费者，不自动证明物理释放。querylib独立消费者的状态/寿命不归CLI进程同一性推导；是否共享实际索引须原实际绑定，不因同Definition共享。

## upgrade

base中的每个已确认索引commit按其原身份/内容/版本及读取合同，在候选升级后仍能取得原保证；数据迁移和实际读写方式沿原数据/演进owner。没有扩大为所有未确认数据、新格式与任意回滚均无损；旧请求/已发生作用不因新源码被改写。共同原工程输入固定，不能为本条临时选另一份便利base。

## strategy

对kernel每个已接收query，在该次处理开始选择一个满足同一business查询、结果/错误/取消/进展和资源合同的实际策略。该次处理至完成/取消结算不切换这个绑定；选择不能依赖当时不可得的未来信息。全部策略和kernel的实际占用进入同一budget。共享可变状态沿index-owner，不因替换策略多建余额/状态。

本规则不强制Rust trait、class层次、动态插件、额外服务或线程；这些仅有作者明确实现控制时固定。ReplaceableQueryStrategy为普通req:composite复用本纪律，非semantic:pattern-use。

## kernel-input

kernel完整提供所选business.QueryPort的原输入/快照到结果、错误、取消/效果/资源及进展合同，仅需要明确StrategyPort宿主输入。此为原业务合同采用，未复制算法；未给business或策略供应不能签库/CLI实现完成。若类型/合同不同，精确报告实例化不相容，不填一个空接口。

## entry-input

entry提供原ServicePort，消费准确QueryPort和IndexPort，保持原服务编排、认证/外部边界、错误/取消、输入接受与进展。源连接本身不授权网络或证明收发；所选业务合同负责正常行为，具体Method负责实现取得。

## data-input

data提供原IndexPort及其数据身份、读写/commit、版本、错误、资源/取消和正常进展。它承担该工程索引状态写owner及预算owner声明；拥有责任不表示可以越过权限或任意改业务数据。

## admin-input

ui提供原AdminPort的完整交互/可见结果与可访问性，消费ServicePort并绑定同一工程服务端；它不是只声明类型的空组件。布局/视图/传输从所选真实业务合同取得，不要求本模板重造UI代码。无服务宿主或UI实现时准确缺项，不能将其标成独立可运行界面。
