# 参数化检索工程：结构、要求、控制与修改

[工程入口](../retrieval.project.json)、[装配](source/assembly.module.json)、[完整要求](source/engineering.module.json)、[控制](design/retrieval.control.json)及[预算修改](changes/256-mib.json)共同给出原检索意图的准确作者源。这里交付可复用的工程迁移设计，真实业务输入与目标实现仍须在采用时取得；没有重写查询业务或新增模板解析器。

## 输入模板与实际激活分开

新增工程规则及其引用在本工程捕获闭包中闭合；唯一外部模块依赖 `module:retrieval-business-input` 是**实例化时必须选择的真实既有模块**。`selected-business`、`selected-assets`是Project明确声明的待捕获输入范围，不因目录名存在就算已有供给。它们当前未提供，故本模板不能被签为可激活具体工程；缺业务输入不表示下面工程规则没有含义。

实际选择模块可以保持原moduleId并同步改imports，或通过已有真实导出facade提供该导入身份；不得复制原行为、填空core:interface、空Meaning或编造Provider。模块必须给以下准确出口，类型/行为都按原业务定义固定：

| 出口 | 种类及实际合同 |
|---|---|
| QueryPort | core:interface；对已给定查询与数据快照的全部合法输入、正常结果、错误、取消/进展、效果与资源；kernel不自行获取数据或网络 |
| StrategyPort | core:interface；同一查询/快照下可替换策略的实际调用与结果、错误、取消和资源合同；策略供应者可能由原任务选择/形成，不能以宿主进口空缺称CLI已完整 |
| IndexPort | core:interface；原索引读取、写入、提交、修订与已确认记录的公开观察/错误/资源合同 |
| ServicePort | core:interface；服务输入/结果/错误/取消与其明确传输/会话实现对应；声明同名端口不自证网络或宿主绑定 |
| AdminPort | core:interface；真实管理交互的公开边界、输入与可见结果/可访问性；不是空查询函数或只有声明的UI |

这组出口不是新增业务库。若原业务接口形状与本例不同，实例化选择其准确对应并同次修改连接/目标映射，不在实现者不知情时偷偷改原API。其完整源码、资产与采用来源由原捕获输入提供，本模板不重写查询或索引功能。

`input-subjects.module.json`里的OriginalProject、BusinessContract、PublicAPI、UnmanagedAssets、Workload、MemoryMeasure是名义**形式输入类别**，没有构造器或自动issuer；空roles表示无公开子角色，不表示任意空对象合法。实际任务采用须提供：

- base：准确原SourceSnapshot/作用边界、原布局和旧已确认索引；不能用当前候选Project代替。
- business：被接受的同一原业务合同、接口Definitions、允许输入/错误/效果/进展/资源；不能只是字符串标签。
- publicAPI：原公开符号与可观察合同、目标源码/ABI及其准确来源。
- unmanagedAssets：完整已捕获非受管成员、原字节/需保持元数据、目标对应；未知覆盖不当空集。
- workload：此次性能/资源承诺的全部查询、快照规模、并发、取消与环境域；不能为达标临时缩域。
- memoryMeasure：进程边界、计量时域/峰值、共享页归属、基础/缓存/缓冲占用、单位、误差、缺测与覆盖。

这些实际对象来自真实任务SourceOwner/Context，存在合法issuer/scope与同一来源。不可手造opaque objectRef绕过干净克隆的恢复义务；任务/捕获来源必须按现行作者系统可恢复，外部输入未给则保持缺输入。Project的contextBindings已明确把三个根接到同一激活任务的真实角色：command取得六项输入，querylib/admin转传同一business，UI的self选择其真实根组件。缺任务上下文是准确的实例化缺输入，不靠省字段、同名猜测或另造一份business补齐。

## 三根与自绑定

rust/command的CommandLine是system，其成员固定queryKernel/serviceEntry/dataAccess；ts/admin是AdminUI组件根；rust/querylib选public模块的QueryLibrary系统门面，其唯一queryKernel成员采用同一private QueryKernel定义。三者属于同一Project，输出声明与运行实例不合并。QueryLibrary.publicEndpoints.query将这个真实成员的QueryPort公开；externalRequirements将该成员的StrategyPort保留为明确宿主需求，无空函数或没有行为的占位门面。

