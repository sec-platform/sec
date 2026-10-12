# 开发者通用定义 Profile：统一业务语义、计算、领域与系统构造


### 开放Meaning与抽象Pattern的关系

`domain:meaning`为一个有类型领域实体关系/谓词/事件/操作/度量固定签名、解释位置、来源权威、观测方式和适用域；一个URI或名称本身不等于解释已获资格。`semantic:pattern`表达可参数化复用的抽象条件、行为和约束；`semantic:pattern-use`给出实参与范围；`intent:goal`表达作者要求；`req:composite`联立约束；`product:system`选择并组合真实组件。它们是一条组合关系，而不是每个意图必须依次另写五个独立文件。

当新的行业概念可由现有Meaning/Pattern与已实现Method组合时，不增加核心Kind；当必须区分新的不可还原的因果、时间、规范或效果关系且已有消费者无法表达时，允许领域扩展声明具名扩展和实现合同，而非将其JSON原文当有资格的语义。扩展不天然等于高权限插件，也不具有额外作者写权。


### 四态信息及解释结果

在开放世界，`支持真`与`支持假`可以独立取得，形成 True-only、False-only、Both、Neither；这说的是**证据支持状态**而不是现实出现第四种真值。证据冲突不可任意按优先读取顺序吞掉；没有数据不构成否定；只有有限且完整的观察域才能在明确定义下从未找到推出域内否定。谓词解释必须固定主体、时间、范围、意义和数据源。合取/析取/否定/蕴含的公式Profile有其精确演算，不能直接代替因果、规范或外部授权。未知与实际不可判定要保留不同原因。


### 表达目标需要一个可以扩展的生成机制

语言的开放性不是列出所有行业名词，而是允许在共同 Type、身份、关系、谓词、计算、规范、状态、过程与接口之上定义任意新领域 Meaning，并将其与已有构造有型组合。业务既可以是明确目标，也可以是作者指定的算法、过程、组织权责、风险取舍或既存外部服务交接。`Definition/Use/Instance/Root`仅说明声明和发生点，不能凭它们替用户发明行业规则。

下表覆盖**不同导致的工程责任**而非宣称穷尽世界实体。每个场景都可能涉及其他行的机制；表内“归属”是其不可替代的具体语义来源。

| 意图所需区别 | 开发者进入点、不可省的决定 | 归属与不能代签的部分 |
|---|---|---|
| 存在/身份/同一性 | 名义Type、对象角色、唯一键、创建/删除边界 | Type/Meaning/Source；名字相等不是现实对象同一 |
| 分类/关系/判断 | Meaning谓词、角色、范围、解释者和真值证据 | Meaning/Observation；同词不等于有判定函数 |
| 全称/存在/计数 | `quantify` + 类型化域、绑定变量、来源完整性 | Logic/Requirement/Data；开放域否定和集合重复不得乱算 |
| 比较/排序/度量 | 有单位的比较、精度、稳定排序、样本/时间 | Type/Quality/Method；浮点和货币不可随意转型 |
| 优先级与取舍 | 硬约束先于软目标，目标向量与不可补偿底线 | Requirement/Method；不能伪造统一评分数 |
| 参数化与复用 | 形式角色、Pattern模板、Use实参、继承限制 | Pattern；绑定发生点不同不等于同一业务对象 |
| 数据转换与自定义算法 | Type、纯函数Expr、通用库或明确原生源码 | Compute/Native；没有标准运算/Method就不能合成任意算法 |
| 存储与业务事务 | 数据模式、键、版本冲突、原子性与持久边界 | Data/Concurrency；数据库支持不等于领域正确 |
| 关系查询与递归 | 查询代数、键/Bag语义、否定域与结果完整性 | Query；单次查询与持续流不是一回事 |
| 连续流/通知 | 事件身份、时间、水位线、背压、迟到/回撤 | Event/Time；投递与外部效果恰好一次分开 |
| 状态、历史与迁移 | 模型/实例、可允许转移、活动退出、旧版本映射 | State/Migration；状态图不是运行时状态 |
| 交互与表达 | UI呈现、可访问性、输入草稿、动作Meaning | UI；按钮不是保存结算或授权 |
| 调用与通信 | Protocol端点、类型、错误、协议、会话、超时 | API/Provider；同一字段名不等于兼容ABI |
| 时间要求与持续性 | 时间逻辑、真实时钟/业务日历、进展与截止 | Time/Requirement；静态条件不保证实时满足 |
| 并行、竞争和公平 | 一致性、仲裁、原子性、资源与取消进展 | Concurrency/Resource；并行计算不等于公平调度 |
| 资源、预算和所有权 | 容量、租约、耗用、补充、归还、分配策略 | Resource；使用权不等于经济产权 |
| 法律、组织责任和规范 | Oblige/Permit/Prohibit/Exception、主体与法域 | Norm/Policy；模型许可不等于现实批准 |
| 外部真实作用 | 端口操作、Grant、Operation、Attempt、Settlement、读回 | Effect/Runtime；本地完成不证明现实改变 |
| 不确定性与风险 | 证据支持/反证、假设、误差、取样与不可补偿损失 | Assurance/Decision；未知不是零风险 |
| 反馈、控制、自动化 | 受控对象/目标、观测延迟、控制行动与稳定性 | Control/Meaning/Method；局部稳定不证明系统稳定 |
| 探索、优化与求解 | 搜索域、硬约束、算法界、停止与近似证书 | Solver/Method；无结果不等于无解 |
| 学习、预测和AI | 数据/标签、训练目标、模型版本、分布漂移和人工决策 | Domain/MLMethod；训练效果不能覆盖全部真实人群 |
| 空间、运动和设备 | 坐标系、坐标变换、物理单位、设备时钟及安全联锁 | Domain/DeviceMethod；模拟轨迹不等于物理安全 |
| 图像、声音、媒体 | 编解码、采样、同步时基、延时与版权用途 | MediaMethod/Target；UI渲染不等于实时编解码 |
| 财务、账本与清算 | 双方权利、币种/精度、记账时点、结算和反冲 | Domain/Effect；支付请求不等于资金到账 |
| 协作、审批和组织 | 主体委派、接受记录、否决、代理限制与生效时间 | Policy/Requirement；流程完结不等于组织授权 |
| 版本升级与退役 | 定义变更、Method替换、数据兼容、回滚和保留 | Source/Migration/Target；删除根不等于删除现实数据 |
| 自举与新工具创造 | 计算/构建/代码生成语义、源分区及ABI | Compute/Target；原生透传不能证明Gift自身完备 |

### 共用但不可合并的边界

所有这些场景都可以复用 `Type/Ref/Scope/ValueSource/DefinitionUse` 等**结构化协议**；但每条行代表的真实条件、消费者或可观察结果不同，所以不能压缩成`businessThing.kind = ...`而允许随便写`payload:any`。反过来，不能因为新出现一个“金融审核”业务就新建 `finance:approval` 核心 Kind；通常是有权 Meaning + Norm + Workflow + Resource + Observation的专业组合。


### 最少写法与扩张方式

不把上表改造成30个必填JSON字段，也不要求每个工程都接入某种数据库、云服务或AI模型。普通作者只决定需要的业务对象、Meaning、结果、必要差异和选中的Root；专业Method、库、运行环境及Target可在有条件的允许选择范围内供应默认。如果作者要锁定某个实现、算法、数据一致性、回滚、权限或法定义务，则在对应专业定义或有型控制里明确表达。扩张新行业时增加具名 Meaning 和Method/DomainProvider；仅当共同Type/逻辑/计算/组合真的无法无损表达一种不可约差异，才改变公共语法。

这才是“对一切意图保持开放”的可专业交付承诺；它与“任何意图现已可解释、满足并自动生成完整程序”是不同且不能混同的承诺。

<a id="single-author-meaning-ownership"></a>
## 单一业务作者契约的语义分工

本阶段的唯一当前结构化作者写源候选是 `gift.author-module/2`，不是把 `/1` 与 `/2` 两个可写Profile并排要求开发者挑选；旧 `/1` 只作为准确旧来源的只读接收入口。`/2` 合法类型现在包含四种已有意图类 Definition，沿用各自**原有Body协议**，而不是再定义四种新意图意义。完整枚举从 `schema/author/universal-author-module-2.schema.json` 的 `Definition.oneOf` 提取；本篇只拥有非计算作者语义和发生点合同，不重抄机器枚举成为第二真源。

**不可合并的构造角色**：定义 (`Definition`) 给领域概念或业务合同持久身份；使用 (`Occurrence`) 将定义角色绑定到实际对象；限定 (`qualifiers`) 声明作用域、时间、主体、证据与权威前提；组合 (`product:system`等) 显式指定成员和不同用途的边；要求 (`intent:goal`/`req:composite`) 对合格候选产生规范性限制；实现 (`MethodSpec`) 与目标 (`Target`) 另外签资格。Schema形式相同不证明两种使用同义；引用已解析不表示外部政策真实授权。

**复用发生点不能只靠名称**：一个系统引用可复用流程或政策时，采用统一的 `DefinitionUse{ref,bindings,scopeRef?}` 结构；`bindings`中的角色实际值由既有`BusinessRoleActual`表示，并按目标定义的`contextRoles`名义签名检查。旧字符串引用仅供已有候选快照读取，不是现行Writer写法。`RequirementLink`同样可提供`roleBindings`，但若Goal本身已经固定某一实际对象，发生点不得无依据改写它。绑定遗漏、类型或作用域不符合时必须保持`NEEDS_BINDING`或`NEEDS_REFINEMENT`；DefinitionUse不自动授权运行。

**产品根闭包**：一个产品根既有义务根，也有组件实例、各类有类型成员、精确对内/对外端口以及部署选择。`requirements`不是`workflowUses`或`policyUses`的替身；局部成员也不是系统级成员的自动同义物。只有相对于**独立已接受目标**、准确发生点和合格供应，才能判断完整性；Schema不会凭项目目录的内容证明目标都已被选中。根闭包应保留`NEEDS_MEANING`、`NEEDS_AUTHORITY`、`UNSAT`、`NO_SUPPLY`、`SEARCH_INCOMPLETE`及`NEEDS_TARGET`的区别。

**唯一新写源表示**：当前`/2`候选Schema为兼容历史构造保留少量旧字段，但当前作者Writer必须使用具有角色绑定和精确来源的规范形式：`conditionUse/whenUse`、`capacityLiteral/thresholdLiteral`、`argumentBindings`、`connections`及区分四态证据的`evidenceOutcomes`。`guard/conditionRef/whenRef`、计算式`capacity/threshold`、旧`arguments/wires/onUnknown`不得再作为**新增业务源**的另一种权威表达。当前Schema的闭合字段集合与本篇迁移规则共同限定Writer；不存在可由兼容Reader重新启用的当前写入口；旧快照仅供只读迁移，无法证明语义等价时保持旧字节与Needs，不能强行替换。

**计算与业务共同设计边界**：`core:constant`、`core:function`、`data:query` 与业务构造属于同一结构化作者语言；它们的精确计算语义依相应类型、求值、控制和查询 Owner 定义，而不是被非计算子集永久排除。此处交付的是完整设计规范的继续收敛，不实施计算器或目标后端。`core:type`中只消费业务数据及名义约束；任意计算实现由既有原生代码或Method承担，不能反向解释尚缺的业务意义。

<a id="gift138-author-kind-layer-separation"></a>
## 作者可见构造的真实级别、Owner与本阶段范围

