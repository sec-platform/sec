---
name: sec-external-capability-governance
description: 用于引入、升级、调用、替换或退役外部工具、Provider、MCP、CLI/API/SDK，或准备手写、扩写、修补通用解析器、算法、基础设施、wrapper/Adapter、安装/物化能力时，先比较原生、已有依赖和成熟实现，验证真实缺口、唯一 owner、最小 Effect 闭包和退役路径；不用于把外部输出或安装成功当作 SEC authority。
---

# sec-external-capability-governance

## 触发
- 新外部能力、Provider、CLI/API/SDK、wrapper/Adapter 或能力退役。
- 准备手写、扩写或修补通用解析器、编码器、算法、校验器、存储/网络/进程/测试基础设施，即使当前没有添加依赖的计划。
- 为采用已有工具准备下载、安装、解压、复制、缓存发行版或扫描无关安装树。
- executable、credential、endpoint、Effect、version 或 readback 边界发生变化。

## 不触发
- 当前 ledger 已批准、identity 未失效且 Effect 未扩大的普通直接调用。
- 只消费 canonical owner 已验证的 DTO/Evidence。

## 输入
- 真实 consumer、现有 owner、候选原生 machine interface 与无法复用的具体缺口。
- 当前 Effect、credential、cwd/env/executable、deadline、resource、readback 和 recovery 边界。
- `provisioning -> physical adoption -> semantic session -> operation`的实际 owner DAG。

## 前置门禁
- 先证明真实缺口、唯一 consumer/owner 和当前 Effect；禁止先实现再寻找用途。
- 新 Adapter 必须新增 protocol/platform/Effect/credential/version/Evidence/performance/compatibility/security 中至少一个真实边界。
- 在修改通用自研实现之前，按同一消费合同比较原生能力、已有依赖、维护中的专业实现和保留自研四条路径。复用既有、仍有效的判断，不因开始新会话而全仓重做调研。
- 继续自研须记录具体的语义、宿主、许可证、安全或实测成本差距；依赖少、代码已写很多、SEC特有的名称不能单独构成理由。应急修补须标明无法即时替换的原因及退出条件。

## 执行
1. 冻结当前 Effect 和 owner DAG；外部机制只提供 capability，不取得 SEC 语义 authority。
2. 只证明 Effect 窗口内可能漂移并决定结果的最小对象；无因果关系的安装树、catalog、cache 和历史状态排除。
3. 跨入新的 provisioning/installation/credential/cache/semantic/Effect owner 时停止当前实现，交由独立授权 work；不得用更小 artifact、cache 或 timeout 掩盖扩权。
4. 选择最窄稳定 machine interface；shell 只传 argv，显式绑定 executable、cwd、env、deadline、output 和 settlement。
5. 外部输出经 canonical validator/semantic owner 投影；退出码、Provider success 和 presentation 文本不能签发完成。
6. 迁移 consumer 后删除旧 wrapper、materializer、installer、cache、配置和文档；无真实 failover contract 不保留双实现。

## 完成证据
- reuse/interface decision、owner DAG、最小因果闭包、Effect/credential/readback/recovery 和资源上界。
- unavailable 路径证明零未授权 network/download/install/cache/spawn；旧 owner 达到 consumer-zero。
- 被保留的正确行为、强反例和历史数据/摘要兼容证据；被替换的具体实现与消费者清单；差分中的 old-only/both/new-only/unknown 均有归属。
- 推荐、已安装、已调用、已验证、已选择、已部署、产品支持分别记录；文档入库不改变 live Provider 或任务完成状态。

## 停止与恢复
- capability 不可证明或 unavailable 时保持 typed unknown/unsupported，不自动安装或切换第二 provider。
- 仅在扩张 owner 已删除或由独立授权 work 接管、旧旁路已退役后恢复。

## 禁止捷径
- 不建一对一镜像 wrapper，不解析 presentation 代替 JSON/porcelain/NUL/explicit format。
- 不因“证明更严格”拥有更多对象，不把完整安装或全树扫描当 adoption 前提。
- 不让工具权限、测试 seam 或 caller JSON 扩大 Effect authority。
- 不把 schema 校验当权限验证、超时当物理结束、原子 rename 当完整发布、哈希当执行证明、参考 fixture 当生产实现。
- 不一次安装候选清单，不以选型为由增加第二个调度、状态、schema 或完成权威。

## 采用权威与既有研究

采用规则由 [外部 Provider 政策](../../../docs/external-provider-policy.md) 拥有；实际采用状态仍只写现有 external capability ledger 和 live receipts，工作准入仍走现有开发治理。

[全域复用研究快照](../../../docs/archive/library-reuse/2026-09-07/README.md) 保存64项决策、15个源码域映射、源码身份、探针和实施入口。它是带时间和覆盖边界的历史研究，不是第二台账；只重开来源、consumer、版本或合同已变化的部分。没有精确版本、分发许可证、安全与SEC conformance的候选不得自动升级为已采用。
