---
name: sec-failure-recovery
description: 用于测试、Gate、Review、candidate、进程或控制面失败后分类根因、最小重跑、proof reset和设计回退；不用于无分类重复尝试。
---

# sec-failure-recovery

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
4. 重复同根因 frozen invalidation 请求 failure owner 签发 typed proof-reset decision，不由 Skill 发明状态。
5. proof reset后再次同类失败返回架构重算所需的 root-cause evidence，不继续补丁循环。
6. capsule/chain损坏从最后合法generation恢复；无合法generation则fail closed。
7. merge或其他trust-root mutation完成exact new-main readback后，立即封存旧epoch，丢弃其effect grant、Review、Evidence和缓存control facts；不得把旧receipt带入下一代。
8. 如果当前用户授权仍覆盖任务，自动从exact new main运行canonical document-control status，重载`AGENTS.md`、selected manifest与authority closure，取得新operation epoch并继续`RequiredClosure ∩ MissingOrStale`。信任代际变化本身不是用户交互点，也不能输出`TASK_RESTART_REQUIRED`作为常规终态。
9. 只有canonical status为`unresolved/invalid`、缺少外部authority、独立Review不可用、下一步需要用户选择或出现其他typed外部阻塞时，才把控制权返回用户；这些条件之外不得自主结束仍有合法下一动作的任务。

## 完成证据
- failure class、root-cause cluster、invalidated Evidence、owner/invariant/next action。

## 停止与恢复
- 根因、owner、invariant、下一动作和失效Evidence明确。
- 瞬态仅在因果输入变化后受限重试；重复根因交给 deterministic failure/proof-reset owner。
- old epoch必须终止，但长期任务默认自动跨epoch恢复；“终止旧授权”与“终止用户任务”是两个不同状态。
- 正向：new-main readback完整且status resolved时自动重新定向并继续。
- 负向：不得复用old-epoch authority/Evidence，也不得把`TASK_RESTART_REQUIRED`当作普通停止理由。
- 边界：status unresolved/invalid、外部authority或独立Review不可得、或必须用户裁决时才停止并报告typed blocker。

## 禁止捷径
- 不硬重置或删除未审计工作。
- 不把所有失败累计成同一candidate次数。
