# 开发操作与客户端

说明怎样使用能力，而不替代作者成果。开发任务统一归入Understand / Author / Change / Verify / Operate / Deliver六面；工具协议、动作目录、开发用例、连续编辑、测试输入与AI协作分别是不同维度，按任务直接进入。开放目录的当前成员数由其canonical目录或生成投影派生，不写成架构常量。

[返回上层](../00-系统与原则/导航/主题导航.md)

## 建议从这里进入

[用途与任务范围](用途与任务范围.md) → [需求到交付主链](需求到交付主链.md) → [六工具与请求](工具协议/六工具与请求.md) → [测试发现与执行](测试发现与执行.md) → [编辑审查与客户端](客户端/README.md)

## 子主题

| 入口 | 责任 |
|---|---|
| [AI上下文与委派](AI协作/README.md) | 先取得需求和准确作者内容，再按任务读取相交依赖；模型输出不获得指令或权限地位。 |
| [导入观察与原生资产](原生维护/README.md) | 捕获原生源码/配置、提升可解释语义、保全未知区域；原生维护、抽象恢复与作者接管分别处理。 |
| [六工具及可协商扩展](工具协议/README.md) | 六个顶层工具保持；候选变更、运行、调试、进程交互与作者辅助分别写明字段及失败边界。 |

## 客户端具体呈现

[布局与交互](客户端/工作台布局与交互.md)规定人类工作台放置，[树形导航](客户端/树形导航与结构投影.md)规定准确结构如何展开、搜索、选择和刷新；[编辑与协作](客户端/编辑审查协作与大型视图.md)保留真实作者编辑及并发。界面内的同名概念仍按主体、修订和owner区分。

<a id="developer-concrete-implementation-entry"></a>
## 完整产品开发入口（实施设计，不是已安装工具）

先按[七种启动情形和可执行开发轨迹](需求到交付主链.md#developer-implementation-ready-operating-contract)选择**直接短源/已有原生源码/结构作者/运行输入/连续修改/多目标**；然后参照[CLI/SDK/AI同一六工具接口](客户端/开发面与智能投影.md#developer-headless-cli-one-protocol)、[工作台点击与错误显示](客户端/工作台布局与交互.md#developer-workbench-implementation-ready-map)、[用户真正要写的工程文件](../10-作者与输入/作者源/工程源/工程清单模块与绑定锁协议.md#developer-minimum-project-and-real-authoring-files)。本导航不取代六工具schema，也不把人类六任务说成六个强制阶段。

实施依[十Owner与第一条TS真实垂直切片](../70-工程系统与演进/实现与装配/源码分区与机器合同.md#developer-implementation-slice-and-layer-closure)和[Worker准确交接](../70-工程系统与演进/实现与装配/内核工作进程与交换协议.md#developer-request-worker-boundary-and-real-retry)，对照[36项验收输入](../60-保证与证据/验收/开发面符合性接缝.md#developer-implementation-ready-acceptance-matrix)。
