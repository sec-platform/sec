---
name: failure-recovery
description: 用于测试、Gate、Review、candidate、进程或控制面失败后分类根因、约束recovery制品生命周期、最小重跑、proof reset和设计回退；不用于无分类重复尝试或把recovery当备份。
---

# failure-recovery

## 当前归属
尝试最终性、未知作用与重试归[提交与恢复](../../../docs/运行/持久化提交与恢复.md#attempt-finality-and-retry)；仓库续作与代际准入归[规则装载](../../../docs/开发/AI协作/规则装载与任务恢复.md#sec自身仓库开发的行为准入工作身份与恢复)；内容保留与可重建缓存的区别归[存储保留](../../../docs/信息/存储保留与恢复.md)。

## 触发
- focused/Gate失败、Review changes、candidate invalidation、capsule损坏、remote stale或基础设施故障。

## 不触发
- 正常在途且可按原owner继续join，或只是单次性能离群；失联、取消后停止未知或结算失败仍进入本Skill。

## 输入
- failure tail、exact identity、old/current trust epoch、mutation/prompt epoch、root-cause cluster、cleanup evidence。

## 前置门禁
- 先固定能确认的failure/operation identity、输入变化与cleanup观察；无法取得的部分显式unknown。诊断可从unknown开始，但它不能授权重放、删除或认领终态。

## 执行
1. 分类为产品、合同、Review、用户scope、authority、环境瞬态、基础设施、stale remote或unknown。缺依赖、制品丢失和观察器不可用不自动计为产品断言失败；先问旧attempt是否可能仍写入或已提交，取消请求与超时不等于物理终结。
2. 只重跑被delta失效的最小sentinel；确定性失败在输入未变时复用失败证据并停止该执行路径；环境瞬态、远端结果未知或原合同要求再次观察时，按原owner的错误分类、预算、退避和重复效果安全规则受限重试／读回，不要求先证明不可见环境已经改变，不停止仍有其他合法下一动作的长期任务。
3. 接续同类动作前，消费原任务中已验证路径及其环境、目标、授权和结果边界。当前条件未变且已有合格成功路径时直接复用，不先重走已确定失败的默认路径；环境或权限变化时只重核失效部分。成功路径不扩大作用授权，明确安全／权限拒绝仍停止相交动作，不能借替代路径绕过。transient failure不生成新candidate；用户scope变化先reconcile。
4. 创建任何recovery制品前做删除反事实：只有真实恢复消费者无法从canonical source重建、且稍后仍必须继续同一Effect时才创建。测试seam、人工保险、展示、日志、旧分支名或“可能有用”都不是消费者。
5. 先区分可从固定输入重建的cache、必须继续原作用的recovery与已交付且仍有消费者的artifact。一次性cache丢失时由原producer重建；若发布引用错误依赖该cache，则修发布/保留接缝，不把整份cache转成永久备份。recovery的创建、读取、终态和退役必须属于一个canonical lifecycle owner。制品绑定exact subject、operation/generation、恢复入口和终态；不得手工移动到`.tmp`、复制第二份、另建兼容owner或用recovery反向签发authority。
6. owner按原合同在settlement和恢复入口核本operation及其保留资源的完整census：terminal receipt成立、目标已由canonical readback结算、live ref/operation/consumer均消失时，同一动作自动退役制品及空owner目录；prepared、residue、live consumer和typed unknown保留并返回明确原因。不能让调用者自行猜测或清理。
7. 重复同根因 frozen invalidation 请求 failure owner 签发 typed proof-reset decision，不由 Skill 发明状态。
8. proof reset后再次同类失败返回架构重算所需的 root-cause evidence，不继续补丁循环。
9. capsule/chain损坏从最后合法generation恢复；无合法generation则fail closed。迁移旧制品时必须先枚举、分类并由新owner读回，不能因年代、路径或命名猜测可删。
10. merge或其他trust-root mutation完成exact new-main readback后，立即封存旧epoch并停止复用其effect grant及已失效的control facts；Review、Evidence和receipt保留原绑定及恢复价值，由对应owner按新主体、输入和失效条件判定复用，不能整体删除，也不能直接当作新代次授权。
11. 如果当前用户授权仍覆盖任务，自动从exact new main运行canonical document-control status，重载`AGENTS.md`、selected manifest与authority closure，取得新operation epoch并继续`RequiredClosure ∩ MissingOrStale`。信任代际变化本身不是用户交互点，也不能输出`TASK_RESTART_REQUIRED`作为常规终态。
12. 当前角色无法解除的`unresolved/invalid`、缺少authority、必需独立Review不可用或其他 typed blocker 先交协调 owner／原 owner；只有缺失的外部授权、信息或决定无法由现有 owner 取得时，才升级到相应外部决策边界。阻塞不终止仍有合法下一动作的原任务。

## 完成证据
- failure class、root-cause cluster、invalidated Evidence、owner/invariant/next action。
- recovery census按owner列出`created / retained / retired / residue / unknown`；每个retained项给出当前真实consumer和恢复入口，terminal项必须有退役readback。

## 停止与恢复
- 根因、owner、invariant、下一动作和失效Evidence明确。
- recovery无真实consumer时完成态是“不创建”；已有terminal制品与空owner目录未退役时不得声明收口。
- 瞬态按原owner合同受限重试或再观察；重复根因交给 deterministic failure/proof-reset owner。
- old epoch必须终止，但长期任务默认自动跨epoch恢复；“终止旧授权”与“终止用户任务”是两个不同状态。

## 禁止捷径
- 不硬重置或删除未审计工作。
- 不把所有失败累计成同一candidate次数。
- 不把recovery、备份、临时复制、隐藏目录或人工改名当作低成本保险；不能证明consumer与退役条件就不创建。