`gift.author-module/2`的27种`Definition.kind`是一份**统一候选模块Schema的声明种类**（27种均在同一作者语言中；计算及非计算由不同语义Owner消费），不是27个基础语义公理、27条计算指令或27个V层；`intent:goal/1`内部六种模态、`req:composite/1`八Term、五种Pattern角色基数、`conditionUse`/`connections`等Occurrence与连接字段处于不同的**嵌套层次**。各Kind的输入、类型、条件及失败继续由本文件及对应专业Owner维护，不应在统一架构页重新发明。27种Kind的按职责归属与实际资格边界请查[统一构造索引](../../00-系统与原则/开发者源码分层与构造归属图.md#gift-author-source-layer-taxonomy)。

之前**仅设计业务非计算抽象**；当前统一目标覆盖同一语言内计算与非计算全部候选：新领域名义概念、身份/角色、真实关系、状态/事件、规范/目标、流程、资源、接口/UI、产品/质量/部署等可以经现有字段和合格扩展表达；函数体、通用Expr求值、递归及查询执行代数沿用原历史提案，**按使用情况决定是否需要计算/查询定义**。`core:constant`、`core:function`、`data:query`的计算或查询精确语义由相应计算、数据专业Owner承担；没有计算需求的业务作者无需引入函数。`data:query`的业务查询目标仍不等于物理查询执行。每个作者决定应该保存在它真实Owner的唯一Definition或引用Occurrence，不为了“覆盖一个V层”复制新的源条款。

**跨Profile衔接**：历史`gift.author-module/1`四类作者源可以由旧只读Decoder参与同一Project的候选`/2`读取链；它们不是两份同一业务定义的当前可写作者源；编译消费前需要**可检查的绑定和适配器合同**，尤其六模态义务、ProductRoot以及Condition的来源/角色/时间/规范强度。当前只有设计级Schema及局部见证，不可宣称存在统一生产Profile或从单一产品根自然导出全部系统义务。


> **规范状态：统一设计候选，非已发布语言。** 本页是 `gift.author-module/2` **候选**作者表示与新构造的唯一语义主责。历史兼容的 `gift.author-module/1` 四类 Definition、`gift.intent-body/1`、`gift.requirement-structure/1`、原生 TypeScript/Rust 源码、`gift.project/1`、`gift.binding-lock/1` 均不被本提案静默改义。机器形状在 [`schema/author/universal-author-module-2.schema.json`](../../../schema/author/universal-author-module-2.schema.json)，合格新方言的供应形状在 [`author-dialect-supply-1.schema.json`](../../../schema/author/author-dialect-supply-1.schema.json)。它们需要精确解码并满足对应 Schema 才能构成有效形状；这**不代表 Rust Decoder、Meaning、Method 或 Target 已发布**。本页只定义开发者可写的构造及其解释、组合和拒绝合同；纯计算通用文法、原作者源所有权、六模态、Method 和目标实现仍由相应既有 Owner 维护。

<a id="developer-foundation-gift133"></a>

## 1. 要解决的准确问题与充分性的边界

Gift 的**基础充分**不是先枚举未来所有行业名词。它要求在明确的受支持 Profile 下，开发者可以**合法、无损地保存**：数据与类型、一般计算、公共接口、身份与状态、事件和流程、领域意义、约束与业务意图、查询和持久化、UI与交互、通信协议、并发和资源、真实外部作用、权限规范、观察与质量、产品组合和部署、原生或外部实现。任何新领域功能必须或者是以上构造的合法组合，或者通过有版本且经资格化的 Dialect/Meaning/Method/Target 接合；不得靠未知对象、万能`invoke`或模型猜测冒充已经支持。

**区分六种声明**：①某一语言能在理想无界条件下表达任意部分可计算函数；②有权作者能保存其业务决定；③新领域有解释和观察来源；④构造在类型、状态、效果、时间、权限与资源上可组合；⑤有合格算法/库/供应可以实现；⑥所需目标制品已完整生成、通过相应独立验收。①、②不蕴含③—⑥。无法构造真实Meaning或没有满足共同要求的实现时返回 `Needs`、`Unsat` 或 `SearchIncomplete` 等精确结果，绝不为了“万能”构造假应用。

早期Gift133登记的23种新Definition是一份**历史提案**，并非23个不可约内核操作；其中22种有具体类型化Body、1种为`extension:definition`开放方言。**当前唯一`/2`候选已纳入旧四种意图Definition，共27种可读形状；其中计算构造属于同一语言的按需能力，不另行设定永久暂停的第二Profile。**类型构造19种、计算表达式17种、查询代数9种，各由单一 JSON Schema 明确判别；这些是**可用形状的当前枚举**，不是数学已证最小基底。四种意图/Pattern/Requirement仍使用原来的独立Body协议，但现在也可写在候选`/2`容器中；旧`/1`历史来源不自动重写、不复制为第二真源。

**开发者控制规则**：产品行为的意义（Meaning）及必须满足的条件（Requirement）应由有权作者/领域来源确定；方法和部署等实现选择只有在保持上述条件的候选空间中才由作者Control、方法供应或编译器求解；当前外部事实由Observation取得，执行权由独立Grant取得；编辑器显示配置不属于被生成软件的Meaning。所有输入进入一个 SourceRevision 的受管区域，每一区域恰好一个可写 Owner。

## 2. 实际工程文件、对象身份、版本和链接

建议的开发工程不是生成代码的镜像目录。一个普通工程可有 `gift.project.json`、若干 `design/*.module.json`、可选 `src/*` 原生作者源码、可选 `gift/controls/*` 实现偏好、资产和自带的领域定义包。编译结果 `gift.lock.json`（由**真实** Resolver 产生）、派生义务、方法绑定、Target AST、源码和运行证据均不是作者需要预填的第二真源。小工程可以只有一个模块；按业务维护边界拆模块，**不得按每个抽象构造强制拆文件**。

唯一 `/2` 作者容器必需 `schema/moduleId/definitions`，可选 `namespace/dialects/imports/exports/annotations`；普通私有模块不填不用的字段。`definitions` 以局部DefinitionId为键，每项仅 `{kind,body}`，不重复 `name`；`exports` 映射公开名称到现有定义ID，`imports` 映射局部别名到工程模块或有锁的外部模块。提案引用词形为 `local:DefinitionId` 或 `alias:PublicExport`，其中别名只能来自当前模块 `imports`，后者只能引用实际的**公开导出**。根仍由 `gift.project/1` 的具体 `targets[target].outputRoots` 选择，不能靠文件存在、目录名或全局扫描暗自进入产品。提案容器的 `dialects` 为待解析约束，不是仅凭 `languageId` 自身取得解释权。

一次有效绑定身份包含：工程实例、源修订、模块ID、定义ID、发生位置、实际选中的Dialect/Schema版本、外部导出及锁定内容身份。相同字符串但不同 issuer、scope 或 revision 不自动指向同一对象。语法合法、引用找到、类型合法、获得解释权、实现可得及目标已编译，必须作为**六种不同结果**表示。选择 `/2` 而 Reader 尚未支持时返回 `UNSUPPORTED_AUTHOR_PROFILE`；旧 `/1` 读者不得自动跳过新节点继续生成。新/旧可以在**明确分派的 Project 模块边界**并存，但没有消费者时只得到未决 Needs。

### 2.1 严格读取与动态扩展的边界

严格 UTF-8/JSON2020-12 前置检查拒绝重复键（含转义碰撞）、非标准 NaN/Infinity、控制字符、非法数值、资源超限、路径越界、未知发布Profile及非白名单语义字段。标准 Definition 的 `body` 必须匹配且仅匹配对应Kind的带Tag结构；不是可随意存数据的`Any`。`annotations` 是不影响语义的受限显示元信息，不得接入Method、Grant或安全规则。

`extension:definition` 的 `payload` 在**基础 Schema** 中只能作保全，`dialectRef/bodySchemaRef/bindingRef` 必须解析到真实有权版本和字节摘要，再由 Dialect 消费者独立执行其**专用 Schema、类型规则、效果/作用域检查和组合协议**。不满足就输出 `NEEDS_QUALIFIED_DIALECT`，不能输出已解释的定义。注册可读取元数据，不意味着允许执行其中任意编译期脚本；过程型解释器或Lowerer需经沙箱、预算和授权策略准入。

<a id="gift136-source-structure-vocabulary"></a>
### 2.2 作者写源结构、声明类别、字段、领域含义和计算操作的严格分离

**写源结构**由Reader从真实文件读取：模块的 `definitions` 是以局部名称为键的定义映射；每项Definition只保存 `kind` 及该Kind的 `body`，局部名称就是唯一的映射键，不在Definition内第二次写`name`。一个 `kind`（如`resource:model`）是**作者语言的判别标签**，一个字段（如`capacityLiteral`）是它的语法组成部分；它们确实增加了作者需要理解的有限词汇，但并不分别构成新的不可约语义原语，更不等于新增函数、循环或指令。`conditionUse`、`qualifiers`、`connections`属于**复用现有意义的作者表示**，均不是新的Definition Kind。原有23种历史专业候选与旧四种意图/模式定义已合并为候选 `/2` 的27种Kind（同时包括计算与非计算，可按项目实际使用）；已有六模态、八Term和五基数仍由各自Owner解释。

| 应独立管理的对象 | 在开发者文件中的准确位置 | 不能直接推断的事 |
|---|---|---|
| 模块、导入、公开导出 | `gift.project/1`、`gift.author-module/1`、`gift.author-module/2`的`moduleId/imports/exports` | 文件存在并不意味着某定义已被选中、已解释或已发布 |
| 语义定义及真实作者差异 | `definitions[id].kind/name/body`、有类型Qualifier、明确的跨模块Ref | Kind数量不是语义基元的数学最小数，也不是作者必须填写的文件数 |
| 谓词的一次使用 | `conditionUse.meaningRef`和`bindings` | 引用了谓词≠绑定了本次业务主体；Schema通过≠真实谓词为真 |
| 组件的一次使用与连接 | `product:system.components[].instance`及`connections[]` | 同名Port、Definition复用或组件存在≠真实实例已连接 |
| 有权主体与适用条件 | Definition的`qualifiers`及专业Definition的固有字段 | 写下`authorityRef`不产生外部权威、操作Grant或合格Evidence |
| 实现与知识供应 | 合格的Meaning、Dialect、Method/Target、外部事实和锁定依赖 | 名字、Schema或样例都不能代签专业语义和真实实现 |

**收敛判据**：只在出现不可无损表达的新作用域、主体、责任、量词或业务关系时增加公共字段；同一含义的实例不得复制成新的Kind。可由已有有类型组合表达的构造只作语法便利，并规定无损展开。凡需新增真实行业意义，由开放Meaning/Dialect供应，不进Core枚举。原有计算文法只保留、当前不扩写。

<a id="gift136-business-predicate-use"></a>
### 2.3 绑定的业务谓词使用：含义定义与本次Occurrence不可混淆

`domain:meaning`定义一个有签名的领域概念；`BusinessPredicateUse`是**其一次使用的绑定数据**，不是重新定义同一个Meaning，也不引入通用计算表达式。新增的可选作者字段`conditionUse`适用于`state:machine.transitions[]`、`workflow:plan`的wait步骤、`security:policy.rules[]`；分支使用`routes[].whenUse`。已有`conditionRef/whenRef/guard`继续读取历史候选，但同一位置只能选一个条件来源。旧式单一`conditionRef`只有在真实消费者取得完整角色绑定时才能解释，否则必须返回`NEEDS_ROLE_BINDING`，不允许把有参Meaning当作零参布尔值。

```json
{
  "conditionUse": {
    "meaningRef": "platform:SaveMeaning",
    "bindings": {
      "document": {"source": "context", "role": "document"}
    },
    "observationRef": "platform:SaveObservation"
  }
}
```

**绑定要求**：`meaningRef`必须解析为有资格的谓词Meaning，其结果类型为布尔；`bindings`中的角色名与该Meaning的签名精确相同，每个必需角色绑定一次，不允许额外角色。`domain:meaning.parameters[].cardinality`可声明`one/optional/set/bag/sequence`，省略时为`one`；`bindingLevel`区分`object`与`definition`（省略为`object`），防止把一个**定义本身**冒充实例对象；基数、层次与实际绑定必须一致。引用绑定有四种明确来源：`definition`（已有Definition，不能把类型/Meaning当实例）、`context`（声明过类型和基数的当前上下文角色）、`object`（含`objectRef/typeRef/issuerRef/scopeRef`的受外部权威约束的业务对象）、`collection`（含`collectionRef/cardinality`，可要求独立`completenessRef`）。`contextRoles`在工作流或状态机Body声明可使用的上下文槽；安全Policy的预定义subject/action/resource仍需真实规则签名及有资格的类型环境，不能因为名称相同自动合法。外部对象、集合、发行者、观察者的存在性/可信度不能由作者JSON签发。

**结果语义**：谓词解释后仍保留`T/F/BOTH/NEITHER`四种支持/反证状态，未知、冲突或无资格不可隐式当作`false`、`true`或跳过。工作流`otherwise`仅在该分支集经有资格的判定满足其适用条件时使用；当前decision使用`evidenceOutcomes`分别处理NEITHER/BOTH，不再写旧`onUnknown/onUnknownStep`；manual必须以`humanStep`明确指向真实human步骤，wait必须提供可用于恢复的resumeKey；未声明处理时保留未决，不能使用otherwise吞掉未知。无资格条件先返回Needs，不由证据处理政策授权继续，不能只写“人工处理”或“稍后再试”；多个条件同时成立、缺少可用分支、状态转移歧义、观察范围或时钟冲突由工作流/状态机Owner返回明确拒绝或需要补充的合同。多个成员的全称/存在性判断继续由Requirement Owner解释，静态本地结构不证明动态集合的完备性。

**结构校验能独立拒绝**：条件来源同时出现、缺或多角色、引用非谓词Meaning、上下文槽不存在、名义类型/基数冲突、将类型Definition冒充实际业务对象、缺少对象发行者或作用域。外部Meaning未安装时返回`NEEDS_QUALIFIED_MEANING`，不造假`QualifiedBinding`。

<a id="gift136-author-qualifiers-and-instances"></a>
### 2.4 定义限定与组件实例连接：同一声明的两个不同关系

`qualifiers`是定义级**已声明的应用条件**，可引用`scopeRefs/subjectRefs/authorityRef/validityRef/evidenceDemandRefs`。它不复制 `gift.project` 的根选择，不覆盖专业Body内的政策规则，也不授权实际操作。多个有资格的限制需要在同一主体和时空语义下联立；能够证明相交范围为空时拒绝该实例的资格，无法确定交集时返回`NEEDS_SCOPE_QUALIFICATION`，不按字符串、数组顺序、距离或文件位置猜优先级。作者声称authority或evidence仅登记依赖，真正的批准和独立证据须由对应主体提供；缺失时分别保持Need。

`product:system.connections[]`连接的是**具体组件实例上的能力端口**，不是两个偶然同名的接口。`source`必须对应`components[].instance`且该组件的`provides`实际含所指Port；`target`必须对应一个实例且该组件的`requires`含所指Port；类型、协议版本、权限、资源和真实实现兼容需后继精化。已有`wires`保留兼容；新的实例连线工程只需写`connections`，**不必冗余写`wires: []`**。若两者都给出，则`wires`必须为空；不能两套来源同时规定同一拓扑。一个消费者端口收到多个供应，除非已有经资格化的聚合/负载均衡合同，否则不能仅按数组次序任选。

```json
{
  "connections": [
    {
      "source": {"instance": "Storage", "portRef": "platform:FilePort"},
      "target": {"instance": "Editor", "portRef": "platform:FilePort"}
    }
  ]
}
```

这些字段仅细化既有`product:system`和`domain:meaning`的作者表示，不新建产品架构层、不证明Target已具备Electron/VS Code构建能力。结构合格、局部引用合格、领域解释合格、Method合格、Target合格必须分别签发。参考真实源码在 [`Gift136-bound-business-source`](../../../fixtures/developer-foundation/Gift136-bound-business-source/README.md)，有限反例检查器不授予产品资格。

<a id="gift134-noncomputational-author-contract"></a>
<a id="gift137-noncompute-decision-and-obligation"></a>
### 2.5 非计算选择：保留证据差异，不新增通用 `if`

本节拥有跨构造复用的谓词证据与选择政策；工作流的控制、返回、循环与恢复由[工作流Owner](../交付语义/工作流执行关系与激活.md)唯一解释，其他构造仍使用各自专业Owner。它**增加的是业务关系所需的精确字段**，不扩展 `Expr`、函数、递归或计算语言，也不增加 Definition 类别。机器结构见同一候选 `schema/author/universal-author-module-2.schema.json`。本 Profile 未发布；旧 `/2` 示例与旧 `/1` 模块仍按其准确版本解释。

一个 `workflow:plan` 的 `decision` 步骤的每条 `routes[]` 当前只写有角色绑定的 `whenUse`；`whenRef`仅属准确旧来源的只读迁移。条件解释需要锁定 Meaning签名、实际角色、适用域、时点和合格Observation，不得仅凭形状推导真值。**取得合格解释之后**，把证据对 `(support, refute)` 投影为四种状态：`T=(1,0)`、`F=(0,1)`、`NEITHER=(0,0)`、`BOTH=(1,1)`。`NEITHER` 是证据不足，`BOTH` 是冲突证据，二者不能自动落入 `otherwise`。`UNQUALIFIED`（Meaning、签名、授权或观察解释缺件）甚至不是四态之一，必须返回 `Needs` 并阻止相关决策签发。

新 `decision.evidenceOutcomes` 把两种异常证据状态分别映射为业务处理：

| 字段 | 最小合法值 | 精确含义及失败 |
|---|---|---|
| `evidenceOutcomes.neither` | `{"action":"reject"}` 或 `{"action":"manual","humanStep":"..."}` 或 `{"action":"wait","resumeKey":"..."}` | 未取得充足支持/反证的处理。`manual`必须指向此工作流中真实 `human` 步骤；`wait`必须有恢复关联身份。 |
| `evidenceOutcomes.both` | 同上，独立选择 | 支持与反证并存的处理；不能被 `neither`/`false` 代签。 |
| `onUnknown` + `onUnknownStep`（旧候选表示） | 原有 `reject/manual/wait` | 继续兼容；在旧表示中同时覆盖 `NEITHER` 与 `BOTH`，不能将其宣称为已区分两态。 |

两种表示在同一个 `decision` 中**互斥**；不是两套同时可写的默认规则。`action=reject` 不得带人工目标或恢复键；`manual` 必须带 `humanStep` 且不得带恢复键；`wait` 必须带 `resumeKey` 且不得带人工目标。每个目标名称须在同一工作流中存在并满足类型约束。`UNQUALIFIED` 一律先停在语义资格阶段，不能利用 `evidenceOutcomes` 降级为“允许执行”。

### 2.6 多路线及状态转移：声明顺序不是任意业务决策的答案

同一决策出现两条及以上条件路线时，作者须给 `selectionPolicy`：

- `exclusive`：作者声称任意有效时刻**最多一个条件可为合格 T**。必须提供 `exclusivityRef`，后继由独立的合格解释器核对观察域、约束、时间和共享主体；引用存在不代表排他性已被证明。缺证据返回 `NeedsExclusivity`，出现两个 T 则为合同违例。
- `explicit-priority`：作者显式为每条路线指定互不相同的整数 `priority`，数值较大者优先。前置条件仍是所有涉及的谓词在当前决策的作用域下取得合格解释；四态证据、未知观察和规范限制不可被优先级吞没。优先值相等、部分未声明或只有 JSON 顺序时均不能以“先遇到的路线”为实际业务规则。

只有一条路线且没有声明 `selectionPolicy` 时不存在路线之间的选择歧义；即便如此，谓词不合格与 `NEITHER/BOTH` 仍按上述规则处理。所有路线均为有资格的 F 才允许走 `otherwise`；未声明 `otherwise` 时保留显式 `NoMatchingRoute`，不得视为步骤已正常完成。多路线同时出现BOTH/NEITHER时的处理顺序、manual/wait/reject的实际令牌与结果由[工作流控制出口](../交付语义/工作流执行关系与激活.md#谓词等待与决策的控制出口)定义，不按数组先后任选异常策略。`priority` 不是运行许可，不能替代政策授权或外部 Grant。

`state:machine` 同一 `(from,event)` 允许有多个候选转换，却不能默认由数组顺序决定。若多个候选可能同时启用，必须取得条件互斥证明，或使用 `transitionArbitrationRef` 指向可核查的领域仲裁合同。该引用的合法外形不等于仲裁已被证明。无证据时返回 `NeedsTransitionArbitration`；可验证不兼容时返回明确冲突。`missingTransition` 仅处理真正没有合法候选转换的情形，不能吞掉条件未知、时态不明或多个候选竞争。

### 2.7 规范要求、身份和权限：将“有义务”与“有许可”分开

`security:policy` 的 `permit/deny` 表达适用主体、动作、资源与政策的许可或禁止，其 `combining` 决定适用规则之间的组合；`oblige` 则另有**需要履行的内容、触发、期限与解除条件**。因此，`PolicyRule.effect=oblige` 必须含 `obligationRef`，指向能被合格 Norm/Requirement 消费者解释的义务。`permit/deny` 不可写 `obligationRef`，也不能通过给 permit 附加优先级就伪造义务履行。若没有可解释的 Norm 内容，返回 `NeedsNormMeaning`；不能把存在这一字段当作已履行。

`security:policy.body.contextRoles` 允许政策谓词在使用点绑定有类型的业务主体（例如账户、文档、工作区），复用 `BusinessPredicateUse`，不新造领域谓词表达式。角色缺失、基数或名义类型不匹配时静态拒绝；没有授权的政策发布者、例外来源或规范时间解释时不得签发可执行许可。对 `explicit-priority`，规则优先值必须明确且按相交规则的同一排序合同进行判断；**不能默认非同一签发者的优先级数字可比较**。本地校验器采用更保守的唯一优先值限制，其通过不代表跨权威冲突已解决。

政策的 `permit` 不等于运行 `Grant`，`deny` 不等于操作绝未派发，`oblige` 不等于已完成外部效果。政策更新后，已有授权及操作的合法范围、截止与已发生效果必须按其独立责任处理。

<a id="gift140-typed-product-closure"></a>
### 2.8 定义、实例、出现点和组件成员：同一个闭合语义

**唯一当前作者写法**是候选 `gift.author-module/2`：四种意图定义与通用类型、常量、函数、领域模型、产品及其他定义都在同一 `Definition` 联合中；计算的求值、效果和Target语义由计算专业正文承担，本轮不实现执行者。`DefinitionUse`、七种带参与角色的嵌套结构、Project 目标根的 `contextBindings` 都是**局部构造**，不是第28种Definition、第二语言、伪计算表达式或独立持久 IR。Schema 形状唯一归属 [`universal-author-module-2.schema.json`](../../../schema/author/universal-author-module-2.schema.json) 与 [`project-1.schema.json`](../../../schema/source/project-1.schema.json)；本节负责其中业务语义与实例化解释，不重复维护独立的合法字段表。

同一系统须精确区分五种身份，而不是字符串相同就合并：

- **定义身份**：`(moduleId, definitionId, locked source revision)`。工作区的两个 import alias 即使拼写不同，若解析到同一确定 module/definition/revision 才是同一名义定义；锁定外部源未实际到达时不得猜测相等。
- **选择身份**：`(project revision, target key, output-root occurrence, public export → definition)`。目标只选择公开根；同一Definition经两个有不同上下文的选择是两个业务出现点。
- **组件实例身份**：`(selected product-root occurrence, components[].instance)`，其 `componentRef` 只指模板。一个 `EditorComponent` 可以在同一产品中实例化成 `EditorA` 与 `EditorB`，彼此不共享上下文、实例状态或运行所有权，除非另有明确且合格的共享合同。
- **有类型成员出现点**：`(product-root occurrence, component instance? / product root, field, list occurrence, DefinitionUse, effective role bindings)`。同一个 workflow、policy、resource 等Definition多次出现可以有不同主体/对象，不得按 Ref 去重；相同绑定也不自动意味着相同运行事件。
- **现实对象身份**：由 `objectRef + issuerRef + scopeRef + time/revision/provenance` 的有权解释决定。对象Ref相同并不等于外部签发已验证；不同Actor、Issuer、Observer、Authority和Grant不得互相代签。

**不可丢失的组合次序**：先固定产品选择与根的作者接受记录；解析 import/export 为名义定义；按根/组件实例化形式角色；绑定局部成员的上下文发生点；核对连接、公开接口、外部依赖、部署归属；联合所有发生点的硬义务、有效政策、时态与资源约束；再要求真实Meaning、Method与Target资格。不能从文件夹的共处、Kind相同、导出名字类似、某字段非空或“已跑过Schema”跳过任何一步。

### 2.9 所有组件业务成员的唯一类型化关系（不能汇总成 `members[]`）

`product:component.body`的成员**各自有精确业务关系、方向与资格**。其共同内部载荷 `DefinitionUse={ref,bindings,scopeRef?}` 只复用角色发生点机制；role枚举和目标Kind受所在字段严格约束，关系语义由字段专属合同决定：

| 字段 | 引用 Kind / 角色 | 独立语义、未闭合的供应 |
|---|---|---|
| `stateParticipations` | `state:machine`；`host` / `observe` | 状态实例宿主与状态观察者有别；转移仲裁、时间域、更新权另校 |
| `dataAccesses` | `data:model`；`owner` / `read` / `write` | 模型拥有者不当然有读/写Grant；读取一致性、写入原子性、持久化/迁移另校 |
| `eventParticipations` | `event:stream`；`publish` / `subscribe` | 产出事件与消费事件有方向；broker、投递去重、重放、水位线不由角色名推导 |
| `protocolParticipations` | `api:protocol`；`client` / `server` | API客户端与服务端不同；Transport、认证、序列化、版本与错误语义另校 |
| `resourceParticipations` | `resource:model`；`owner` / `provide` / `consume` | 资源拥有、供应和占用各异；数量、租期、配额、竞争、来源资格必须保留 |
| `uiParticipations` | `ui:view`；`render` / `control` | 展示与输入控制不同；键盘焦点、无障碍、交互绑定及目标渲染器另校 |
| `observationParticipations` | `observation:contract`；`produce` / `consume` / `audit` | 观察产出、消费与独立核验是三种证据权能，声明`audit`不授予独立性 |
| `concurrencyUses` | `concurrency:contract`；DefinitionUse | 共享并发约束在该组件发生；不凭合同字符串视为已具跨实例锁/事务 |
| `workflowUses` | `workflow:plan`；DefinitionUse | 引入实际业务流程成员，必须实例化上下文与阶段/恢复；不是Goal替身 |
| `policyUses` | `security:policy`；DefinitionUse | 关联适用的政策和其Issuer/作用域；permit不是真实运行Grant |
| `qualityUses` | `quality:contract`；DefinitionUse | 关联质量义务，阈值的量纲/样本/时间窗与独立测量仍须核验 |

`product:system`使用同型的 `workflowUses/policyUses/qualityUses` 表示**产品级**成员；组件级的对应发生点绝不因同名自动与产品级合并。组件 `requires/provides` 是静态能力接口的方向声明，不是业务成员类型也不是实现；组件 `requirements` 是该组件每次实例化都进入的独立义务出现点。`product:system.requirements` 是产品级义务根，不能借成员链省略；这些义务在已接受范围内**联合**，不是任选其一，也不是把permit/oblige/perform变成Boolean。

一个成员槽可能出现多次，每次以其Kind、role、上下文和身份严格检查；同一模型既有`read`又有`write`可显式声明两个参与边，但不会产生真实授权。数组声明顺序不自动制定竞争优先级、执行顺序、所有权或财务分配。含有未知领域解释或没有合格供应的成员保留为 `Needs`，不能靠通用反射、空函数或默认 Stub 完成。

### 2.10 根、实例、局部业务成员的上下文精确接力

一个 `contextRoles` 是形式槽名及 `{typeRef,cardinality}`，并未使对象存在。五种基数精确保留 `one / optional / set / bag / sequence`：单值不能冒充完整集合，集合不能被自动排序，带重复的 bag 不能自动变 set；`optional` 未绑定可以合法存在，但一旦局部流程需要一个实际值仍应产生缺值或Needs。形式槽的名义类型在**定义所属模块**解析，实参类型在**实参发生位置所属模块**解析；不能用相同alias拼写比较跨模块类型。

绑定采取明确的三级资格接力：

1. **产品根选择**：`gift.project/1.targets[target].outputRoots[i].contextBindings` 为所选 `product:system.body.contextRoles` 绑定具体实际值。只有选中根拥有这个实参；别的 Target 根、工程全局 `parameters` 或目录下其它值不自动继承。旧项目未声明此可选字段时，必需根角色未绑定应拒绝或返回具有具体缺口的Needs，而非选择任意对象。
2. **组件实例**：`product:system.body.components[i].contextBindings` 为组件模板的 `product:component.body.contextRoles` 单独赋值。`{source:"context",role:"workspace"}` 明确接产品根已声明并取得实际值的槽，`source:"object"` 则是独立身份指派。EditorA的文档不能自动漂移到EditorB；静态 `argumentBindings` 仍只承载组件参数的版本化Ref，不是业务对象上下文。
3. **成员使用**：组件内或系统级每个 `DefinitionUse.bindings` 按其实际Definition的形式角色签名逐一绑定，可选择 `source:context / object / definition / collection`。`source:context` 只读取当前发生点可见的上下文，组件成员读组件槽，系统成员读系统槽；引用未声明角色、必填缺位、基数冲突或名义类型可证明错配均拒绝。

角色的类型同一性、Issuer真实性、scope交集、权限与有效时间是**不同判断**。静态同一名义类型不代表对象有权、存在、活跃或适合本次操作；`source:object` 中的 issuerRef 和 scopeRef 是需要绑定到真实资格的**要求**。集合成员是否完整与当前目标的量词/否定可判定域必须由有权数据源证明。上下文绑定链任何一环失效，所有依赖该发生点的成员、联合义务、Method资格、目标产物及Evidence需要准确失效；互不相关的其它实例不应一起被冒充失效。

### 2.11 内部连线、产品公开接口和外部要求三种不同关系

`components[]` 定义真实产品实例集合。`connections[].source` 必须指 **实例的 provides**，`connections[].target` 必须指 **实例的 requires**；`{instance,portRef}` 必须精确映射真实公开接口，两个不同alias在锁定后同指一个Definition才可按同一名义端口判断。即使两边同一端口身份，实际方法、错误、超时、效果权限和调用时序仍需验证；不同身份的接口需要专业精化或适配合同及资格，不能靠Kind相同就合法。

`publicEndpoints[]` 每项 `{name,source:{instance,portRef},interfaceRef,exposureScopeRef?}` 明确宣称“这个产品名公开由哪个实例提供的哪个端口”。`publicInterfaces[]` 裸Ref在当前Writer中不可写；它不能表示两个同模板实例中到底哪个实例对外公开，也不能赋予对外调用权限。

`externalRequirements[]` 每项 `{target:{instance,portRef},providerRef?,scopeRef?,contractRefs?}` 明确“这个组件的必需端口由产品之外满足”。**未列在内部连线或外部要求内的非可选 `requires` 是未满足依赖**，不得默认为宿主已实现。`providerRef`缺席表示外部需求尚无供应者；存在时必须是锁定的真正外部供应选择，仍需鉴别其Provider身份、能力、Grant、scope、版本、故障恢复和Target兼容。声明外部需求不等于已经完成它。

在当前提案下，某一实例的某一 required port **不得同时**接收两个内部提供者，也不得同时内部连接与外部委托，除非先把聚合/裁决职责显式做成另一个具有不同输入端口、受资格仲裁和恢复的组件。这样避免将连接数组顺序误解释为负载均衡、投票、覆盖或任意竞争。单一提供者可服务多个消费者，但资源占用、并发与总容量需要**联合**核对，不能从边数或端口Schema推出无限容量。

### 2.12 部署是实例的映射，不能把模板误当运行进程

`product:system.deploymentRef` 只选择一个由当前产品解释的 `product:deployment` 定义。当前 `nodes[]` 的 `{id,instance,placementRef,replicas?}` 以**产品实例名**绑定，而非旧 `componentRef` 模板引用；同一模板可以不同实例、不同放置，也可按有资格的Target以一个实例的不同节点分组放置。部署 node ID 必须唯一、实例必须存在、需要目标落地的实例必须有可解释的覆盖；在当前有限范本中所有三个实例均要求被覆盖。`replicas`只是一项期望，不证明进程真的启动、数据已复制、状态共享正确或多个副本效果幂等。

特定实例的 `implementationRef`、现有原生源码或Method选择都必须与实例的上下文、公共端口、业务发生点、资源预算、复制模型、Target能力、依赖以及SourceMap保持对应；**产品组件完整不等于每个实例可实现**。同一组件模板若针对两个实例具有不同权限/资源/数据作用域，实现可以复用代码，但其运行资格与Grant是分别产生、分别失效的。部署、发布、迁移、回滚、当前运行Revision和外部不可逆效果分别受现有Target/Runtime/Evidence Owner控制。

### 2.13 全局联合与实际抽象：不能由局部形状冒充产品正确

**多个选中Root的正确量词**：原式中的 `P` 是一个真实根发生点，不是整个Target的代称。Target选择`R={r1,…,rn}`时，先分别得到 `Req(r_i)` 及 `Req(C_{i,j})` 的**带根身份**发生点，再加上独立被接受的目标、来源、时域和权限；真正需要联立的是在共享主体/资源/Effect/时窗上**可能相交**的义务集合。两根同名组件、同名公开端点或指向同一可复用Definition，不足以证明共享运行实例/对象/账户。能够经权威证明隔离时可分区求解；没有隔离证据时保留跨根Joint Need，不能把各根结构PASS取交集当全局PASS。


设已选择的产品根为 `P`，组件实例集合为 `I(P)`，其中 `Req(P)`是系统级有权接受的业务义务，`Req(C_i)`是实例化后组件局部义务，则联合义务的**来源集合**为 `Req(P) ∪ ⋃_{i∈I(P)} Req(C_i)` 加上有权独立来源与Policy/Workflow诱发且已解释的规范义务。这里的集合并不是按字符串Ref去重：每个元素必须保留根/实例/角色/作用域/时间/来源发生点；`soft`保留为优化目标，不能覆盖`hard`。真正能否联合满足要处理共享资源、四态知识、授权、不可逆效果、跨时间/组织协调与必要的进展、补偿，结构Linker本身没有求解资格。

**作者接受边界必须独立于作者文件自身**。如果作者忘选一个过去接受的硬目标，不能用当前Root“只有这些要求”证明目标完整。合格的闭合判断必须有独立固定的已接受目标/限制记录或等价的明确确认；没有这项来源只能标`NeedsAuthorAcceptanceReconciliation`。合法软目标、空流程或外部端口本身不等于无效的产品Schema；是否违反产品要求需要独立接受范围及Target合同。有限范本给出独立指定的`goals:IDEGoal`硬目标作为反例预期，绝不宣称它来自真实外部客户签署。

“极致复用”的最小充分抽象不是把业务抹成`execute`、`member`或万能`Relation`，而是：固定稳定的**名义定义**，抽取能反复出现的**有类型形式角色**，把可变处明确表示为**实际绑定**，将业务关联保留为互不替代的**有类型参与边**，把必须维持的条件表达为**可核查的要求/不变量/证据资格**。抽取一个可复用Pattern时，必须保存所有源实例的可观察共同条件、允许变化槽、不同角色的基数/时域、正反例与父子精化义务；只有在每个实例代入后仍保留其硬条件时才能认为抽象成功。跨领域相似关系仅供候选发现，没有有权Meaning解释器与精化证据，不能把“资源预留”“金融结算”“医疗批准”自动同义化。

**唯一Writer，多个不同结果门禁**：结构非法 `InvalidAuthorSource`；声明/公开引用丢失 `InvalidBinding`；领域解释未知 `NeedsMeaning`；根角色/对象无法取得 `NeedsRoleSupply`；权限缺件 `NeedsAuthority/Grant`；静态端口漏供 `NeedsPortSupply`；真实联合有反证 `Unsat`；未完成搜索 `SearchIncomplete`；没有Method `NoQualifiedMethod`；部署/Target不合格 `NeedsTarget`；实际观察不完整 `ObservationUnknown`。诊断必须带来源Occurrence、Owner、恢复条件与失效范围；不允许生成Stub掩盖任何一种缺口。

**有限校验边界**：同包 [`Gift140产品范本`](../../../fixtures/developer-foundation/Gift140-unified-product-composition/README.md) 的Python工具只测合法JSON、已知本地Schema、版本、公开引用、定义/实例身份、角色签名的可静态部分、各成员Kind、端口方向与唯一覆盖及部署实例。它不签外部Issuer/环境、Norm/时序/Method/Target、真实副本/内存模型、完整实现或独立Oracle。

<a id="typed-static-parameter-closure"></a>
### 2.14 组件静态业务值的归属与边界

`product:component.body.parameters[]` 是可复用模板的**形式参数**，`product:system.body.components[].argumentBindings` 是该实例在设计时选取的**静态实参**。二者与真实业务对象的 `contextRoles/contextBindings`、运行时事件载荷以及流程局部变量不同。不得因为名字都含 `binding` 就让它们共享权限、实例身份或生命周期。

非计算参数 `mode=value` 现在**只采用一个当前写法**：`argumentBindings.<formal-name>={"source":"literal","typeRef":"...","value":...}`。这里的 `typeRef` 和该形式参数的 `contractRef` 必须均解析为有权的 `core:type` 名义身份且相符；形式参数 `cardinality` 决定一个实参还是有序列、可重复多重集或集合语义。对象、原生函数、业务Effect、动态请求载荷不允许藏在 `value` 中。复杂值仍需专业类型消费者验证字段、单位、精度、编码、可缺失/可空、集合重数和时间语义；JSON结构本身不能保证，例如JSON浮点数经过不保留词法的解码会丢失精度。形式 `optional` 表示参数**可不传**，不能从字面 `null` 推导“未传”；`set` 不可以由任意数组在没有等价关系时自动去重。

`mode=resource/capability/policy/observation` 继续使用有类型 `Ref` 实参且必须分别指向正确 Kind、实际合格合同与权限；不接受 `literal`。之前要求静态 `mode=value` 一定引用 `core:constant` 的办法在当前Writer退役：简单的有类型静态业务字面值应就地表达，不应迫使不需要计算的组件作者先编写独立常量定义。`core:constant`仍可用于真正可复用且具类型与求值资格的常量。原 `.arguments` 的Expr路径仅历史读取；改写必须明确进行有前像、有拒绝条件的迁移。静态 `value` 不得代表所引用 `core:type` 的构造算法已经实现，Target对实际类型与ABI无法保证时保留 `NeedsStaticLiteralQualification`。

<a id="explicit-component-activation-closure"></a>
### 2.15 业务成员存在与流程被触发之间的因果边

**触发基数与重用边界**：同一已限定事件来源（例如相同 `uiUseId+nodeId`）到同一工作流出现点重复写两条不同`id`的路线，属于重复派发定义，当前Writer应拒绝；若同一来源到不同工作流出现点，则不是立刻无效，但必须附带有权的多播/仲裁语义和效果去重资格，缺件保留 `NEEDS_MULTICAST_ACTIVATION_ARBITRATION`。同一目标Workflow可有多个不同原因，是否允许运行并发或重入由实例级 `concurrency:contract` 和共同Resource/Effect作用域决定，不能因为目标Ref相同而自动合流。

**业务动作与Effect分界**：合法`UiNode.actionRef`身份不等于Method可执行身份，更不等于外部Effect准许。UI节点先声明可感知动作的领域意义，组件发生点再声明来源到流程的因果，流程与其输入/Grant经过合格消费者才可形成执行。若旧样例`actionRef`指向 FilePort，那是历史样例未与当前候选语义一致，不能按现行Writer签发。此次将新Gift141范本另定义 `SaveAction`（`domain:meaning`的operation、具有文档角色），仍保留外部解释、Authority、UI动态映射Needs。

**跨根发生点**：每个Target根选择的根发生点是独立的。共享Template中的`saveWorkflow`及`saveClick`局部ID在`primary/EditorA`与`secondary/EditorA`分别实例化，不能仅以`(DefinitionID,useId)`作为实际运行、缓存或授权身份；使用完整的`(project revision,target,rootId,componentInstance,memberUseId/routeId)`限定作用域，另保留被引用Definition的规范身份。


仅拥有 `uiParticipations`、`eventParticipations`、`protocolParticipations`、`stateParticipations` 与 `workflowUses`，只能证明组件声明了成员关系，不能回答**哪个按钮、收到哪个事件、哪个API请求或哪次定时条件会激活哪个流程**。为消除这个缺口，现有 `product:component.body` 在同一Writer增设**局部有类型关系** `activationRoutes[]`，每条有稳定 `id`、单个 `cause`、单个目标 `workflowUseId` 及可选 `inputBindings`：

- UI操作：`cause.kind=ui-action` + `uiUseId` + `nodeId`；`uiUseId`必须指本组件角色为`control`的 `ui:view` 成员使用发生点；`nodeId`必须唯一定位该UI树中带 `actionRef` 的节点。`UiNode.actionRef` 必须指向有资格的 `domain:meaning`且类别为`operation`或`event`，表示用户要求发起的业务动作而非可执行函数、Workflow或`effect:port`；缺解释/参数映射/权限保持Needs，绝不会绕过Workflow直接派发Effect。显示角色`render`不自动取得输入控制资格。
- 事件流输入：`stream-event` + `streamUseId`；它指向本组件角色为`subscribe`的 `event:stream`成员，发布者的`publish`不能冒充订阅。消息载荷、身份、顺序、重放、重复、晚到以及授权须由事件专业消费者处理。
- API输入：`api-endpoint` + `protocolUseId` + `endpoint`；必须是本组件 `server` 角色的 `api:protocol`已声明端点，不能把客户端的同名API当作服务端调用；请求、响应、错误与动态实参另行取得映射资格。
- 本地状态事件：`state-event` + `stateUseId` + `event`；只有本组件 `host` 的状态机及其实际 `events`成员可作为这个原因，纯观察者不能成为状态触发权威；需处理状态机当前配置、微步队列和转移仲裁。
- 时间触发：`schedule` + `scheduleRef`；它只声明具有专业意义及时钟/有效域条件的触发来源，不能把任意字符串或无授权环境定时器当作已满足调度语义。

每条路由的 `workflowUseId` 必须指向**同一个组件定义内**具有 `useId`的 `workflowUses` 使用出现点，而不是仅指可复用工作流Definition；目标必须精确继承实例已签实参及本次出现点身份。`DefinitionUse.useId` 只为需被其他局部关系寻址的出现点提供稳定局部名字，不改变目标Definition身份，也不强迫所有未被寻址的成员额外编号；在同一成员容器内的显式 `useId`不能重名。`ActivationRoute.id`与本地业务事件、SourceSpan、真实运行InvocationID及Effect OperationID互不相同。

`inputBindings`逐形参绑定有型ValueSource，只完成当前cause载荷、合格UI输入、上下文或状态的简单投影；不包含函数调用或权限变换。复杂转换使用显式compute步骤或包装workflow，`domain:meaning`不能冒充可调用函数。省略表示空映射，不能按同名字段自动转送。输入签名、来源限制及旧`inputMappingRef`的等价callable/类型/错误/效果证明要求由[工作流Owner](../交付语义/工作流执行关系与激活.md#旧载荷的只读迁移与拒绝条件)统一规定。无动态输入的点击可以仅用组件已绑定上下文；需要输入的路径不得靠空值Stub进入Method。编译器必须检测多个原因对同一流程的并发竞争、重入与防重复外部效果是否满足既有 `concurrency:contract` 与Requirement；本地路由自身不发Grant、不派发Effect、也不证明工作流必然完成。

未声明的事件链不会由字段共处自动生成；但不必强制每个声明的Workflow都有外部入口——它可以只由其它Flow调用或作为未使用的可复用能力。`subscribe`/`server`参与存在却没有实际处理/观察路径时，应产生带发生点的未决消费义务，而非断言产品完整。源本身不具有足够信息判定动机是否是故意沉默，必须与**独立接受的业务功能范围**共同判定。静态Linker至多核定位点、role、接口及唯一性，动态事件取值、幂等、精化、反馈回路、寿命和权限仍在相应专业Owner。

<a id="business-kind-consumer-coverage"></a>
### 定义形状及专业消费：统一的27类候选，计算不再被永久排除

**表达闭包不是 Kind 数量闭包。** 27 种 Definition 的 `kind` 只区分 Body 的初始解释责任：开放业务对象和新业务关系优先由 `core:type`、`domain:meaning`、`semantic:pattern`、`semantic:pattern-use` 和组合产生；有限计算由 `core:function` 的类型化递归表达式和固定库操作产生；Query、State、Workflow、UI、Protocol、Component 等保留各自不可互换的专业语义。每个 Kind 的**字段集合**由唯一 Schema 定义，真正的类型、作用域、基数、知识状态、权限、生命周期、失败与目标消费由其唯一 Owner 定义。不能把“出现 Kind 名称”当作其 Body、专业消费和完整降低已具备。

**单一发生点组合接口。** 任何有复用语义的使用要携带被引用的固定定义、发生范围、所需角色、参数实参和显式的约束差异。只有抽象签名已承诺可继承的语义才随 `Use` 传播；调用到Method实现、状态实例化、上下文对象签发、外部资源持有权分别属于别的接口。`DefinitionUse.bindings` 省略代表空映射，不会补全未声明的角色；同一定义经两个Use或两个Root产生不同业务实例时不能仅按字符串去重。`extension:definition` 是明确供应的受限扩展入口，不允许任意载荷绕过基本角色/范围/效果和目标资格。

**开放完整性的合理判据。** 任意作者意图至少要能归纳到有类型主体、可观察谓词或合法计算函数、量化与时域、硬/软规范、状态/行为、资源及权限、可选择的产品接口；不能直接归纳的专业语义必须通过有精确消费者的扩展取得表示，否则报告具体无法表达的构造。即使表达已闭合，世界知识不足、解不存在、供应缺失、不可判定或不可执行仍分别可能发生，不能靠新增自由字符串 `intent` 自动消除。


这一张表对同一作者语言的每个 Definition Kind 明确**作者决定、真正语义 Owner、专业解释与拒绝条件**。它仅是跨专业职责索引；有类型 Body 的机器字段以当前 `schema/author/universal-author-module-2.schema.json` 为准，具体计算、状态、查询及目标语义由下面指明的Owner正文承担；不能用“种类列全了”代替运行意义或输出资格。27 是当前协议的判别分支数量，不是必须同时出现在一项业务源码中的27种对象、27层架构或27种底层计算原语。

| Kind | 专业语义 Owner | 开发者实际决定与消费边界 |
|---|---|---|
| `core:type` | 类型与求值 | 名义/结构值、泛型实参、公开性、字段缺失/可选、精度、量纲、可变性与精化；TypeResolver检查递归良构、等价与合法构造，结构相同不推出身份或Grant相同。 |
| `core:constant` | 值Codec与纯求值 | 有类型定值表达、编码和确定求值；有副作用、未锁定输入、不确定浮点/时间或非可重现求值不能作为编译期常量。 |
| `core:function` | 计算、控制与效果 | 参数/返回、局部作用域、泛型/递归/高阶值、表达式体、错误/效果及可选终止条件；有类型计算语法不允许隐式外部I/O；目标若缺计算/效果Lowering则仍未实现。 |
| `core:interface` | 可调用接口 | 操作签名、输入/输出/错误、效果和版本兼容；接口声明不创建执行对象，不赋予ABI、传输或外部授权。 |
| `domain:meaning` | 开放领域与知识 | 类别、名义角色/类型、返回含义、解释来源、适用域、观察/规范权威和生效时间；没有专业解释器与有效事实来源，不允许按名字推断真实含义。 |
| `state:machine` | 层级状态与时间 | 状态、初始、事件、转移选择、缺失转移、Frame/不变量、活动代际和进展；并发触发需要有据仲裁，图上转移不代表持久提交或现实效果。 |
| `event:stream` | 事件与流 | 事件型、顺序域、投递保证、重放/去重、事件时间、水位线、迟到与背压；发布、投递、确认与处理是不同阶段，不能从 `exactly-once` 字面标签推出跨系统恰好一次。 |
| `workflow:plan` | [工作流与持久任务](../交付语义/工作流执行关系与激活.md) | 入参/结果/错误、入口、显式控制边、数据就绪、失败/取消/超时、人工任务、子流程、恢复；完成一个Workflow调用不等于Goal成立或Effect结算成功。 |
| `api:protocol` | [调用宿主与服务边界](../交付语义/调用宿主与服务边界.md) | 方向、端点、会话、编码、兼容、错误与重试；客户端需要/服务端提供不能因一个接口名相同自动匹配，真实传输由Target和Provider供应。 |
| `data:model` | 数据模型与持久化 | 实体/键/约束、一致性、隔离、事务、保留、迁移和来源；类型声明不自动产生表、全局原子性或真实存储。 |
| `data:query` | 查询代数与维护 | 有型输入、过滤/连接/聚合/递归/排序/分页、Bag/Set、Snapshot、Null/Unknown和完整性；递归删除/负依赖、流更新和权限遮蔽须由查询Owner解释，SQL适配不是自动存在。 |
| `ui:view` | [交互和呈现](../可选语义/产品交互与呈现语义.md) | 可访问组件、状态、事件与用户业务Action；UI ActionRef定位领域动作，不等于 `effect:port`，由ActivationRoute接上具体Workflow发生点，输入映射、焦点、无障碍和宿主具专业资格。 |
| `resource:model` | 资源/容量/租约 | 量纲、真实可用容量、保留、分配、公平性、租约、回收与共同预算；模板声明的数量不等于运行资源、也不跨Root自动共享。 |
| `concurrency:contract` | 并发/一致性 | 竞争与可见范围、顺序、原子边界、冲突、取消、进展；本地mutex不代替分布式事务，`serializable` 字段不代替真实供应证据。 |
| `security:policy` | 规范/授权 | 法源、主体、对象、行动、允许/拒绝/附加义务、例外、冲突、撤权及有效期间；规范许可、工具权限、宿主Grant和已派发效果四者不得合并。 |
| `effect:port` | 外部效果/执行结算 | 多操作端口的准确操作名、参数/结果、错误、Grant范围、幂等、重试、未知结算及读回；Port仅声明行为边界，必须另得Provider和当前Grant才可执行。 |
| `observation:contract` | 观察及事实来源 | 被观察主体、观察者与独立性、范围、时钟、覆盖、冲突、新鲜度；未观察、真、假、互相矛盾不得压成一个Bool。 |
| `quality:contract` | 质量/测量 | 指标、单位、样本窗、测量权威、硬/软、可比性及失效范围；没测量不能自称最优，不可靠的负样本不能证明永久未发生。 |
| `product:component` | [组件定义与实际实例](../../70-工程系统与演进/实现与装配/模块与运行实例-成品装配-实际对象作用域与入口闭合.md) | 模板所供/所需的有型接口、静态参数、上下文角色、局部成员参与、ActivationRoutes与Requirement；模板出现不代表实例、动作发生或服务供给已实现。 |
| `product:system` | [产品根与多实例联合](../../70-工程系统与演进/实现与装配/模块与运行实例-成品装配-实际对象作用域与入口闭合.md) | 组件实例、内连线/外部依赖/公开出口、根级Requirement/Policy/Quality、真实上下文与选定部署；相同模板在不同根的实例不能按名字共享状态。 |
| `product:deployment` | [部署与迁移](../交付语义/发行部署与迁移.md) | 节点到具体ComponentInstance、环境、容量副本、Secret引用、发布迁移回滚；部署声明/生成制品/实际运行/恢复是不同事件。 |
| `native:implementation` | 原生源码及Method供应 | 真实来源Region、语言、符号、可调用接口、ABI、效果、读写权和SourceMap；原生代码的存在不证明其业务要求已满足，也不能覆盖作者拥有的区域。 |
| `extension:definition` | 扩展准入与版本化语义 | 方言身份、专用Body Schema、类型/效果/角色签名、解释器与目标资格；不允许用任意`payload`、裸`Any`、名字相似或万能 `invoke` 逃过专业解释责任。 |
| `intent:goal` | 目标和规范义务 | `achieve/maintain/avoid/oblige/permit/prefer` 各具主体、时间和生效强度；正确区分逻辑公式、开放量词、规范来源、作者接受与现实Goal的达成。 |
| `semantic:pattern` | 业务抽象/变化点 | 共通不变量、角色签名、基数、开放差异与合法精化条件；只能复用真实共同语义，不因Body相似就在全行业复写一套模式。 |
| `semantic:pattern-use` | 精化/发生点绑定 | 引用指定Pattern、实际角色与Scope、差异实例化、必要条件及其来源；相同PatternDef的两次使用仍分别有身份与义务。 |
| `req:composite` | 需求逻辑及联立 | `use/require/prefer/all/any/when/forEach/exists` 保留硬软、时间、量化全域及冲突规则；局部分别可满足不推出共享资源/权限/时间下联合可满足。 |

上列 Kind 与五类具体关系正交：Declaration/Use/Instance/SelectedRoot/RuntimeFact 不因 Kind 重复定义；`Type.tag`的19类、`Expr.op`的17类与 `RequirementTerm` 的8类均是不同层级嵌套语法，不可混进这张 Definition 枚举。Type、Value、Role、Scope、Identity、ReadSet 等共同机制只实现一次；Role的“发/收、拥有/借用、提供/消费”等**业务方向**由实际专业字段解释，不能抹成一个万能关系集合。

**边界而非停工声明**：对计算函数、开放 Meaning、现实 Effect、新领域方言，开发者源可以合法保存且获得对应设计合同；其类型/语义若无法解释，不能改口宣称“只是非计算阶段，所以默认可通过”，而应按实际来源返回 `NeedsMeaning/NeedsMethod/NeedsTarget` 等未资格状态。本工程当前仅交付设计，未实现或发布上述执行者。

## 业务意图与开放领域的具体语义合同

**职责范围**：本节解释业务作者能保存、引用、组合与变更的开放领域意义；同一作者语言中的普通计算、通用类型和查询已经分别由计算/查询专业正文定义，业务意图不因它们存在而变成一个函数体。对于独特算法，作者可表达 `core:function` 或维护合格 TS/Rust 原生源码，取舍以该算法的实际语义和目标资格决定，不要求把已有原生源码重新展开成庞大表达式树。

此节是已有`gift.author-module/1`、候选`gift.author-module/2`的**业务作者解释与组合规范**，不是新协议版本、第二份AuthorSource或新的63种关键字。所有既有Kind的准确JSON字段仍由对应Schema唯一规定；下列合同名代表作者可见的独立意义，具体落入已有Kind/专业方言的有类型Body与锁定Ref，而不是允许任意JSON字段。

### A. 完备的对象边界与三个不同结论

- **作者表达结构覆盖**：已接受的业务差异能被现有有限结构、有限组合或有版本的开放方言保真表示，必要的未知可以被准确登记；表示无从得知的现实事实不要求伪造它。
- **领域意义闭合**：业务类型、事实、关系、规则、政策、时间、观察者及来源在本次被引用处拥有可信解释；字符串合法不是语义合法。
- **产品实现闭合**：联合要求与Method、Target、运行和独立证据均取得相应资格。本阶段只把编写与交接设计闭合，不实现这些消费者。

“任意行业都能写”指**作者语义语言对新概念、关系、政策和过程开放**，并具有不丢作者区分的扩展途径；不是预先知道所有未来行业事实，更不意味着编译器自动发明任何算法或证明所有产品。

### B. 开发者必须能够独立表达的全部通用语义维度

| 职责维度 | 精确作者信息 | 不可合并的对立概念及拒绝条件 |
|---|---|---|
| 身份与类型 | 名义Identity、角色、存在域、类型签名、基数、物理对象映射 | 同名≠同一、值相等≠对象相等、已声明≠实际存在 |
| 属性与单位 | 属性形状、精度、值域、单位、枚举、未知/缺席、所属权 | 精度及换算无授权时不能隐式变换 |
| 关系与结构 | 关系端点、拥有、包含、拓扑、依赖、重数、序列 | 序列≠集合；共享≠独占；未闭合集合≠全集 |
| 知识与事实 | 事实来源、权威、正反证据、时间、观察完整性、有效范围 | 无证据≠假；冲突≠可以任选一条 |
| 主体及利益 | 使用者、客户、提供者、组织、付费者、风险承担者、监督者 | 操作发起者≠规则签发者≠批准人 |
| 目标与规范 | achieve/maintain/avoid/oblige/permit/prefer、条件、例外、软硬 | permit≠Grant、prefer不能削弱硬规则 |
| 时间与进展 | 时钟、区间、期限、序列、保持、最终进展和观察域 | 现时成立≠全时成立；超时≠外部操作失败 |
| 状态与事件 | 状态、转移、业务事件、命令、交付与确认、历史和失效 | 命令≠已发生事件；提交≠持久化≠已观察 |
| 工作与流程 | 触发、前提、活动、等待、条件、分支、协调、取消、补偿 | 流程定义≠已执行；完成动作≠达到业务目标 |
| 数据及查询需求 | 业务数据身份、关系、一致性、读取完整性、筛选语义和隐私 | 本节不替代Query/Compute的已有合同；业务作者不必维护SQL计划或算法实现 |
| 资源与共享 | 资源身份、数量、所有权、租期、容量、预留、成本、冲突 | 逐项可行≠全局可行；预算≠当前余额 |
| 并发及分布 | 竞争域、原子性、顺序、隔离、复制、分区、确认与取消 | 本地锁≠跨组织全局一致性 |
| 协议与交互 | API/消息/会话、错误、兼容、UI行为、导航、无障碍、本地化 | Gift工作台主题≠所生成产品的UI规则 |
| 真实作用与权限 | 允许操作、外部Port、幂等、效果范围、授权、读回、恢复 | 作者写EffectIntent不产生真实操作权限 |
| 质量与风险 | 性能、可用性、安全、损害、隐私、成本、测量负载与证据 | 没有量纲/范围的“高质量”不是可检查合同 |
| 产品与环境 | 组件、能力提供/需求、连接、Target、运行环境、部署、迁移 | 产品根有定义≠完整源码已生成或部署 |
| 演进与证据 | AuthorRevision、供应版本、Compatibility、SourceMap、Evidence要求 | 设计版本≠已生效版本；作者期望证据≠独立结果 |

这些是**不可损失的信息区别**，不是17个固定必填字段、17层IR或17种Schema Kind。实际文档按需要有选择地组合，多数信息可由合格领域库、外部标准和已有公开组件提供，作者仅保存其特有差异与有权选择。

### C. 每个业务Definition可由什么构成：具体语义接口

1. `DeclaredIdentity`：稳定逻辑ID、Module、原定义或本次Occurrence、对外导出名、作者权、Origin及精确版本；来源文件路径只负责物理定位。
2. `PublicSignature`：角色和数量`one/optional/set/bag/sequence`、输入输出的名义对象、关系端点、错误范围；单值与集合不能相互伪装。
3. `ContextConstraint`：地域/法域、用户、租户、时区、ProductRoot、Target、Deployment、操作时刻、修订、观测范围；“整个系统”必须明确系统边界。
4. `MeaningRef`：受资格的领域定义、单位与解释规则、适用条件及来源；未取得解释器只形成`NeedsMeaning`而非默认Bool。
5. `GoalRef/RequirementRef`：六模态、八种RequirementTerm、主体、时间域、触发、例外、量词域与硬软区分。
6. `BehaviorContract`：允许/禁止行为、事件、状态转移、错误、异常、未知、取消、恢复、进展与可观察结果。
7. `Relationship`：组件和主体之间的拥有、关联、提供、依赖、实例化、实现、监督、共享资源及约束交叉关系。
8. `ResourceEffectContract`：容量/额度/寿命、外部效果、必要实际Grant、幂等保护、补偿或对账、读回。
9. `PortInteraction`：公开协议、服务契约、会话、界面状态与无障碍；不得由内部函数命名推定公开兼容。
10. `QualityEvidenceDemand`：测量指标、单位、输入规模、负载、时间、检查方法及证据独立性，区分计划检查与实测结论。
11. `RealizationFreedom`：作者必须固定的可观察设计与可委派的算法、容器、目标、存储及部署选择；有硬要求时先满足硬要求。
12. `EvolutionContract`：变更影响、回滚、兼容、迁移、已提交操作保护、依赖失效、不可逆点。

这12个名字**不是新增作者源JSON属性**。它们应落在现有Profile的明确Body字段及其引用的合格领域Definition中。一个Kind没有适合的合法字段时，必须以已发布的`extension:definition`供应合同扩展，不能追加未声明键或让Parser接受不明属性。合格的扩展提供`dialectRef`、版本化Body Schema、解释/组合和目标消费要求；若当前消费者不存在，该部分保持`NeedsDialect`，不声称已表达且可以编译。

### D. 作者写哪种源：当前合法形式与尚未签发形式

| 真实文件类型 | 写入的权威内容 | 作者不可伪写的其他事实 |
|---|---|---|
| `gift.project.json`，`gift.project/1` | 工程标识、SourceScope、目标与选定根；模块路径由实际发现索引派生 | 已解析Method、实时设备、已通过构建 |
| `*.module.json`，历史`gift.author-module/1` | 仅供兼容读取的旧意图、Pattern及Requirement定义 | 不能继续作为新业务并行Writer或绕开新模块唯一性 |
| `*.module.json`，候选`gift.author-module/2` | 同时承载业务意图、类型、计算函数、查询、领域Meaning、状态/流程、接口/UI、资源/质量和产品组合 | 不存在的领域Dialect资格、目标后端或外部Observation |
| 原生TS/Rust、外部库 | 用户确实需要自定义的算法及实现，保持原生源码所有权 | 由源代码存在推定业务保证已获满足 |
| 稀疏Control、Target/Deploy需求 | 作者允许的方案限制与委派范围，分清产品控制与运行输入 | 把调试器UI配置当业务逻辑或把偏好当法律政策 |
| assets/、领域依据及规范附件 | 有明确用途、来源和版权的内容 | 靠附件文件名自动宣称规则已获得权威 |
| 派生Lock/IR/制品/证据 | 各有权消费者处理，**不作为作者第二真源** | 手工伪造Provider摘要、Evidence或实际效果 |

> 计算构造现在作为同一作者语法的正式设计范围，由类型、求值与目标专业条款精化；本轮不实施计算器或目标后端。普通业务作者不应为了使用Goal、UI、Workflow或Policy被强制编写`core:function`、表达式树或查询优化器。

### E. 统一组合合同：能变成完整业务系统，而不靠万能算法

- `define`：把有权采纳的角色、主体、关系、前提、期望、禁止和观察变成唯一Definition。未知Meaning允许留待供应，不能接受同名代签。
- `abstract`：抽取不同业务的共同约束时必须列出差异槽、必要例外、正反例与观察域；不能因为能复用“预留容量”就删除银行结算或临床批准。
- `instantiate`：Pattern实例绑定名义身份和准确基数，缺必需差异、类型精化或成员域完整性就停止。
- `specialize`：精化可增加业务约束，但不得偷偷使父公开合同不再成立；不凭继承关系取得新的权力。
- `compose`：从精确已选Root及另有权要求的并集取得全部相关硬义务；对共享主体、数量、时空与资源执行全局合取，偏好只在已合格候选比较。
- `refine`：定义Method必须提供的前/后置、正常进展、资源、失败、Frame、时域与观察保持证明；本阶段不实现求解器。
- `realize`：定义Target必须消费的完整制品根、接口、依赖、迁移、源码归属及环境，不在设计文件生成假的TS服务。
- `observe-and-verify`：作者写期望观测与验收条件，外部Observer/Assurance分别签发真实观察和证据，不互相越权。

**统一拒绝区分**：非法结构`InvalidSource`；合法Ref但未解析`NeedsBinding`；无真实意义`NeedsMeaning/NeedsDialect`；缺授权`NeedsGrant`；约束经有效证明无解`Unsat`；存在候选未完成搜索`SearchIncomplete`；缺合格实现`NoQualifiedMethod`；目标不能完整装配`NeedsTarget`；读回不充分`ObservationUnknown`。每种诊断指向Owner、引用发生位置、所需来源、已保留的合格结果以及失效依赖。

### F. 设计阶段的完备性门禁（不是产品测试通关宣言）

所有独立开发者决定必须有**作者源落点或合法外部权威落点、完整的主体/时间/范围/权能限定、组合规则、未知或冲突的准确表达、消费接口、版本与失效路径**。45个语义家族的135个独立侧面逐项映射到本页已有Kind或受资格的专业Dialects；同时用跨主体资源预留、IDE、金融结算、医疗设备、分布式协作、物理控制及未见过的行业关系反向挑战。一个新概念需要专业解释器不意味着抽象结构失去开放性；反过来，只留任意`payload`、`invoke`或字符串，未规定消费者，也绝不能号称语义已完备。

这项门禁是**设计可检查的覆盖与接口充分性**。纯理论上“存在一种表示”并不能提供外部法规、事实、专业算法或正确运行的证据；因此不因没有先写编译器而拒绝完整设计，也不以设计覆盖宣称任意业务自动正确生成。


### G0. 开放新领域的正式意义供应合同：让所有新行业都能扩展，而非靠自由文本

本阶段只设计**非计算意义供应的作者界面**。当通用`domain:meaning`的`interpretationRef`指向某个新的专业规则时，必须有一个受资格、可锁定的领域供应满足以下各项；不允许把`interpretationRef`的存在等同于实际实现。

| 领域MeaningSupply需要解决的独立事项 | 作者或专业供应者必须提供什么 | 无法得到时的处理 |
|---|---|---|
| 名义身份与签名 | 域名称、稳定ID、版本、角色、角色基数、名义类型、输入与可观察结果 | 签名不匹配或歧义时不猜参数映射 |
| 解释定义 | 概念的观察条件、可接受状态/关系、等价/区分和本次作用范围 | 无规则时`NeedsMeaning`，不能把自然语言定义直接转布尔 |
| 来源与权威 | 规则制定者、签名/审计来源、版本时点、法域/组织/租户权限 | 作者不能代签外部法律、银行、医院、真实设备来源 |
| 事实与知识 | 数据来自哪里、读取范围、完整性、时钟、冲突证据及未知解释 | 不完整集合不能被全称或否定查询视为全集 |
| 组成与精化 | 与身份、状态、时间、规范、资源、权限和已有Meaning如何联合/冲突 | 不具合格组合规则时`NeedsDialect`，不忽略额外限制 |
| 对外操作 | 需要何种EffectPort、Grant、可重试域、读回、故障与恢复策略 | 可描述“需要效果”，但不能获得执行资格 |
| 合格消费者 | Reader、Interpreter、Requirement、Method或Target消费责任、版本依赖 | 找不到消费者时仅保留声明，不生成假工作流 |
| 兼容与迁移 | 老版本的作用域、破坏变化、在途义务、迁移后不变量 | 新版发布不能默默修改已接受的业务意义 |
| 验收证据 | 哪个主体能观察、证明范围、最小证据及独立检查要求 | 没有实际Evidence时不能自称满足目标 |

在现有候选协议中，`domain:meaning`的Body有`category/parameters/result/interpretationRef`以及可选`observationRef/authorityRef/scopeRef`；`extension:definition`具有`dialectRef/bodySchemaRef/payload/bindingRef`。它们提供**定位和准入形状**，不意味着上述业务内容都应被塞入这两个Body。需新领域区分时，由确切的Dialect Supply定义其规范Body Schema、语义解释、组合规则、版本及权限，再通过`gift.project/1`允许的模块引用与真实锁定消费。若缺一个不可由现有来源导出的区分，则对那个Definition返回精确Need；普通业务作者不被迫创建新的Rust算法求值器。

### G1. 统一关系的有类型消费：哪一条引用实际影响什么

关系不是任意`dependsOn`字符串。现有工程关系`defines/uses/instantiates/refines/consumes/requires/provides/qualifies/observes/controls/invalidates`等在各Owner内保留精确含义；以下只规定**作者侧必须保留的信息**，不新增图数据库或新的语言关键字。

| 关系种类 | 起点与终点 | 作者必须提供或保持的条件 | 禁止的错误推断 |
|---|---|---|---|
| 定义/使用 | Module与Definition；Occurrence与Definition | 公开/私有范围、版本、导出身份、实参绑定 | 同一Definition的两个使用点未必是同一业务实例 |
| 实例化/特化 | Pattern/Role→具体业务对象/专门合同 | 名义精化、差异槽、基数、时间与主体 | 复用公共模式自动继承所有领域权限 |
| 声明/要求 | Goal/Requirement→Meaning、主体、资源与时间 | 量词域、硬软、规范权威、观察范围 | 用空Requirement或未选Goal冒充产品要求完整 |
| 提供/需求 | Component/Port→接口与能力 | 可见签名、版本、错误与兼容、资源限制 | 同名Port即彼此兼容或供给已经安装 |
| 计划/效果 | Workflow/EffectIntent→Operation要求 | 前提、幂等、Grant、超时未知、回读与恢复 | 计划的动作已经被实际执行 |
| 测量/保证 | Quality/Observation→Claim、Evidence | 方法、测量场景、证据范围、权威及独立性 | 测试文件存在就证明质量符合 |
| 精化/实现 | 语义合同→Method/Target | 全局前提、成功、错误、进展、Frame、来源 | 局部构建通过就是完整系统或最优方法 |
| 变更/失效 | 修订/外部事实→受影响资格与制品 | 正、负依赖及真实在途作用 | 新源码覆盖旧结算；无变化路径则无条件重算全部 |

### G2. 多主体、多根、不同作用域的完整组合顺序

1. 冻结实际作者认可的工程和SourceRevision，并区分项目模块、公开Definition、一次使用Occurrence和真实业务对象Identity。
2. 按`gift.project/1`精确选择Target与公开根；根选择只决定受理范围，不会自动赋予Meaning、Provider或Method资格。一个`product:system`根与另一个`intent:goal`根应当同时参与共同要求；未选中、也非传递依赖的定义不自动进入本次产品。
3. 解析真实模块导入和锁定版本，再对各业务Meaning及开放Dialect取得其签名、权威与适用范围。引用未锁/解释不明时保留已合格部分并明确Needs。
4. `semantic:pattern-use`以角色基数和必要差异实例化；不把跨使用点主体合并，也不把集合部分读取当作完整量词域。
5. `intent:goal`六模态与`req:composite`八种结构各按唯一语义Owner解释，组成全局相交硬要求、规范义务与软偏好；同步处理共享时钟、资源、主体与规则例外。
6. 在硬要求真实可行且有合格Method供应后，才允许合格目标装配；缺算法实现时返回Needs/NoQualifiedMethod，不要求业务作者换成计算AST来解锁。
7. 编译器没有权限推断真实执行已经发生。外部Grant、Operation、Readback和独立Evidence按各自Authority签发。
8. 任一来源/根/外部规则/资格更新，必须从对应正负依赖准确撤销相交证据；不因新版改变已结算或在途操作身份。

**必须拒绝的反例**：同一规范义务被某个附加Goal覆盖成偏好；局部两个资源请求可行而整体超额；未批准外部收费被编译器发起；医生未批准却以设备串口成功写入视为临床允许；运行时超时被当成“未作用”；开发者主题设置无意间改变产品 UI；两位真实业务主体仅因使用相同命名模板而被合并。


### G. 45类工程语义家族、135个独立侧面到作者源的完整路由（设计覆盖，不是45个原语）

原有135个侧面逐字保留作**区分检查**；右列说明现有Definition或有资格的外部Dialect怎样承担，不保证消费者已经实现。

| 家族 | 三个独立含义侧面 | 作者正式落点 / 边界 |
|---|---|---|
| 01 工程身份与存在 | 定义引用、作用域、版本、不可见和歧义不能凭显示名推定；逻辑身份、值相等、临时定位与内容哈希分别检查；逻辑主体声明、实例创建、资源物化、被观察存在是不同事实 | `core:type`、`domain:meaning`、`/1`roles。领域身份与现实存在需要独立解释 |
| 02 类型与合法数据 | 名义类型与结构等价、强制转换与外部构造授权；不存在、null、None、未加载、未知、坏数据；值域、长度、枚举、单位与运行时可信入口验证 | `core:type`领域形状、`domain:meaning`。本轮只设计数据含义，不设计通用计算类型演算 |
| 03 结构、拓扑与关系 | bag/set/sequence、去重与排列顺序；关系端点、方向、基数、传递/递归闭包；拥有/包含/关联/引用/依赖之间的区别 | `domain:meaning`、`data:model`、`product:system`。关系端点/基数/共享与权限须独立 |
| 04 事实、来源与知识完备性 | 陈述者、可适用域、来源、时间和权威；开放、封闭、有界覆盖、不可见和陈旧来源；多来源互斥及不确定，不由最新时间自动覆盖 | `observation:contract`、`domain:meaning`。Fact来源、正反证据和完备性分开 |
| 05 目标、需求与规范性 | 前提、硬条件、负约束、保持范围；偏好排序只能在硬合格候选之间发生；条件义务、例外和优先级必须有真实定义 | `intent:goal/1`、`req:composite/1`。六模态/八Term各保留原语义 |
| 06 选择、规则与利益冲突 | 重叠、命中策略、缺项、边界优先规则；成本、收益、付费/受害主体的分离；决策建议、批准与受权执行的边界 | `req:composite/1`、`quality:contract`、Policy。硬要求、批准权及优化目标分开 |
| 07 状态、版本与生命周期 | 状态集合、初始化、守卫、转移冲突和历史；转换前后保持、帧与部分失败；逻辑状态revision与物理数据提交的区别 | `state:machine`、`data:model`。状态迁移、修订和物理写入不同 |
| 08 活动、任务与工作流 | 定义存在、被调用、已开始和已结束区分；执行顺序、人工等待、补偿与超时的意义；终止、公平性、最终进展与未决阻塞 | `workflow:plan`、`intent:goal/1`。工作完成不代签业务目标 |
| 09 命令、事件与消息 | 命令要求、事实事件与通知不同；发送/接受/持久化/处理/确认不同；源序、分区序、重复/乱序/丢失与重放 | `event:stream`、`api:protocol`。命令、事件及送达确认不同 |
| 10 时间、时限与演进时序 | 时钟域、精度、漂移与时区历法；间隔边界、先后/重叠/包含关系；超时/取消/过期、生效时间与到期处理 | `intent:goal/1`、`workflow:plan`、时间Meaning。时钟、范围、时限和进展不得猜测 |
| 11 计算、算法与函数 | 值/类型/求值次序、异常和无界循环；函数复用、局部变量、递归、闭包及目标降低；复杂度、稳定性、精确/近似与候选资格 | `native:implementation`、Method供给。计算语义由有型 `core:function`、效果、Method与原生Owner精确分工 |
| 12 持久状态、事务与恢复 | 可见性、刷盘、恢复语义与副本；原子边界、隔离、冲突/重试和实际提交；版本兼容、迁移不变量与回退的可行性 | `data:model`、`effect:port`、`product:deployment`。数据库提交不等于外部结算 |
| 13 现实作用与操作结算 | Operation/Attempt、前像和当前权限；作用成功/失败/部分/未知各有结果代数；操作身份、去重寿命、重试与补偿的非等价 | `effect:port`、`observation:contract`、Grant。Intent、Attempt、Settlement与Readback分开 |
| 14 并发、同步与进展 | happens-before、线性化位置与内存序；锁/无锁、等待/饥饿与公平进展条件；任务树、取消传播、异步异常与资源清理 | `concurrency:contract`、`resource:model`。竞争域、顺序和取消必须被限定 |
| 15 分布式成员与共识 | 副本来源、确认界线、read/write一致性；网络分区、脑裂、fencing与恢复；节点/数据区域、拓扑、迁移和故障域 | `api:protocol`、`concurrency:contract`、Deployment。跨节点共识与分区需要专业Method |
| 16 资源、所有权与寿命 | 所有权与共享/借用、迁移、alias和最后使用；对象、句柄、设备、进程/会话不同寿命；内存/CPU/IO/能耗配额及超限结果 | `resource:model`、`quality:contract`。资源额度、所有权、租约、测量分开 |
| 17 身份认证、权限与信任边界 | 身份来源、失效、凭据和绑定范围；Permission/Prohibition/Grant/委派与撤销；进程、租户、网络、插件及跨域信任与沙箱 | `security:policy`、`effect:port`。产品许可不同于执行Grant |
| 18 隐私、秘密与数据用途 | 敏感分类、派生污染与脱敏；收集/处理/共享的用途和主体授权；留存、撤销、删除、不可恢复副本和legal hold | `security:policy`、`data:model`、外部Policy。用途、主体同意和地区法律来源独立 |
| 19 安全危害与失效安全 | 危险状态、暴露、损害与环境假设；联锁、退化、安全态、fail-safe/fail-operational；安全论证、独立依据、风险接受权 | `intent:goal/1`、`quality:contract`、安全Dialect。需要有权危害模型与失效安全资格 |
| 20 故障分类与恢复 | 来源/传播/部分失败、错误优先级和诊断；可重试前提、补偿、前像、人工修复/回退；降级边界、恢复目标与可靠性损失 | `workflow:plan`、`effect:port`、Quality。未知、失败、补偿和不可逆操作分开 |
| 21 接口、会话与对外契约 | 接口行为、参数、错误和兼容窗口；身份、复用、幂等、reentrancy与复合协议；wire编解码、大小界、超时与安全协商 | `api:protocol`、`core:interface`签名。协议会话及编码不能从函数名推断 |
| 22 交互、导航与无障碍 | 交互状态、用户动作、等待/失败反馈；语义角色、名称、键盘/触屏/读屏和焦点；适配、视觉资产、可见内容与作者选择边界 | `ui:view`、`workflow:plan`。应用UI和Gift工具UI不同 |
| 23 语言、文本与地区表达 | 编码、规范化、字素/码点、大小写；复数、日期/数字格式与地区规则；多语资源、翻译版本与回退策略 | `ui:view`、本地化Meaning/Dialect。Unicode、地区格式需专业语义 |
| 24 空间、物理与设备边界 | 坐标系、拓扑、单位、边界和变换；校准、误差、采样、延迟和时钟同步；设备能力、失效模式、互锁与真实执行权 | `domain:meaning`、`effect:port`、设备Dialect。传感误差与现实执行权需要专业来源 |
| 25 反馈、控制与实时 | 状态连续/离散、驱动输入和可观察量；稳定域、采样误差、饱和和模型边界；deadline、可调度性、最坏时延、抖动 | `state:machine`、Observer、控制Dialect。连续动力学/实时控制需专业Meaning |
| 26 随机、概率与不确定 | 分布假设、独立性与随机源；统计总体/样本、置信/显著与偏差；未测量、无法区分、模型不适用与必然性区别 | `domain:meaning`、Observer、统计Dialect。统计推断与真值资格不同 |
| 27 因果、解释与干预 | 因果图、反事实、潜在共同原因与时间顺序；干预对象、效果度量与可识别假设；实验与观测识别条件、外推与无效边界 | `domain:meaning`、因果Dialect。干预与相关性不可替代 |
| 28 数据学习、模型与自适应 | 数据来源、标签、覆盖、许可与污染；版本、推断范围、校准、漂移监测；在线更新、决策权限和撤回失败模型 | `domain:meaning`、`data:model`、ML Dialect。模型训练、漂移及回退具独立资格 |
| 29 优化、资源代价与选择 | 多目标、基线、单位与公平性；合格条件、资源、时间、约束冲突；成本模型/测量范围/时延和回归证据 | `quality:contract`、`resource:model`、Method。先硬可行再谈有范围最优 |
| 30 金融、交换与履约 | 币种、精度、结算日/舍入和价值来源；守恒、扣减、锁定、预留和竞争；合同义务、对价、退款/争议与账实对应 | `data:model`、`domain:meaning`、`effect:port`。记账、预留和清算分别观察 |
| 31 人员角色、工作与协作 | 职责、权力、利益与监督的分离；审核、批准、交接、协作与例外；人类观测、确认、争议与撤销 | `security:policy`、`workflow:plan`、角色Meaning。身份、批准、协作与监督分权 |
| 32 法律、政策、标准与许可 | 规则出处、时点、法域、版本和生效范围；代码/数据/资产许可和归属义务；组织policy、豁免、审计/认可机构及撤销 | `security:policy`、Req、外部法域规则。外部法规不能由作者覆盖 |
| 33 运行观测、指标与服务目标 | 采样、单位、来源、误差、缺失与时间窗口；日志/指标/追踪、保留和脱敏；SLO、告警阈值、响应、责任与证据 | `observation:contract`、Quality。指标、采样、SLO和读回不是同一事实 |
| 34 声明、证据与独立保证 | 准确subject/revision/environment/observable/assumptions；证据取得方式、独立性、适用范围与负例；证据是否支持及缺口、陈旧、冲突和重新审查 | `quality:contract`定义证据要求；Assurance签发Evidence。作者不能自授独立合格资格 |
| 35 版本、迁移与兼容 | 语义不变优化、兼容扩展、破坏性修改；双读/双写/前像/回滚、旧数据与服务窗口；旧消费者和资源的真实退役与证据失效 | Project/Module Revision、`data:model`、兼容Req。迁移、旧状态和在途操作必须保全 |
| 36 方法、供给与目标实现 | 能力声明、版本、许可、安全和环境；候选合格性、Auto/Pin/Forbid与比较依据；目标生成保持条件、源码/ABI和错误/资源语义 | `native:implementation`、MethodSpec、Control。供应声明不等于Method精化资格 |
| 37 工程制品、表示与发布 | 语义相同多载体的来源/编码与往返；工具链、依赖、产物身份与可重现；发布、安装、部署、撤回及外部观察 | `product:system`、Target请求。完整制品与构建必须另行检查 |
| 38 配置、变量与系统环境 | 稀疏偏好/硬控制与源码区分；动态环境、秘密、权限和Provider读取；feature/target/环境适用域与差异继承 | `gift.project/1`、`product:deployment`、Runtime Input。运行环境不是作者静态声明的事实 |
| 39 开发者交互与 AI 协作 | 自然语言/结构作者/未知与意图采纳；确定源范围/稳定引用/冲突拒绝和受管回写；Agent提案、预算、权限、操作与审计 | AuthorDefinition、Control、Workbench偏好。AI候选不等于作者采纳 |
| 40 原生生态与供应链 | 版本/来源/完整性/漏洞声明与锁定；ABI/FFI/对象寿命、错误和初始化副作用；构建脚本/权限/信任来源和更新风险 | `native:implementation`、API、锁与许可证。ABI、安全供应链与依赖版本独立 |
| 41 媒体、信号与内容资产 | 帧率/时基/颜色空间/编码与容错；音视频同步、变速、剪辑/图像空间；版本、来源、许可、生成与分发 | `ui:view`、`domain:meaning`、媒体Dialect。媒体时间线与资产许可需专业Meaning |
| 42 环境与用户反馈循环 | 采样选择和延迟、闭环观测偏差；负反馈/正反馈、饱和/反弹与调节条件；自动策略的回退和人工接管 | `event:stream`、Observer、Workflow。回授延迟、人工接管和退化路径不同 |
| 43 查询、检索与覆盖推断 | 过滤、连接、索引一致性与递归；分页/排序/稳定快照、重复和遗漏；语义召回、证据范围、过期和权限遮蔽 | `data:query`、Observer、检索Dialect。召回与遗漏不能由命中结果自证 |
| 44 系统拓扑、交付与运维 | 进程/容器/节点拓扑、资源与网络关系；滚动发布、灰度、健康检查、回退和迁移；部署前后环境读回、实际运行与拆除 | `product:deployment`、Target/Grant。部署、回滚、拆除和真实运行分离 |
| 45 损害、权力与分配性约束 | 利益相关者、责任分配和不可代表的个人决定；成本/风险转嫁、不可逆损害与约束；解释责任、审查/申诉、监督与停用权 | `intent:goal/1`、`security:policy`、Quality。损害与受影响主体不可仅列技术性能 |

### H. 跨行业反例与设计停止条件

| 场景 | 本次抽象要保存的真实业务区别 | 不可越权的后继 |
|---|---|---|
| 大型IDE | 文档/选区/撤销、插件宿主、LSP/DAP、远程、文件与UI协作 | 没有专业编辑器Meaning/Method不能声称编出VS Code |
| 资源预留 | 多主体共享容量、租约、并发、取消、读回 | 局部可行不是联合可行 |
| 金融清算 | 币种、精度、双分录、冻结、授权、清算和对账 | 数据库存储成功不是银行成功 |
| 医疗与工业 | 物理量纲、设备校准、实时性、联锁、权限、独立风险接受 | 仅JSON合法不能证明现实安全 |
| 多方协作 | 身份、因果版本、权限、离线编辑、冲突及恢复 | 不能凭一个强一致性字面标签吞掉故障边界 |
| 未知未来领域 | 新概念、角色、关系、Norm、观测及专业实现 | 扩展接口成立不自动获得领域解释或Method |

**设计完成声明的正确形式**：可以说本阶段已为上述覆盖差异制定非计算作者源的路由、组合、边界和拒绝合同；不能说未来所有行业的意义已经全部解释，不能说生产级的源码生成与验证已经完成。

<a id="gift135-noncomputational-author-closure"></a>

### I. 业务源的确定写法：只在需要真实计算时才使用 `Expr`

这是**尚未发布的 `gift.author-module/2` 候选 Profile 的细化**，不改变 `gift.author-module/1`、六种意图或 `gift.project/1` 的既有线格式。计算构造已在同一作者语言中；不需要计算的业务定义无需写Expr，专业函数和算法则根据其真实语义使用 `core:function` 或原生源码。业务作者直接使用已有Kind的有类型Body；真正没有本次消费能力时保存待资格化Definition，不能以未声明JSON键或隐含算法充当语义。

| 原有Kind及准确字段位置 | 非计算输入与解释约束 | 没有资格时的结果 |
|---|---|---|
| `core:type.type`、`data:model.entities` | 类型/值域/数据身份及键属于**领域数据形状**；声明对象不证明该对象存在，键不证明全局唯一 | `NeedsNominalMeaning`、`NeedsDataAuthority` |
| `core:interface.operations`、`api:protocol.endpoints` | 公开角色、请求/响应/错误、交付及兼容界限；函数实现和wire能力不在此自动产生 | `NeedsPortProtocol`、`NeedsCompatibilityProof` |
| `domain:meaning.interpretationRef` | 领域概念的名义签名、输入角色、结果及解释者；缺乏可信解释不能靠 `name` 或 `bool` 替代 | `NeedsMeaning`、`NeedsAuthority` |
| `state:machine.transitions[].conditionRef` | 引用域内**已定义且有权解释**的业务条件；同一转移不得同时给 `guard` 计算表达式；同事件多转移须证明互斥或明确优先级语义 | `NeedsConditionInterpreter`、`NeedsDisjointness` |
| `event:stream`、工作流wait的`conditionUse`及decision的`routes[].whenUse` | 命令/事件/通知分离，条件引用不执行代码；步骤依赖不自动证明全部分支覆盖、完成或超时恢复 | `NeedsEventSemantics`、`NeedsWorkflowOutcome` |
| `resource:model.capacityLiteral` | `magnitude` 为精确非负十进制字符串，`unitRef` 与资源 `unitRef` 必须一致；容量字面值**不表示实际剩余额度** | `NeedsResourceMeaning`、`NeedsLiveCapacity` |
| `quality:contract.terms[].thresholdLiteral` | 精确有符号十进制字符串加单位；作者规定门槛，不假定度量来源、样本窗口、置信与实现已满足 | `NeedsMeasurementAuthority`、`NeedsUnitInterpretation` |
| `security:policy.rules` | 规则有主体、动作、资源、签发者、作用域；显式例外走 `exceptionRefs`，优先级只在 `combining=explicit-priority` 下有意义 | `NeedsPolicyAuthority`、`NeedsPolicyOverlap` |
| `product:component.parameters` + `product:system.components[].argumentBindings` | 先声明有身份的参数槽、名义合同、模式与基数，再由实例绑定有类型Definition；不得将实例表达式当作业务参数默认 | `NeedsComponentRefinement` |
| `effect:port`、`observation:contract` | 所需的外部操作与读回/事实完整性分别声明；无Grant不可执行；无观察证据不可签发作用已发生 | `NeedsProviderGrant`、`NeedsObserver` |
| `ui:view`、`product:system`、`product:deployment` | 交互、系统构成、目标宿主和部署约束各有不同使用点；存在声明不等于已经部署，UI `label` 不替代无障碍资格 | `NeedsTargetCapability`、`NeedsA11yEvidence` |
| `intent:goal/1`、`req:composite/1`、Pattern与PatternUse | 继续由各自旧Owner定义六模态、八Term、角色基数、要求联合；`/2`业务结构不得另造不相容的Goal解释 | `NeedsRequirementInterpreter` |

`resource:model` 的`capacity`和`capacityLiteral`、质量Term的`threshold`和`thresholdLiteral`、组件使用的`arguments`和`argumentBindings`是**互斥的候选书写入口**：各位置必须恰有一种，不得两种同时出现或全部缺失。`StateTransition.guard`与`conditionRef`最多选一种；没写条件只表示该声明不提供附加守卫，不表示从业务数据推定某个默认条件。计算是同一模块语言的可选构造：只有实际采用计算体的Definition才需要满足Expr/Type/Effect的专业合同；非计算业务定义不因为处于同一模块就被要求填写空计算式。

`BusinessQuantity`只定义精确字面量的**编码和单位引用**，不会计算加法、汇率、舍入、库存或测量结果。它禁止非标准数、负容量、`NaN`、无单位、科学计数格式的隐式猜测。`32`个编辑槽与`32`个网络连接并非相同可交换单位；`1000`毫秒服务时延门槛只有在有合格测量范围和单位意义时才可参加比较。资源字面值等于作者声明的配置量，而非现场测得的可用量。

`product:component.parameters` 的每个槽有稳定 `name/contractRef/cardinality/mode` 和可选 `required`。实例`argumentBindings`按槽名映射真实Definition引用：未声明槽拒绝；声明必需槽不绑定拒绝；类型/角色需要精化但无见证时保留`NeedsComponentRefinement`。一个静态绑定有同名字符串，不证明其Method或Target可用。允许组件不声明参数；这样使用点也不能通过参数映射私自增设业务合同。

**业务分支而不是计算`if`**：候选`workflow:plan.steps[].kind=decision`必须写`routes[{whenRef,nextStep}]`和`onUnknown=wait/manual/reject`，可写`otherwise`作为所有候选条件已被有权解释且均不成立时的后继；其他步骤禁止冒用决策字段。每个`whenRef`必须可解析成布尔签名的领域谓词，且实际观察的证据未知或冲突时必须执行`onUnknown`而非误选`otherwise`。多条分支可能同真时，必须证明互斥或取得明确的合格冲突裁决；路由在静态层只绑定现有步骤，不能凭数组顺序把第一个分支当优先。业务流程的`completion`是可接受的完成路径标识，不代表每条路径均已运行，也不等于六模态Goal的成功保证。回环或缺少进展证据时需单独检查可终止性、公平与恢复条件；这与实现计算循环是两种不同职责。

`security:policy` 选择 `explicit-priority` 时每条规则必须声明 `priority`；其他合并方式不得混入该字段。两条规则可能覆盖同一主体/动作/资源，而来源权威和条件互相矛盾时，不能只按数组顺序或数字较大自动判定；需要已资格化重叠判断、例外适用和外部政策层次。`exceptionRefs`表达需解释的例外条件或授权，不能由作者作为通用免除法定义务的开关；政策许可与真实执行 `Grant`继续严格分离。

### J. 正式的作者输入闭合条件与跨业务组合顺序

以一个**指定 `targetKey`、有权接受的源修订和已选择根**为单位检查完备性，而不是对全世界未来行业声称一次性全知。设已接受的独立决定集合为 `A`，本次可读且被选择的作者定义/引用闭包为 `C`：每个 `a∈A` 必须保存在 `C` 的有权源码中，或明确引用可信且锁定的供应；若没有相应合法Body，只能保留 `NeedsQualifiedDialect(a)`，不能默默删掉或以空合同冒充。这是**信息保存义务**，不是任意业务自动可实现性定理。

按以下顺序形成设计级结果，四种不同失败不得合并：

1. **书写**：严格读取有权限的工程源、明确SourceScope、Project和模块Profile，拒绝重复键、逃逸路径、未知Body、双字段权威以及不支持的版本。
2. **身份及可见性**：区分文件位置、模块/Definition、公开导出、业务对象、Occurrence和SourceRevision；检查别名、跨模块接口、范围与锁；不能从资源/供应名字推断资格。
3. **领域权威**：解释单位、名义实体、观察完整性、业务条件和主体的签发者；未知/冲突事实继续保留四态证据，不能变成普通 `false`。
4. **行为与规范**：把状态、事件、工作流、政策与六模态及八Term的条件/例外/时间组合，形成带来源的联合业务义务，禁止覆盖硬目标、合并不同主体或擅自替换量词域。
5. **系统组合**：在选定产品根的每次实例化中检查组件提供/需求、显式端口连接、资源共享和版本兼容；跨组件局部相容不能冒充全局相容。
6. **交接**：仅把完成解释的义务和明确未决项传给Method/Target；没供应是`NoQualifiedMethod`，已证明不满足是`Unsat`，预算不足是`SearchIncomplete`，没有领域解释是`NeedsMeaning`。任何一项均不得伪写合格`ArtifactSet`。
7. **修改**：根/导出、域解释、单位、政策、观察来源、约束或组件参数变更后，按实际正负读取和证明依赖撤销相交资格；不能重发已派发的真实操作。

**最小审查门槛**：对每项作者决定能说明(1)谁有权作决定、(2)哪处源码保存、(3)什么时候/哪里/对谁成立、(4)由谁真正解释、(5)如何与另一项要求组合、(6)没有解释或发生冲突怎样失败、(7)改动影响谁。只有“名称出现”或者“索引有一行”不满足这些问题。45家族/135侧面是不断扩展的**差异覆盖检查**，不是公开语言的封闭关键字集合。

### K. 不需要先实施通用计算编译器，但不能跳过的设计反例

- **转移条件**：`Saving + SaveSucceeded → Clean`若未绑定实际写入对应修订的观察，可能将旧版本成功通知当成本次保存成功；需要引用的条件Meaning和时序范围，而非编译器编造布尔守卫。
- **工作流结束**：`SaveWorkflow`到达`verify`步骤只能证明流程到达该节点，尚需持久化确认、完整Observer和规定时窗才能证明用户目标实现。
- **多主体权限**：有`security:policy`授权某用户操作的规则，不自动成为有权外部Provider的运行Grant；外部政策例外没有签发权时不得由本地JSON覆盖。
- **资源联合**：组件声明32个槽不证明并发使用32个独立容量，也不能两次引用`EditorCapacity`后把同一共享池算成64；须按物理身份和全局资源域联合。
- **组合参数**：相同参数名`capacity`绑定两个不同名义资源时不可隐式调换；缺精化见证拒绝，不用`argumentBindings`名字猜类型。
- **证据边界**：`observation:contract.completeness=bounded`定义的是所要求的覆盖口径，不证明当前Provider给出了覆盖证明；没有读回不能把超时当作未发生。
- **模式提取**：抽象共享“预留”模式时不得省略临床审批、支付清算或IDE文件修订各自特有的权威和成功标准。
- **非计算出口**：专业Method可以由受资格的Rust/TS/SQL供应者实现；业务作者在本阶段不因要求系统可实现就被迫设计递归、表达式解释器或运算器。

<a id="gift135-proposal-not-product"></a>

**本阶段已定型的边界**：新增候选字段、类型与静态拒绝规则可以设计并通过结构验证；真实领域解释、规范优先关系、Method搜索、Target生成和外部Effect的产品资格仍未取得。这个限制不妨碍完成作者源的正确设计，但也不能把设计上的未知隐藏成完整实现。

## 3. 有限的公共数据类型：19种构造与必要差异

所有定义内嵌的 `Type` 均使用有 `tag` 的有限和类型，**不是以任意字符串假装类型**。Schema当前提供19个Tag：

| Tag | 计算或数据含义 | 严格规则与常见拒绝 |
|---|---|---|
| `scalar` | `unit/never/bool/int/uint/decimal/float/text/bytes/timestamp/duration` | 整数有精度/溢出策略；decimal有scale和舍入合同；float明确NaN、舍入和误差；文本索引单位、时间时区/时钟不暗自混用。校验器无Profile时不得猜测平台数值行为 |
| `nominal` | 有独立身份与公开声明来源的类型引用 | 同结构不等于同名义身份；TypeArgs数目/约束/variance由定义签名判定 |
| `param` | 泛型的有界类型参数引用 | 必须绑定当前声明的TypeParam，满足其约束；无界悬空参数拒绝 |
| `opaque` | 公开接口存在、内部表示不可直接读取的抽象类型 | 必须有已资格化的实现/接口供给，不能泄漏或假定内部布局 |
| `record` | 键到类型的封闭或显式开放记录 | 字段必填、可选、可变性、缺席与null区别；额外键仅获开放资格时接受 |
| `variant` | 有标记的和类型 | 分支标记、类型和模式覆盖；不可把未知分支静默当默认成功 |
| `tuple` | 固定位置积类型 | 位置有序，长度、类型检查；不自动等价于集合 |
| `option` | `None/Some` 的可选类型 | 缺席不等于未知事实或非法读取 |
| `result` | 结果与显式错误类型 | 错误分支必须保持，不能丢弃或转换为成功 |
| `sequence` | 保留顺序和重复的有限序列 | 顺序与索引单位受类型约束 |
| `set` | 不计重数集合 | 元素等价关系必须合格；没有等价定义不能生成去重代码 |
| `bag` | 计数重数集合 | 多重性保持，不能按set去重 |
| `map` | 有键等价的映射 | 键等价/哈希或比较逻辑受资格约束 |
| `function` | 参数、结果、效果集合及调用合同 | 对参数/返回类型、可调用权、错误、效果、借用寿命单独检查 |
| `handle` | 资源能力句柄 | owned/borrowed/shared/managed 不能无条件互转；重复释放和寿命越界禁止 |
| `future` | 未完成的异步结果 | 完成、失败、取消与悬空任务分别解释 |
| `stream` | 长时序列与交付顺序 | 数据完整性、事件时间、背压、结束/重试由消费者负责 |
| `quantity` | 值与单位 | 不同量纲不可无证转换；单位换算需精度/来源合同 |
| `refinement` | 基础类型加谓词限制 | 未取得证明时保持运行检查或Needs，绝不静默剥掉精化 |

**精确常量Codec**：任意精度整数采用十进制字符串（不得依赖JSON数字的53位精度），固定宽度整数也需范围检查；布尔为JSON布尔；文本为Unicode字符串且默认不做未经声明的规范化；十进制为显式scale的十进制字符串；浮点采用所选Profile声明的精确位形/舍入/NaN策略；bytes使用带明确编码的封装；时间戳绑定UTC instant与外部时区规则、duration定义时钟单位。JSON Schema只限制载荷形状，不承担跨类型值校验；严格Reader要根据`Expr.literal.type`采用准确Codec并拒绝值类型不符。提案范本把无界 `int` 常量写为字符串，防止宿主语言数值精度反转语义。

**类型判断** `Γ; Δ ⊢ e : T ! ε`：Γ为局部词法环境，Δ为精确锁定的全局Definition/接口环境，ε为非纯效果集合。所有自由引用要被一个且仅一个合法绑定解释；类型等价/精化有各自判定，不用“字符串相等”或无边界强制类型转换蒙混。不可判定的子类型证明可留下带合法动态检查的义务，或按要求返回Need；不能为了通过代码生成丢掉前提。

## 4. 有限的一般计算：17种表达式构造

`Expr.op` 的17种构造：`literal`（带类型值）、`var`（局部名字）、`symbol`（稳定全局引用）、`let`（局部绑定）、`if`（分支）、`match`（和类型分解）、`lambda`（闭包）、`call`（函数调用/递归）、`record`、`field`、`variant`、`sequence`（有限值序列）、`do`（顺序效果）、`perform`（明确效果端口调用）、`await`（异步）、`throw`、`try`（错误恢复）。局部数值/字符串等库操作以**有类型的符号调用**表示，不能因为库名叫`add`就省略类型/溢出/单位规则。递归通过可引用的已声明函数、函数应用和分支实现；部分函数可不终止，`termination=total`必须有独立的证明/受限检查，不能由字段文字授权。

基本演算契约：

```text
Γ(x)=T                               ── Γ;Δ ⊢ var(x):T ! ∅
Γ;Δ ⊢ c:Bool ! εc ; e1:T ! ε1 ; e2:T ! ε2
                                      ── Γ;Δ ⊢ if(c,e1,e2):T ! (εc∪ε1∪ε2)
Δ(f)= (T1…Tn)->U ! εf ; Γ;Δ⊢ ai:Ti ! εi
                                      ── Γ;Δ ⊢ call(f,a1…an):U ! (εf ∪ ⋃εi)
Δ(p.op)= (T1…Tn)->Result<U,E> ! εp ; Grant(p.op) valid only at runtime
                                      ── Γ;Δ ⊢ perform(p,op,args):Result<U,E> ! (εp∪⋃εi)
```

`if`要求纯计算布尔条件；`TruthEvidence(T/F/BOTH/NEITHER)`来自另一个有权观察/逻辑Profile，**不得隐式转换为Bool**。`match`对封闭和类型必须覆盖当前所有构造，未知构造的开放版本须显式拒绝或建立兼容分支。`do`的顺序不能通过纯优化重排具有依赖/效果的步骤。`perform`只是表达**将来可能需要真实作用**，编译阶段没有`Grant`不会派发外部操作；在目标代码中保留独立授权和恢复边界。

通用计算表达的理论论证：在无界理想内存、自然数与分支/递归可用且求值语义正确时，表示通用寄存器机的配置和步进即可构造图灵完备表达；这是**语言设计的待形式化构造证明**，不是生产Reader、类型检查器及TypeScript后端的实测证明。若作者需要新算法，既可编写此Profile的函数体，也可使用有明确ABI、效果和源码所有权的TS/Rust等原生方法。一个高层业务意图不应被强迫还原为计算函数。

## 5. Definition的机器Body与语义Owner不是两份枚举

原先“23类领域定义”是已被唯一作者Schema扩展后的历史计数，不再保留一份会与当前27 Kind逐渐漂移的平行表。每一种 Kind 的当前 Body 结构由机器Schema的 `Definition.oneOf` 唯一拥有；业务意义与拒绝由[统一的Definition专业归属](#business-kind-consumer-coverage)明确，Type/Expr细节由前两节负责。不同Kind可以共用Type/Role/Occurrence等协议，但其真实Owner不得被跨域“综合”章节复制替代。

### 5.1 各类跨域合同不能相互代签

- `core:type`/`data:model`：前者规定值类型，后者规定持久身份、键、事务和迁移；类型构造本身不创建数据库。
- `core:function`/`domain:meaning`：前者是一段计算行为，后者约束领域概念的解释及真实观察；两者可以通过Method精化关联，但同名不等价。
- `core:interface`/`api:protocol`/`effect:port`：本地可调用签名、跨边界通信协议、真实外部效果分别检查ABI/消息语义/Grant及结算。
- `state:machine`/`workflow:plan`：前者描述状态与事件转移，后者描述长期工作、失败恢复及补偿；可以共享状态但没有一对一对应。
- `event:stream`/`data:query`：事件流可触发增量查询，查询的时刻/快照、重复和延迟必须另外规定。
- `resource:model`/`concurrency:contract`：容量是否够和并发操作能否原子维护该容量是两个独立问题。
- `ui:view`/`product:component`/`product:system`：UI语义可以作为组件提供的一种能力，产品根决定是否采纳；不应强制所有系统都有UI。
- `security:policy`/`effect:port`：规范许可不同于实际Grant，接口可表示也不同于Provider当前可用。
- `quality:contract`/`observation:contract`：性能/正确性目标要经已定义测量者与观察范围判断，不可只读生成代码次数。

## 6. 查询、状态、UI和协议的组合规则

### 6.1 查询与集合语义

`QueryTerm` 当前9构造：`scan/filter/project/join/group/union/sort/limit/fixpoint`。每一步必须在合格快照和输入模式上取得结果类型与多重性：`scan`保留源的bag/set语义；`join`显式内/外/半/反连接及缺值；`group`在明确聚合器及单位下返回结果；`union`的`distinct`明确是否去重；`sort`需可比较且可复现的排序键；`limit`若要求确定页面，必须显式锁定总序/快照；`fixpoint`需要单调性、有限域或明确收敛/预算保证。缺消费者时保留抽象查询而不伪造SQL。

### 6.2 状态机与事件

机器的状态名、事件名、初态、转移端点和政策首先要静态一致。若同一状态/事件可能有多个转移，必须证明guard互斥或明确优先规则，否则拒绝。每条转移的guard对哪个快照评估、读写何种资源、如何绑定实体身份、如何处理异常和并发，由其已锁定契约规定。`event:stream`的投递次数、顺序、回放和迟到条件必须成为状态消费者的显式前提；没有真实的原子持久化+幂等资格，不得承诺跨分布式端到端恰好一次效果。

### 6.3 过程和外部作用

工作流由entry及显式后继移动局部控制令牌；`needs`只核当前因果环境中已成功前驱，不能作为拓扑执行或隐式并发的依据。子流程、有限parallel、自然循环epoch和返回类型依[工作流Owner](../交付语义/工作流执行关系与激活.md#控制令牌循环与子流程的作用域)；结构合法不证明终止，有限迭代、收敛或活性保证仍按具体进展合同取得。`retry`要求有稳定Operation身份、结算未知状态处理和按Provider范围的幂等期限；`compensate`是新的业务操作，不能假定撤销已经不可逆的外部效果。前端只记录所需效果、错误与限制；真实执行必须通过Grant/Operation/Attempt/Settlement/Readback。

### 6.4 UI和接口

UI作者规定交互角色、数据绑定、命令入口、无障碍和必要布局限制，不规定Target内部组件类名。UI动作的actionRef引用有业务含义的domain:meaning，经组件activationRoutes进入已绑定Workflow，再由明确effect步骤调用effect:port；按钮不能直接引用端口并绕过类型与权限路由；未安装渲染目标时返回NeedsTarget，不能降成空点击处理器。通信接口必须保留错误通道、取消、超时、幂等、连接寿命和ABI/序列化版本。任何“自动选择框架”的优化仅能在保留这些可观察合同的候选之间发生。

## 7. 编译器实际如何消费这些源码（沿用原阶段，不新增流水线）

```text
项目清单、作者 /1 与提案 /2 模块、原生源码、资产
 -> 严格JSON/Profile读取及冻结原字节 + SourceSpan/Writer/CAS
 -> ModuleUse/Import/Export/根集合解析、版本及SourceProfile锁定
 -> 词法/名义类型/数值/效果/资源与扩展方言合法性
 -> Meaning/Fact/Norm/Time解释与Pattern实例化
 -> 把所有已选根的硬软义务、共享状态/资源/版本联合
 -> Method供应发现 -> 真实合同精化 -> 合格全局实现计划
 -> 按TargetProfile把每个受支持操作全部合法Lower
 -> 完整目标AST、依赖/版本/迁移/配置/源码归属/SourceMap/ArtifactSet
 -> 构建与独立行为资格；若要求实际作用，另行Grant/运行/结算/读回/恢复
```

每个阶段输出有类型的结果 `Ready(value, footprint, qualification)` / `Needs(missing,scope)` / `Invalid(diagnostics)` / `Conflict(witness)` / `SearchIncomplete(budget, frontier)` / `Unsat(proofScope)`。仅`Ready`可被下一阶段当作该阶段完整前提；`Needs`不得取默认true、unknown不得被当false、目标拒绝不得通过stub自动补洞。非决定性的供应/现实观察须记录实际快照、解释版本、ReadSet和负依赖；变动后只沿真实影响边失效，但变更范围不可证明时保守失效。

### 7.1 各输出的类型化交接（编译器施工约束）

| 输出 | 必须记录 | 下游不能假定 |
|---|---|---|
| `FrozenAuthorProject` | ProjectRevision、ModuleUseGraph、Profile版本、准确作者区域及字节来源 | JSON Schema PASS等于Meaning有效 |
| `TypedDefinitionGraph` | 定义ID/Kind/Type/Effect/Import/权限/扩展解释资格 | 类型匹配意味着外部供应存在 |
| `SelectedRootSet` | 每个RootOccurrence、可达定义、正负引用读集 | 所有未选Goal自动成为硬要求 |
| `JointRequirementSet` | Goal模态、角色、量化域、时间/Norm/资源、事实完整性和冲突来源 | 两两可行等于全局可行 |
| `QualifiedRealizationPlan` | MethodSpec真实实现、精化证明范围、Target/环境/依赖资格 | Manifest命中已构成绑定 |
| `ArtifactSet` | 完整成员根、可构建目标代码、依赖/ABI/迁移、SourceMap及无未降低节点证明 | 可构建=真实业务效果正确 |
| `Claim/Evidence` | 证据独立性、对象范围、版本、观察/测量条件及失效 | 任何一个PASS覆盖整个产品 |

### 7.2 Source → Target的职责切分与性能

Rust负责严格输入、SourceSnapshot、类型/语义、联合资格与核心确定性变换；TypeScript是首个业务Target及开发者原生输入之一，使用真正的TS编译器/标准库处理对应实现，不要求Gift再编写一门取代成熟TS的运行时。对于计算DSL可先从已证明可降低的纯计算、状态机子集生成TS函数/类型，复杂外部效果走合格Method/Port。不得把生产应用固定成“每个Goal一个函数、每个Kind一个文件”或永远在线的解释器壳。具体发射布局由TargetProfile和优化目标决定，保留可维护模块、增量修改及源码映射。

`O(V+E)`只适用于有限**引用图遍历**，不包括语义求解、方法搜索及Target构建。编译确定性以被冻结的供应、工具链版本、环境、优化参数及稳定顺序为前提；无法固定的外部来源不得污染可复现承诺。开放扩展或无限递归/复杂量词不可被统一算法保证有限时间、低成本或最优合成；必须有预算、局部可判定域及准确后继状态。

## 8. 提案与旧Profile、原生源码、Control的兼容

- **`gift.author-module/1`不变**：既有四种Definition、`intent:goal`六模态、`req:composite`八构造继续按原解释；新提案不得改旧字段的含义。真正迁移要同时提供旧解释映像、内容保全、双向适配证明及旧消费者退出计划。
- **`gift.author-module/2`是候选，不是升级通知**：只在明确选择新Reader且提供合格Dialect供应时使用。`gift.project/1`已有模块路径映射可定位候选模块，但发布过的Reader不自动支持新文件。两代模块并存的共同根联合需要真正的跨代Resolver。
- **作者原生源码可直接提供计算或专业实现**：如TS/Rust库、SQL和FFI，持久归属于有权SourceRegion；Gift记录真实ABI/类型/效果/依赖与Method资格，不应在没有理由时将原生实现抄回另一份JSON函数体。
- **Controls选择实现策略而不改变意义**：Target/Method/存储引擎/缓存/编译预算等可受控；作者的硬业务Requirement不得被优化器悄悄降级。
- **Runtime Input/Secret/Grant/Observation**不得因需要生成软件就写成作者长期语义常量。密钥引用需在运行时合法解析；文件存在不意味可以读取或部署。
- **测试、文档索引与生成源码**不得升级为第二作者真源。代码工具对该源仅拥有其有权的特定WriteRegion及CAS许可。

## 9. 反例、诊断及可恢复条件

| 输入/状态 | 正确后继 |
|---|---|
| 重复JSON键、非法数值、未知已发布Kind | `INVALID_SOURCE`，原字节保留，不产生语义结果 |
| 新 `/2`模块交给旧 `/1`Reader | `UNSUPPORTED_AUTHOR_PROFILE`，不能忽略该模块后成功 |
| 私有导出、悬空本地Ref、未声明导入别名 | `INVALID_BINDING`，精确发生位置诊断 |
| 有类型函数返回值不符、未声明外部效果 | `TYPE_OR_EFFECT_ERROR`，不能生成目标函数 |
| Pattern量化域未闭合、未知Meaning或四态冲突 | `NEEDS_MEANING/NEEDS_OBSERVATION/CONFLICT`，不得改成false |
| 状态转移目标不存在、重复触发而无互斥判断 | `INVALID_STATE_MODEL`或 `NEEDS_GUARD_DISJOINTNESS` |
| 无稳定排序的限制分页、无单调性证明的递归查询 | `NEEDS_QUERY_SEMANTICS`，不能伪造一致输出 |
| 并发容量局部可行但联合超额 | `UNSAT`或带联合反例的`CONFLICT` |
| Method可被发现但不满足资源、时序或异常保持 | `NO_QUALIFIED_METHOD`，不是 `UNSAT` 的证明 |
| 搜索预算用尽 | `SEARCH_INCOMPLETE`，不假报不存在实现 |
| 目标仍有未知操作、ABI/依赖不全、输出Stub | `TARGET_INCOMPLETE`，无合格完整ArtifactSet |
| 编译成功后Provider调用超时 | `OPERATION_UNKNOWN`，按Operation身份对账，不重放造成多次外部作用 |
| 作者或锁/事实/方法/环境变化 | 按有类型正负依赖撤回旧资格、重新读取/求解/构建；旧真实作用独立处理 |

## 10. 什么证据才允许说“开发端基础充分”

**本文件与两份提案 Schema** 可以在设计层认定有限种类和结构字段已经明确；**参考检查器**可以认定某有限模块、引用、状态机或函数的本地结构规则通过。两者都无法证明全套消费者存在、更不能证明全世界业务目标都可自动合成。

可签发`LANGUAGE_EXPRESSIVE_FOR_PROFILE`需要：指定计算/数据/效果子集有定义的语义、经检查的函数及递归编码、公开类型与资源模型、开放Definition的版本及组合规则，并给出构造证明或合格原生语言保留证据。可签发`DEVELOPER_SOURCE_COVERAGE`需要20类开发者决定各有合法SourceProfile和编辑所有权（缺Target消费者可单独列出）；可签发`IDE_TARGET_QUALIFIED`必须已有完整类型/状态/UI/协议/Method供应、跨域联合、真实TS/Electron/Web目标、构建行为验证和独立质量保证。三者不可互相代签。

**产品未关闭**：R01真实多Profile Reader/Resolver，R02–R05领域Meaning/Norm/时间/事实解释，R06全局求解，R07 Method资格，R08完整Target，R09运行恢复，R10增量兼容，R11独立验证，R12完整开发者流程仍需要真正实现和测试。本轮仅固定可实施的提案设计和有限样例，不改变其产品完成状态。

**示范工程**：[`fixtures/developer-foundation/Gift133/README.md`](../../../fixtures/developer-foundation/Gift133/README.md)说明一份可检验的实际项目结构，包含23类定义的结构实例、旧 `/1` 独立模块、TypeScript作者区域与真实被选系统根；它故意保留未安装Meaning/Target供给的Needs，以检验不能把结构完整冒充产品完整。

## 11. 实现端与可核验的施工边界

[《29 开发者基础定义的前端、解释、方法资格与完整目标施工合同》](../../70-工程系统与演进/工程构造手册/29-开发者基础定义-确定性前端与目标闭包.md#gift133-front-end-implementation-contract)将本页的语义合同落实为可编码的读取顺序、Rust数据类型草案、23Kind消费/降低资格以及拒绝/恢复路径。该施工文档只拥有实现分工，不取代本页定义或已存在的 `/1`解释。

## 12. 基础表达能力的构造性充分条件与反例

在**明确限定的计算子域**，可以用对程序结构归纳的方式建立一个可复验的表达覆盖证明。令源语言子集包含：有限或递归定义的积/和类型、基础值、有类型变量/绑定、函数与函数应用、布尔分支、模式匹配、一般递归、显式错误及经授权的有类型效果端口。其每个构造分别映射到本Profile的 `record/variant/scalar/nominal/param/opaque`、`var/let/lambda/call/if/match`、`core:function`递归引用、`result/throw/try`、`effect:port/perform/await`。若这些构造的实际解释满足各自归纳语义，且基础自然数/布尔及递归正确，便能以明确的函数表示通用寄存器机的配置与迁移；在理想无界资源下可表达所有部分可计算函数。**这只是条件性的构造论证计划，不是当前某Rust/TS消费者的已验证形式化证明。**

归纳保持的关键义务包括：语法绑定不捕获变量、类型替换有效、`match`分支完整、定义调用的错误与非终止保持、数值/文本编码无损、效果顺序/授权/异常不被优化重排、外部Port有相同可观察的宿主语义。上述任一条件未落实，不能仅凭Schema Tag集合签发“计算完备”。

同一证明**不推出**`achieve/oblige/permit`拥有真实世界意义，不推出SQL/设备/插件/医学领域中的事实来源，也不推出自动程序合成总是可判定。两个程序完全可能在同一Type签名下具有不同的持久化和并发行为；一个不存在的Provider不能被图灵完备性制造出来；互相矛盾的硬要求不会因为更强的表达能力而变为可满足。故能力完成率必须分别记录“表达覆盖、实际解释、实现可得、目标已生成、独立保证”，绝不生成一个宣称万能的总PASS。
