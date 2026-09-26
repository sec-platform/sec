# 六工具及可协商扩展

六个顶层工具保持；候选变更、运行、调试、进程交互与作者辅助分别写明字段及失败边界。

[返回上层](../README.md)

## 建议从这里进入

[六工具与请求](六工具与请求.md) → [候选修改与批量](候选修改与批量.md) → [构建运行接口](构建运行接口.md) → [客户端与并行会话](客户端与并行会话.md)

## 本主题正文

| 文件 | 内容定位 |
|---|---|
| [交互调试接口](交互调试接口.md) | 有限交互调试：sec.debug-session/1 |
| [交互进程接口](交互进程接口.md) | 进程输入与终端尺寸：sec.process-session/2 |
| [作者辅助接口](作者辅助接口.md) | 可选作者辅助：定位、补全与有基础的编辑建议 |
| [候选修改与批量](候选修改与批量.md) | 语义增量、临时身份与前提；基础视图与陈旧变化的处理 |
| [六工具与请求](六工具与请求.md) | 同一工具合同连接需求计划与简洁作者；同一六工具消费跨软件需求，不增加用户操作语言 |
| [客户端与并行会话](客户端与并行会话.md) | 客户端适配不复制领域规则；远程、事件与重连 |
| [构建运行接口](构建运行接口.md) | 计算构建、运行与定点观察的可选操作扩展；从候选直接运行的有限扩展 |

## 机器协议与人类投影的共同边界

CLI、Agent、IDE、脚本与未来 UI 都只消费同一领域结果；传输和展示不能建立第二事实源、第二决策器或第二权限根。接口层的基本约束是：

```text
InterfaceResult = Project(CanonicalResult, visibility, purpose, detailLevel)
DisclosedClaims(InterfaceResult) ⊆ SupportedClaims(CanonicalResult, visibility)
RequiredFacts(purpose, visibility) ⊆ DisclosedFacts(InterfaceResult)
AdmissibleEffects ⊆ AuthorizedEffects(CurrentGrant, OperationScope) ∩ SupportedEffects(ProviderCapability)
```

投影是有损表示，不能要求摘要与完整结果包含相同信息。当前采用的是**断言不放大、任务必要信息不遗漏、共同可见字段含义一致**：在相同主体、用途和可见范围内，machine/human对同一字段的解释一致；删去细节不能将partial变为complete、unknown变为false、存在阻塞变为无阻塞。不同用途或可见范围不要求内容相等，也不能通过隐藏对象的计数、身份或摘要泄露其存在。完整结果自身也只是有来源和范围的断言，不因为称为canonical就自动为真。

上述作用集合只表达必要上界，不替代前像、预算、围栏和其他真实准入条件。显示结果只携带权限相关事实或受保护引用，不签发新的Grant。实际执行和披露仍由原权限拥有者准入；内容签名、结果身份、终态标签和客户端类型都不扩大权限。人类摘要不是另一个业务状态机；机器消费者不能从显示文本、stderr或退出码反推领域事实。RequiredFacts是当前任务所需且允许披露的语义集合，不是新增作者必填字段；不能披露必要细节时，按泄露政策返回安全的受阻/不足结论，不伪造可继续的成功，也不泄露隐藏对象；正文太长时允许准确摘要加获准可读取的结果引用，但不能把会阻止下一动作的未知或阻塞藏到引用后面。

### 命令名称、长运行与可恢复执行

命令名描述调用者要取得的结果或作用，不复制内部模块树、临时实现者、工作流阶段或历史迁移名。仓库脚本采用有边界的 `domain:action` 层次即可表达分组；只有真实不同的用户目的或 Effect 才新增命令，不为同一动作的 quick/full、缓存命中、Provider 选择或内部 phase 复制第二套入口。`sec` 等品牌词只在需要区分实际产品/协议入口时出现，不能作为每个内部命令的装饰前缀。

一个逻辑命令可以跨多个内部阶段，但不得用长时间静默阻塞隐藏实际进展。会产生可感知等待的入口通过独立诊断通道报告稳定的 `command / phase / state / elapsed` 观测；阶段名是诊断地址，不成为业务状态或 ActionKey。大型结果优先写入显式 output/artifact 并在 stdout 返回有界投影，不能先无条件序列化完整内部模型再丢弃。

