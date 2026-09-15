# 每种成品的完整意图作者源

本目录是当前设计中的36个完整作者入口、一个可复用定义库及它们的准确消费合同。JSON仍是原req:composite/use/require/exposes；没有新增文本编程语言，也不把产品算法改写成嵌套AST。

先打开你需要的`model/*.json`：通常只使用一条真实定义及必要的主体连接。需要改默认或独特需求时，沿definitions.json看它固定了什么，再到对应规范确认接口和边界。不能以这个目录中存在文件，推定已有生产编译器可以运行。

## 作者入口与独立选择

| 完整源 | 复用定义的公开参数（省略时的已定值） | 完整规则 |
|---|---|---|
| [Definitions](model/definitions.json) | `packageName:Text` = `"interval-policy"` | [Definitions：可复用要求与策略包](../../docs/作者/成品/规格与静态资产.md) |
| [StaticValue](model/staticvalue.json) | `title:Text` = `"Workspace"`；`historyLimit:Int` = `200` | [StaticValue：一个确定配置值，而非配置程序](../../docs/作者/成品/规格与静态资产.md) |
| [Resources](model/resources.json) | 无产品特有值参数；使用准确主体 | [Resources：有真实成员的资源包](../../docs/作者/成品/规格与静态资产.md) |
| [Expression](model/expression.json) | `factor:Int` = `2` | [Expression：精确计算片段](../../docs/作者/成品/片段与已有工程变化.md) |
| [ContextPatch](model/contextpatch.json) | `oldName:Text` = `"normalize"`；`newName:Text` = `"canonicalize"` | [ContextPatch：在一份准确基础上更改公开名称](../../docs/作者/成品/片段与已有工程变化.md) |
| [Library](model/library.json) | 无产品特有值参数；使用准确主体 | [Library：没有运行容器的同步库](../../docs/作者/成品/库与协议客户端.md) |
| [SDK](model/sdk.json) | `maxInFlight:Int` = `4` | [SDK：同一行为的显式资源会话](../../docs/作者/成品/库与协议客户端.md) |
| [ProtocolClient](model/protocolclient.json) | `requestTimeoutMs:Int` = `30000` | [ProtocolClient：公开网络语义不能藏在SDK实现里](../../docs/作者/成品/库与协议客户端.md) |
| [Command](model/command.json) | 无产品特有值参数；使用准确主体 | [Command：一个输入，一个完整结果](../../docs/作者/成品/命令与批处理程序.md) |
| [BatchCommand](model/batchcommand.json) | `maxInFlight:Int` = `4` | [BatchCommand：确定作业顺序与分项结果](../../docs/作者/成品/命令与批处理程序.md) |
| [HttpHandler](model/httphandler.json) | 无产品特有值参数；使用准确主体 | [HttpHandler：固定路由，不默认联网](../../docs/作者/成品/请求处理器与服务.md) |
| [Service](model/service.json) | `port:Int` = `0`；`maxInFlight:Int` = `4` | [Service：本地独立计算服务](../../docs/作者/成品/请求处理器与服务.md) |
| [Worker](model/worker.json) | `maxInFlight:Int` = `4` | [Worker：消息会话与结算](../../docs/作者/成品/工作器组件与插件.md) |
| [Component](model/component.json) | 无产品特有值参数；使用准确主体 | [Component：可嵌入的固定进口集合](../../docs/作者/成品/工作器组件与插件.md) |
| [Plugin](model/plugin.json) | 无产品特有值参数；使用准确主体 | [Plugin：加载、注册与卸载分开](../../docs/作者/成品/工作器组件与插件.md) |
| [WebPanel](model/webpanel.json) | `title:Text` = `"Interval Workbench"` | [WebPanel：纯离线页面](../../docs/作者/成品/交互应用.md) |
| [Desktop](model/desktop.json) | `title:Text` = `"Interval Workbench"` | [Desktop：有文件打开与保存的独立应用](../../docs/作者/成品/交互应用.md) |
| [Mobile](model/mobile.json) | `title:Text` = `"Interval Workbench"` | [Mobile：后台与现场状态不能照抄桌面](../../docs/作者/成品/交互应用.md) |
| [Family](model/family.json) | `title:Text` = `"Interval Suite"` | [作者的确切选择](../../docs/作者/成品/产品族与共同发行.md) |
| [Query](model/query.json) | `pageSize:Int` = `128` | [Query：固定快照上的按键最新值](../../docs/作者/成品/查询批数据与持续流.md) |
| [BatchData](model/batchdata.json) | `partitionCount:Int` = `1` | [BatchData：有清单的有限数据转换](../../docs/作者/成品/查询批数据与持续流.md) |
| [WindowStream](model/windowstream.json) | `windowMs:Int` = `1000` | [WindowStream：持续、可背压的精确事件时间聚合](../../docs/作者/成品/查询批数据与持续流.md) |
| [Migration](model/migration.json) | `batchSize:Int` = `256` | [作者意图、输入与后像](../../docs/作者/成品/数据与配置迁移.md) |
| [Compiler](model/compiler.json) | 无产品特有值参数；使用准确主体 | [Compiler：从规则到可调用程序](../../docs/作者/成品/编译分析与生成工具.md) |
| [Analyzer](model/analyzer.json) | 无产品特有值参数；使用准确主体 | [Analyzer：观察不偷改输入](../../docs/作者/成品/编译分析与生成工具.md) |
| [Generator](model/generator.json) | 无产品特有值参数；使用准确主体 | [Generator：从同一规则生成文档和数据](../../docs/作者/成品/编译分析与生成工具.md) |
| [Inference](model/inference.json) | `weights:ListInt` = `[2, -1]`；`bias:Int` = `0` | [Inference：精确线性评分组件](../../docs/作者/成品/模型概率与优化.md) |
| [Trainer](model/trainer.json) | `regularization:Int` = `1` | [Trainer：可复现的有限岭回归](../../docs/作者/成品/模型概率与优化.md) |
| [Sampler](model/sampler.json) | `numerator:Int` = `1`；`denominator:Int` = `2` | [Sampler：概率目标与随机源分别固定](../../docs/作者/成品/模型概率与优化.md) |
| [Optimizer](model/optimizer.json) | 无产品特有值参数；使用准确主体 | [Optimizer：有限候选域内真正的最佳值](../../docs/作者/成品/模型概率与优化.md) |
| [GpuKernel](model/gpukernel.json) | 无产品特有值参数；使用准确主体 | [GpuKernel：有检查边界的整数批计算](../../docs/作者/成品/计算核固件与实时程序.md) |
| [Firmware](model/firmware.json) | `lowMv:Int` = `1000`；`highMv:Int` = `1200` | [Firmware：有启动与失效状态的设备控制](../../docs/作者/成品/计算核固件与实时程序.md) |
| [RealTime](model/realtime.json) | `periodUs:Int` = `10000`；`deadlineUs:Int` = `10000`；`lowMv:Int` = `1000`；`highMv:Int` = `1200` | [RealTime：可调度边界是交付条件](../../docs/作者/成品/计算核固件与实时程序.md) |
| [Installer](model/installer.json) | `retainPrevious:Int` = `1` | [Installer：有归属的版本目录安装](../../docs/作者/成品/安装与部署.md) |
| [Deployment](model/deployment.json) | `replicas:Int` = `1` | [Deployment：一份实际服务及其运行环境](../../docs/作者/成品/安装与部署.md) |
| [NativeChange](model/nativechange.json) | `oldName:Text` = `"normalize"`；`newName:Text` = `"canonicalize"` | [NativeChange：交付一个原生工程的准确修改集](../../docs/作者/成品/片段与已有工程变化.md) |

