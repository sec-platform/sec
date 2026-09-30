---
name: task-delegation
description: 判断 frozen Work Package 是否值得分成独立并行结果，或需要隔离独立 Reviewer；保持单写者与角色收口，不为没有收益的单一纵切片增派 Worker。
---

# task-delegation

## 当前归属
任务授权与交接归[规则装载](../../../docs/开发/AI协作/规则装载与任务恢复.md#委派与长任务恢复)；实际子任务、取消和join归[任务寿命](../../../docs/领域/计算基础/通用计算与任务语义.md#structured-task-lifecycle)，共享预算归[资源管理](../../../docs/运行/权限与资源管理.md)。角色配置提供指引，不能代签实际调度或独立性。

## 触发
- frozen Work Package 存在两个以上真正独立、并行收益大于协调成本的 seam，或必须隔离独立 Reviewer。

## 不触发
- 单一纵向切片由当前 writer 直接完成更快。
- 候选角色共享 canonical writer、owned path、前置结果或外部 effect，无法形成物理独立闭包。
- 只是希望“多看一眼”或扩大探索面，没有可交付的独立结果。

## 输入
- exact base 与 frozen Work Package ref/digest。
- 当前用户授权、角色候选、owned/forbidden path closure、依赖、资源冲突、停止条件和独立性要求。
- 若 production Task Capsule compiler 已可用，消费其 typed output；不得从 prose 重建竞争 Capsule。

## 前置门禁
- repository resolver 与 frozen Work Package 均有效。
- 每个角色都有单一 owner、可独立收口的结果和明确的依赖边界；否则保持单 writer。

## 执行
1. 先比较并行节省与协调、上下文、冲突和复核成本；收益不明确时不委派。
2. 每个角色接收bounded outcome、同一exact base、必要owner引用与更窄权限；明确交回证据和停止条件，不复制所有Skill正文。启动前核当前在途任务、共享fixture/依赖与可用资源，按真实scheduler准入。角色数或max_threads配置不证明实际并发上限，嵌套进程与测试worker同样消耗共同预算。
3. 同一 canonical type、revision、builder、pipeline order 或 authority 段落保持单写者。
4. Worker 不 merge、不触发 hosted Gate、不递归扩权；Reviewer 保持 read-only，只返回 exact path、symbol 与 invariant。
5. 主线程核结果与frozen package、输入身份及实际完成边界后集成；冲突或越界结果交还原owner。收到报告、发出取消和物理结束分别观察，已启动的任务由原owner join或合法移交，不能一报完成就复用仍占用的写者/资源。

## 完成证据
- role projection、owner/path独立依据、实际启动/交回/在途或已结算状态、角色结果与Reconciliation Delta；沿原任务结果保留，不另造调度账本。
- 若没有实际并行收益，`no-delegation` 是合法且优先的结果。

## 停止与恢复
- 出现 owner 重叠、依赖未闭合、授权不明或独立性不成立时停止委派并返回 typed blocker。
- 角色完成或明确 blocker 后交还主线程；主线程继续原授权任务。确有在途结果时按原owner的join/观察协议等待，不把无变化轮询当进度，也不将合法等待一概禁止。

## 禁止捷径
- 禁止同一文件或 authority 的多个写者。
- 禁止子角色未经委派递归扩权、无新条件反复轮询、为 finding 创建 successor worktree，或把 Agent 输出当作自动 merge 授权。
- 禁止在真实 production Task Capsule compiler 和 consumer cutover 之前仅凭目标架构删除本 Skill。
