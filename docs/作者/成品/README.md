# 成品的作者源与完整消费合同

本目录展开原有16个家族的36个确定设计选择。先看你实际要交付的产品，再读其作者源、公开接口、完整规则和方法；不是只列标签，也不把所有产品都改成规范化函数。没有引入新的核心Form枚举或要求作者重复抄实现。

普通产品作者引用[完整定义库](../../../examples/开发成品/definitions.json)，只改参数或本产品差额；[完整作者入口](../../../examples/开发成品/README.md)逐项展示实际JSON。规范、静态类型和有限检查不等于已有运行产品。

| 原家族 | 完整规则 | 可直接取得的作者根 |
|---|---|---|
| 规格、策略与模型包 | [规格与静态资产](规格与静态资产.md) | [Definitions](../../../examples/开发成品/model/definitions.json) |
| 纯值、配置与资源 | [规格与静态资产](规格与静态资产.md) | [StaticValue](../../../examples/开发成品/model/staticvalue.json)、[Resources](../../../examples/开发成品/model/resources.json) |
| 表达式、函数与上下文补丁 | [片段与已有工程变化](片段与已有工程变化.md) | [Expression](../../../examples/开发成品/model/expression.json)、[ContextPatch](../../../examples/开发成品/model/contextpatch.json) |
| 库、SDK与客户端 | [库与协议客户端](库与协议客户端.md) | [Library](../../../examples/开发成品/model/library.json)、[SDK](../../../examples/开发成品/model/sdk.json)、[ProtocolClient](../../../examples/开发成品/model/protocolclient.json) |
| 命令与一次性批程序 | [命令与批处理程序](命令与批处理程序.md) | [Command](../../../examples/开发成品/model/command.json)、[BatchCommand](../../../examples/开发成品/model/batchcommand.json) |
| 请求处理器与长时服务 | [请求处理器与服务](请求处理器与服务.md) | [HttpHandler](../../../examples/开发成品/model/httphandler.json)、[Service](../../../examples/开发成品/model/service.json) |
| 工作器、组件与插件 | [工作器组件与插件](工作器组件与插件.md) | [Worker](../../../examples/开发成品/model/worker.json)、[Component](../../../examples/开发成品/model/component.json)、[Plugin](../../../examples/开发成品/model/plugin.json) |
| Web、桌面与移动应用 | [交互应用](交互应用.md) | [WebPanel](../../../examples/开发成品/model/webpanel.json)、[Desktop](../../../examples/开发成品/model/desktop.json)、[Mobile](../../../examples/开发成品/model/mobile.json) |
| 多应用与产品族 | [产品族与共同发行](产品族与共同发行.md) | [Family](../../../examples/开发成品/model/family.json) |
| 查询、批数据与持续流 | [查询批数据与持续流](查询批数据与持续流.md) | [Query](../../../examples/开发成品/model/query.json)、[BatchData](../../../examples/开发成品/model/batchdata.json)、[WindowStream](../../../examples/开发成品/model/windowstream.json) |
| 数据与配置迁移 | [数据与配置迁移](数据与配置迁移.md) | [Migration](../../../examples/开发成品/model/migration.json) |
| 编译、分析与生成工具 | [编译分析与生成工具](编译分析与生成工具.md) | [Compiler](../../../examples/开发成品/model/compiler.json)、[Analyzer](../../../examples/开发成品/model/analyzer.json)、[Generator](../../../examples/开发成品/model/generator.json) |
| 模型、概率与优化 | [模型概率与优化](模型概率与优化.md) | [Inference](../../../examples/开发成品/model/inference.json)、[Trainer](../../../examples/开发成品/model/trainer.json)、[Sampler](../../../examples/开发成品/model/sampler.json)、[Optimizer](../../../examples/开发成品/model/optimizer.json) |
| GPU、固件与实时目标 | [计算核固件与实时程序](计算核固件与实时程序.md) | [GpuKernel](../../../examples/开发成品/model/gpukernel.json)、[Firmware](../../../examples/开发成品/model/firmware.json)、[RealTime](../../../examples/开发成品/model/realtime.json) |
| 安装、发布与部署 | [安装与部署](安装与部署.md) | [Installer](../../../examples/开发成品/model/installer.json)、[Deployment](../../../examples/开发成品/model/deployment.json) |
| 现有工程的准确变化 | [片段与已有工程变化](片段与已有工程变化.md) | [NativeChange](../../../examples/开发成品/model/nativechange.json) |

[成品设计完整性合同](完整性合同.md)规定一个形态在设计层必须闭合的公共边界、状态、失败、资源、成员与验收；它不是作者必填表。

[共同数据、编码与完成判据](共同数据与完整性.md)不替代各形态的差异；[完整工作台交互](工作台交互与共同状态.md)继续细化原Studio，不能把一个面板当整个IDE。

[目标签名](../../../examples/开发成品/公开边界.d.ts)可以用于核对所选消费合同；它们不要求产品作者编写TS实现。 [供给与实际发射](../../编译/目标/成品消费合同与发射.md)规定原编译器怎样产生可用成员及处理缺项。

## 完整性边界

对这里的具体定义，标题、默认、输入、类型、状态、失败、恢复、成员与正常功能都有当前选择和准确依据。对新需求或新平台，必须继续完成相交合同，不凭这个目录宣称未来所有软件均已覆盖。对已选合同的真实供给、目标配置和运行验证，仍须实际实现取得；不存在的方法不得生成空主体或把原意图改成较弱要求。

[返回作者主题](../README.md)
