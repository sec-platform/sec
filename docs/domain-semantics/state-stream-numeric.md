---
title: 状态、关系、流、事务与数值语义
status: stable
domain: domain-semantics
---

# 状态、关系、流、事务与数值语义

本文细化 [Portable Domain Semantics](../domain-semantics.md) 中不能由普通函数签名完整表达的领域机制。

## 1. 层级状态机

状态机定义分为 **model** 与 **instance**：模型保存状态层级、转移、guard/action/history规则；实例保存当前稳定配置、history、活动、计时器和输入队列。状态名不是运行实例 identity。

一次事件反应从稳定前态到稳定后态：

```text
capture event
→ determine enabled transition from current configuration
→ exit affected active states (inner → outer)
→ transition actions
→ enter target path (outer → inner)
→ enqueue defined completion events
→ continue internal macrosteps until stable
```

选择冲突必须由模型定义的层级/优先级规则确定，不能按容器枚举顺序。history 恢复结构位置，不恢复任意外部世界或已经发生的 Effect。

活动与状态分开：离开状态需要停止由该激活拥有的活动，但只有收到实际停止/结算依据才能释放资源；旧活动的迟到结果不得写入新激活。

计时器绑定单位、起点、时钟来源、暂停/恢复政策和 generation。模型升级后旧计时器不能仅凭状态名继续归属。

## 2. 关系与查询

关系语义先确定 collection kind：set、multiset 或 ordered sequence。join/group/distinct/aggregate/recursive query 的结果与重复、相等、null/optional、排序和错误策略随之确定。

**不存在匹配**与**缺失/unknown/error/null**不合并。外连接的“没有匹配”不自动等同 SQL NULL 的全部宿主语义。

快照查询必须绑定一个一致 source generation。分页 cursor 至少绑定：query identity、source snapshot、ordering/tie-break、position；source 变化后不能从“最新数据”继续旧 cursor。

增量维护以 state delta 为输入，而不是“看到某文件改了”作为语义：

```text
S' = apply(S, Δ)
Result' = maintain(Result, S, Δ)
```

join 同时更新两侧时必须包含旧×Δ、Δ×旧和Δ×Δ等真实交叉项；非线性 aggregate/distinct 维护自己的计数/辅助状态。无法安全局部维护时退回相交范围的正确重算，不返回近似旧结果。

递归关系的正单调子集可采用最小不动点；否定只有在已定义的可分层条件下进入精确画像。负循环、不完整删除算法或开放世界否定保持 unsupported/frontier。

## 3. 流、背压与事件时间

流的 source、element、subscription、consumer credit、source position、event time 与 processing time 分开。

默认背压可以用 demand/credit 表达：

```text
outstandingDemand >= 0
producer may emit only while credit exists
accepting one element consumes one credit
consumer completion/ack may replenish according to contract
```

不可暂停的源不能靠阻塞调用线程解决所有情况；必须选择 buffer/drop/backpressure-to-upstream/spill/reject 等明确策略，并把丢失/顺序/资源影响写进合同。

并行处理要区分**完成次序**与**公开输出次序**。有序输出需要 sequence position 和 reordering buffer；错误、watermark、End 也属于同一顺序域，不能越过更早未结算 element。

事件时间窗口使用明确的 interval 规则、时区/单位和负时间算法。Watermark/frontier 是关于“哪些更早事件不再可能合法到达”的保证，不能由本地 wall-clock 或静默超时制造。

Checkpoint 至少覆盖：source positions、窗口/算子状态、pending output、未确认交付和版本/模型 identity。恢复时不能把已经 sink-commit 但本地未记账的结果盲目重放；需要真实 ack/readback 或幂等协议。

## 4. 事务与外部交付

事务操作把纯业务决定与存储/外部 Effect 分开：

```text
capture snapshot + authority
→ evaluate preconditions and derive proposed state delta
→ validate invariants / conflicts
→ commit atomic local state transition
→ settle commit identity
→ perform or schedule external delivery under its own identity
→ readback / acknowledge / recover
```

提交成功不等于外部消息/支付/通知已经送达。Outbox、idempotency key 或 transactional messaging 只有在真实存储/服务支持时采用，不能用一个“exactly once”标签代替。

重试必须绑定同一 operation/effect identity；状态未知时先查回，不重新执行不可逆 Effect。

跨多个无法共同原子提交的系统时，SEC 保存准确的较弱保证（saga/compensation/forward recovery），不声称不存在的全局事务。

## 5. 自动微分与线性化

导数请求必须先确定数学对象：标量导数、Jacobian-vector product、vector-Jacobian product、gradient、Hessian/linearization 等。

Forward mode 随原值传播 tangent；Reverse mode 在 forward pass 保存必要 residual，随后逆序累计 cotangent。Residual 属于导数计算资源，不能因原函数已返回就提前释放。

分支只沿实际执行路径求导，但在不可微边界必须按合同返回 undefined/error/subgradient policy，不能自动取宿主实现某一侧值。

循环需要实际迭代轨迹；无限/未终止原计算没有凭空的导数结果。随机、Effectful 或状态计算只有在其数学/估计语义被明确采用时进入 AD。

复数函数通常按实向量空间的线性映射处理；只有满足全纯条件时才简化为复导数。隐式求导需绑定所选解分支、可微性、Jacobian可逆/条件与求解误差。

## 6. 随机与概率

随机请求包含随机源/seed或抽样 stream identity、分布参数、样本 count、独立/相关关系及允许的近似误差。

以下命题不同：

- 同一个固定 seed 可重现；
- 两次调用逐值相同；
- 两次样本分布相同；
- 两组样本独立。

缓存或 CSE 不能把本应“new sample”的两个请求合为一个随机值。两个边际相同也不保证联合分布相同。

拒绝抽样、MCMC、stochastic gradient 等实现需单独声明终止/偏差/相关/支持集条件。预算用尽不能把不足样本或未混合链包装成完整成功。

## 7. 数值表示与设备

数学 Int/Real 与机器 i32/i64/f32/f64/bfloat/decimal 等分开。目标映射要处理：

- overflow/underflow；
- rounding mode；
- NaN/Inf/signed zero；
- reproducibility/FMA/reassociation；
- precision/error budget；
- vector/GPU layout/alignment。

高性能实现可以只覆盖语义输入域的子集，但必须与通用方法构成**全域覆盖**，或把范围限制明确成为产品输入合同。Guard 在转换前、精确域中求值；不能先溢出再判断适用性。

GPU/设备完成与 host 调用返回分开。Buffer 只能在设备不再访问、同步/queue completion 已真实成立后释放或复用。

硬实时要求具体 task model、period/deadline、WCET、blocking/interference 和 scheduler/hardware premises；平均/P99延迟不证明 hard deadline。

## 8. 性质保持与验证

实现保持关系随 Claim 种类变化：

- 确定计算：结果/错误/终止等指定观察；
- trace property：完整相关轨迹；
- noninterference：多次运行间公开观察关系；
- probability：联合分布/误差/样本关系；
- open component：允许链接上下文；
- resource/time：指定成本模型与环境。

“目标行为是源行为子集”只对相应 downward-closed 性质有效，不能自动证明隐私、概率或开放环境安全。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

状态、关系、流、事务、数值和随机机制各自拥有不能被普通函数签名省略的状态、顺序、时间、分布、资源与恢复维度；实现可以复用成熟库或目标特性，但只有保持这些完整合同后才具有替换资格。
