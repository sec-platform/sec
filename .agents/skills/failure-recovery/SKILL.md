---
name: failure-recovery
description: 用于测试、Gate、Review、candidate、进程或控制面失败后分类根因、约束recovery制品生命周期、最小重跑、proof reset和设计回退；不用于无分类重复尝试或把recovery当备份。
---

# failure-recovery

## 触发
- focused/Gate失败、Review changes、candidate invalidation、capsule损坏、remote stale或基础设施故障。

## 不触发
- 结果尚未完成或只是单次性能离群。

## 输入
- failure tail、exact identity、old/current trust epoch、mutation/prompt epoch、root-cause cluster、cleanup evidence。

## 前置门禁
- exact failure identity、cleanup状态和输入变更已知。

## 执行
1. 分类为产品、合同、Review、用户scope、authority、环境瞬态、基础设施、stale remote或unknown。
2. 只重跑被delta失效的最小sentinel；环境瞬态只有在锁owner结束、cache修复、network恢复等具体因果输入变化后才允许现有primitive定义的受限重试，输入与failure tail未变时复用失败证据并停止该执行路径，不停止仍有其他合法下一动作的长期任务。
3. transient failure不生成新candidate；用户scope变化先reconcile。
4. 创建任何recovery制品前做删除反事实：只有真实恢复消费者无法从canonical source重建、且稍后仍必须继续同一Effect时才创建。测试seam、人工保险、展示、日志、旧分支名或“可能有用”都不是消费者。
5. recovery的创建、读取、终态和退役必须属于一个canonical lifecycle owner。制品绑定exact subject、operation/generation、恢复入口和终态；不得手工移动到`.tmp`、复制第二份、另建兼容owner或用recovery反向签发authority。
6. owner在每次settlement和恢复入口先做完整census：terminal receipt成立、目标已由canonical readback结算、live ref/operation/consumer均消失时，同一动作自动退役制品及空owner目录；prepared、residue、live consumer和typed unknown保留并返回明确原因。不能让调用者自行猜测或清理。
7. 重复同根因 frozen invalidation 请求 failure owner 签发 typed proof-reset decision，不由 Skill 发明状态。
8. proof reset后再次同类失败返回架构重算所需的 root-cause evidence，不继续补丁循环。
9. capsule/chain损坏从最后合法generation恢复；无合法generation则fail closed。迁移旧制品时必须先枚举、分类并由新owner读回，不能因年代、路径或命名猜测可删。
10. merge或其他trust-root mutation完成exact new-main readback后，立即封存旧epoch，丢弃其effect grant、Review、Evidence和缓存control facts；不得把旧receipt带入下一代。
11. 如果当前用户授权仍覆盖任务，自动从exact new main运行canonical document-control status，重载`AGENTS.md`、selected manifest与authority closure，取得新operation epoch并继续`RequiredClosure ∩ MissingOrStale`。信任代际变化本身不是用户交互点，也不能输出`TASK_RESTART_REQUIRED`作为常规终态。
12. 只有canonical status为`unresolved/invalid`、缺少外部authority、独立Review不可用、下一步需要用户选择或出现其他typed外部阻塞时，才把控制权返回用户；这些条件之外不得自主结束仍有合法下一动作的任务。

## 完成证据
- failure class、root-cause cluster、invalidated Evidence、owner/invariant/next action。
- recovery census按owner列出`created / retained / retired / residue / unknown`；每个retained项给出当前真实consumer和恢复入口，terminal项必须有退役readback。

## 停止与恢复
- 根因、owner、invariant、下一动作和失效Evidence明确。
- recovery无真实consumer时完成态是“不创建”；已有terminal制品与空owner目录未退役时不得声明收口。
- 瞬态仅在因果输入变化后受限重试；重复根因交给 deterministic failure/proof-reset owner。
- old epoch必须终止，但长期任务默认自动跨epoch恢复；“终止旧授权”与“终止用户任务”是两个不同状态。
- 正向：new-main readback完整且status resolved时自动重新定向并继续。
- 负向：不得复用old-epoch authority/Evidence，也不得把`TASK_RESTART_REQUIRED`当作普通停止理由。
- 边界：status unresolved/invalid、外部authority或独立Review不可得、或必须用户裁决时才停止并报告typed blocker。

## 禁止捷径
- 不硬重置或删除未审计工作。
- 不把所有失败累计成同一candidate次数。
- 不把recovery、备份、临时复制、隐藏目录或人工改名当作低成本保险；不能证明consumer与退役条件就不创建。
