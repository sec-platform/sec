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
InterfaceResult = Project(CanonicalResult, audience, detailLevel)
Authority(InterfaceResult) <= Authority(CanonicalResult)
Meaning(machine) = Meaning(human) = Meaning(canonical)
```

投影可以隐藏无关细节，但不能改写 terminal、unknown、blocker、作用身份、必要 Evidence、权限上限或完整结果的身份。人类摘要不是把 machine JSON 改成另一个业务状态机；机器结果也不能从显示文本、stderr 或退出码反推领域事实。

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

机器通道至少区分 `completed | blocked | unresolved | failed | residue | cancelled` 这类传输可依赖终态：`completed` 仍要求请求规定的结果已按其 owner 读回；`residue` 表示已有或可能已有作用而终态尚未闭合，只能沿恢复合同继续。HTTP 2xx、进程 0、连接关闭、stdout 文本或 PR 响应都不能单独提升为完成。

machine stdout 只承载命名结果或声明的 record stream；日志和进度进入独立诊断通道。人类输出可以压缩、分组和解释，但同一 canonical result 的 digest/状态/unknown/blocker 数量不能因 compact/full 或分页而改变。大结果、流、游标、断线和重连继续由[客户端与并行会话](客户端与并行会话.md)拥有；秘密、源内容和 Provider 原始输出仍按任务披露边界处理。