每个根公开App，当前默认均可完成**作者字段绑定**。需要库级复用时引用definitions.json中同名定义并传入准确Product主体；其中规范化形式还传入同一Operation主体。Product是本例逻辑成品，不是一个通用Host或状态容器。Family对库、CLI和Web共享一个Operation，三者的Product不同。

## 字段、含义和真实实现

[contracts/spec.json](contracts/spec.json)由[共同合同](../../docs/作者/成品/共同数据与完整性.md)及各成品正文派生，持有准确source/section/sha256；不可独立编辑放宽条件。它列2种主体和37条有完整含义的Rule，不是全球业务原子表。Canonical直接承接原区间合同并固定MergeTouching；别的Rule精确限定消费行为。

[公开边界.d.ts](公开边界.d.ts)是目标消费者类型说明，名称空间仅分组不同产品，未实现任何产品。部分外部事实（实际设备、授权文件、依赖、目标工具）由调用或部署环境提供，不能在意图源中伪造。完整机制与实际生成位置见[发射合同](../../docs/编译/目标/成品消费合同与发射.md)。

[sec.project.json](sec.project.json)定位38模块和真实资源；[sec.lock.json](sec.lock.json)锁住实际取得的设计材料。targets仍为空，因为本例没有已取得的生产目标画像、后端或宿主；这不是取消产品要求，也不是声称源字段不完整。取得真实供给后才可以构造可生成绑定，不能填写一个不存在的profileRef假装可运行。

## 已经给出的第二次修改

[desktop.title.json](后继示例/desktop.title.json)只给当前桌面应用显式title；[windowstream.five-seconds.json](后继示例/windowstream.five-seconds.json)把窗口改为5000ms，影响窗口/检查点解释而不是网络权限；[family.title.json](后继示例/family.title.json)只把标题传给Web子成品，库/CLI接口和共同算法不变。后继不在当前modules和源范围中，不能把同ID的两个版本同时载入。

## 真实输入资产

[消息](assets/messages.json)、[样式](assets/theme.css)、[原生编辑fixture](fixture/README.md)、[规则输入](fixture/thresholds.json)、[测量输入](fixture/samples.json)均实际存在。fixture中的恒等函数不冒充规范化算法；它仅使NativeChange有准确的被改源。默认不会执行这些文件。

## 需要分别通过的接受判断

作者结构与合同可读只是第一步；实际成品还要具备对应方法、目标、全部成员、初始化/正常操作/错误/结束和所要求的证据。SDK不带服务，handler不冒领监听，移动端不假设后台永活，数据回滚不冒领代码回滚，硬实时不以平均性能代签。原意图由这些合同确定，供给缺失不应被退回为产品作者重写底层算法。

完整工作台不是本目录中的小Panel，另见[Studio](../结构化工作台/README.md)及其[交互与共同状态](../../docs/作者/成品/工作台交互与共同状态.md)。
