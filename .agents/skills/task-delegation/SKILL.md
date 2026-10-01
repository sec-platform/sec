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
4. Worker 不从角色名取得 hosted Gate 或 merge 权限；Envelope 已明确委派目标 branch/ref 及发布终态时，按 [worker-development](../worker-development/SKILL.md) 与原 Effect owner 完成该分支的发布闭包，并遵守 AGENTS 的 hosted evidence budget。默认分支集成仍归原 integration owner，不递归扩权；Reviewer 保持 read-only，只返回 exact path、symbol 与 invariant。
5. 角色在已委派的目标、写集与作用上限内自主推进，主动向原owner回读尚未满足的前置；前置成立且资源与作用准入有效时及时接续同一任务，不等待重复口头许可。观察按真实责任和变化条件取得，不靠重跑未失效的检查制造进度。 阻塞必须收窄到实际依赖它的动作，不能把验收／合并缺证据扩大为编辑、独立检查、已准入提交或已授权分支推送一并暂停。等待前在原任务交接中说明缺少的前置、负责解除的owner、可观察的恢复条件，以及此时仍可继续的合法动作；无法说明因果依赖的等待不成立。共同检查或管理方便不足以强制独立结果合包，共享writer只串行相冲突的写入／集成；无独立准入的动作也不能为“保持并发”绕过门禁。
6. 主线程核结果与frozen package、输入身份及实际完成边界后集成；冲突或越界结果交还原owner。收到报告、发出取消和物理结束分别观察，已启动的任务由原owner join或合法移交，不能一报完成就复用仍占用的写者/资源。 前置解除或角色交回后，主线程选择原授权任务的下一就绪动作；需要恢复已结束角色时调用实际启动／恢复入口，并取得本次执行身份，不能把发送说明当成任务已经继续。运行标签、配置角色数或Skill已读不证明产生了执行、交付或有效并行。

## 完成证据
- role projection、owner/path独立依据、实际启动/交回/在途或已结算状态、角色结果与Reconciliation Delta；沿原任务结果保留，不另造调度账本。
- 若没有实际并行收益，`no-delegation` 是合法且优先的结果。

## 停止与恢复
- 出现真实owner／写集冲突、独立性不成立、作用拒绝或超出当前授权的必要决定时，只停止并交回受影响动作的typed blocker。可由原owner回读或已有授权内的修复解决的前置由角色主动推进；其余独立合法工作继续，不把普通等待或可恢复失败升级为重复授权请求。
- 角色完成或明确 blocker 后交还主线程；主线程继续原授权任务。确有在途结果时按原owner的join/观察协议等待，不把无变化轮询当进度，也不将合法等待一概禁止。

## 禁止捷径
- 禁止同一文件或 authority 的多个写者。
- 禁止子角色未经委派递归扩权、无新条件反复轮询、为 finding 创建 successor worktree，或把 Agent 输出当作自动 merge 授权。
- 禁止在真实 production Task Capsule compiler 和 consumer cutover 之前仅凭目标架构删除本 Skill。