昂贵动作绑定 exact subject 与实际输入 identity。相同 subject、输入、工具/Provider 和环境已有 fresh terminal 结果时复用；执行中断后按原 operation/checkpoint/readback 恢复，不因客户端断线自动从头重跑。能够独立裁决的昂贵阶段应形成可复用结果或按 owner 定义的 shard/phase 执行；拆分不能改变总体 Claim、遗漏跨 shard 不变量或把 partial 写成 complete。命令本身没有可恢复边界时如实保留失败/未知，而不是靠扩大 timeout、重复启动或新增隐藏重试获得绿色结果。

### 什么时候才发布稳定 schema

| 使用边界 | 当前处理 |
|---|---|
| 同进程、单 producer、即时对象 | 使用现有类型/validator；不为未来假想消费者发布版本化 schema |
| 仅人读输出 | 不承诺脚本兼容；不能被机器 consumer 当协议解析 |
| 稳定 machine JSON／跨进程／仓外 consumer | 由内容 owner 命名 payload、strict parser、bounds、revision support window 与失败词汇 |
| 持久 journal／artifact／event stream | byte grammar、完整性、迁移、保留、readback 与 producer/consumer 均必须有唯一 owner |
| 内部 debug JSON | 明确 best-effort；不得冒充公共合同 |

稳定 machine contract 至少绑定 semantic identity、payload/schema identity、适用 subject revision、producer、consumer census、大小/深度/时间/并发界限、canonical encoding/integrity、authority ceiling、malformed/unsupported/stale/unavailable/unknown 失败以及支持/迁移/退役窗口。一个全局 `formatVersion` 不能同时替不同 payload 决定兼容；只有数字没有 reader 的版本没有产品意义。

### 传输状态不等于业务状态

接口必须保留三个独立问题，不能使用一个全局status枚举同时作答。下表是既有合同的责任分解，不另发布一套wire字段或强制每次返回三张表。

| 问题 | 真实拥有者与判据 | 不能由它推出的结论 |
|---|---|---|
| 本次调用和交付怎样结束 | entry/transport按协商协议解释响应、分片、截止、断线与接收完整性 | 响应已完整送达不证明业务成功；连接关闭不证明目标已停止 |
| 对准确主体取得什么结果 | application协调，compiler/assurance等领域owner给出结果、覆盖、诊断与当前资格 | `blocked/unresolved/failed/cancelled`是该操作合同下的业务结论，不是通用传输终态；结果形成不证明每个客户端已收到 |
| 已发生或可能发生的作用怎样结算 | execution及真实Provider按原operationRef维护提交、回读、恢复与残留 | 调用取消或业务失败不意味着无副作用；`residue`不能被“请求结束”清除 |

正常成功路径允许一次同步响应同时携带完整结果与所需结算事实，不强制新增查询或数据库。长期作用可以先返回接受及operationRef，再按原操作查询；accepted不冒充completed。纯查询取得请求的完整结果即可，没有外部作用时不制造空结算记录。部分结果可以独立有用，只有本任务所求覆盖和完成条件成立时才报告整体完成。HTTP 2xx、进程0、JSON-RPC响应、连接关闭或PR响应均只按各自合同解释。

machine stdout只承载命名结果或声明的record stream；日志和进度进入独立诊断通道。原完整结果身份、某可见投影的内容身份及本次传输字节身份分别绑定，不能要求JSON、文本摘要和分片封装具有相同digest。同一主体及可见范围的compact/full不得改变公共字段的状态、必要unknown和blocker含义；分页计数要标明当前页还是已确认完整范围。跨可见范围不承诺总计相同，不向客户端暴露无权读取的完整结果摘要。

大结果、流的完成屏障、游标、断线和重连由[客户端与并行会话](客户端与并行会话.md#远程事件与重连)拥有。保留原协商协议；旧客户端不能表达必要的partial/unknown/结算区别时拒绝该能力或返回明确不支持，不能静默映射为成功。秘密、源内容和Provider原始输出仍按当前披露边界处理。