CommandLine的6个外来formal由上述任务实际输入绑定。三个ComponentUse显式把business传下，并将self绑定到本根真实对应组件。QueryLibrary根只有business formal；它向子queryKernel转传business，并显式把子self选为rust/querylib/QueryLibrary路径[queryKernel]，不把system根空路径强转成组件。UI根实际激活时self为`{source:"occurrence",selector:{kind:"component",componentPath:[]}}`，business为该任务真实业务合同。self选择由源头先收集真实成员再定型，不启动组件或取得运行权限。

查询库复用同一QueryKernel Definition与业务语义，不分享CLI的可变索引、临时资源或进程预算。库的公共查询源码贡献由public/QueryLibrary门面拥有，行为实现由该根private子queryKernel贡献，两者必须有真实生产对应；不能直接把private模块声明导成库公开面以绕过preserve。当前库QueryKernel仍声明StrategyPort需求；库画像须公开该真实宿主策略输入，不能以允许进口为由交空函数。CLI的未绑定策略需求只能作为尚待选择/形成合格实现的精确义务，不能把“可执行CLI已交付”签出。

部署环境采用实际[source/environment.module.json](source/environment.module.json)，以普通core:type闭record+core:constant给出有限ServiceEnvironmentSpec；environmentRef准确选择该常量，placementRef是该已选环境里的局部processKey。[完整解释](design/units-and-environment.md)只保存无法从当前拓扑推得的进程容器选择，节点/副本/UI边界继续消费其原唯一源。实际Host/平台/权限和部署证据是后续任务的独立输入，不由方案常量制造。

全工程EngineeringRequirements只在CLI system requirement位置采用一次，显式选本Project的全部3输出/4功能组件/服务节点/唯一预算；不是分别给三根随意换一份工程证明。它不会仅因定义存在就执行；具体Project激活必须闭合其Task输入。定义的检查同一候选任务及形成新候选任务方向由采用者决定，不写Goal固有方向。

每个组件的原业务输入合同由其本地Requirements采用一次，并通过真实self与同一business绑定；总装配只增加跨组件关系，不再重复四份InputContract。QueryLibrary的独立内核发生仍保留自己的本地采用。这是首次模板设计消除重复维护点，不是允许对任意已接受RequirementOccurrence按同名定义去重；独立来源及接受责任仍保留。

## 资源与模式的明确选择

DataAccess资源成员只声明唯一owner ResourceUse，容量为512 MiB。**没有伪造consumeTarget或给无formal的resource:model塞bindings。** 原SharedProcessBudget Rule同时消费kernel/entry/data/budget/placement/workload，规定三成员实际全部资源使用进入这个owner预算；Constraint→Method/资源消费者必须共同满足此义务。普通Context传递承担输入，source selector承担身份；资源共享的含义由完整Rule承担，不由同ref/同数字推导。

这条资源约束使用既有req:rule；SharedProcessBudget直接将全部指定成员和同一owner预算绑定，不虚填consumeTarget或另列三份容量。结构上的ResourceParticipation声明与共同资源保证分别承担责任；后者的完整含义由该Rule解释，Method尚未实现。

`ReplaceableQueryStrategy`采用**普通req:composite**复用本例StrategyDiscipline，继承同一kernel/budget/business身份，保留每查询固定绑定、错误/取消/资源及共同计量。实际采用点为EngineeringRequirements的use。本例没有强制策略类层次或额外结构变换，因此普通要求复用已保留全部区别；一般semantic:pattern及其观察/Scope机制继续用于真正需要其结构与变点合同的采用，不将本例称为PatternUse实例。

## 源与验证边界

源模型直接捕获原[subjects.module.json](../源发生绑定/subjects.module.json)及其解释，不复制第二份同名定义。精确结构/有限源检查不代签生产语义资格、业务输入实际选择、目标生成、运行和物理预算。

## 再次修改

对source/resource.module.json应用changes/256-mib.json，先检验容量及单位前像，再只改唯一magnitude为256。各Rule读取同一budget主体的实际容量，不另维护阈值副本；三根、连接、公开API/非受管字节/并发/取消/进展合同及两项源码控制保持。新上限影响所有共同占用，不能通过偷缩工作负载或额外串行化来达标；无合格方法则保留准确冲突或缺方法。

允许撤去某条控制时仍沿原Control reset形成新作者差额；撤去私有布局选择不撤去业务或公开兼容。当前例子展示512到256这一项真实跨层修改，未生成目标源码或实测内存。
