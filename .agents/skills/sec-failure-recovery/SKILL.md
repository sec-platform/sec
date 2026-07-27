---
name: sec-failure-recovery
description: 用于测试、Gate、Review、candidate、进程或控制面失败后分类根因、最小重跑、proof reset和设计回退；不用于无分类重复尝试。
compatibility: SEC 仓库；按本 Skill 的权威与工具边界执行。
---

# sec-failure-recovery

## 触发
- focused/Gate失败、Review changes、candidate invalidation、capsule损坏、remote stale或基础设施故障。
## 不触发
- 结果尚未完成或只是单次性能离群。
## 输入
- failure tail、exact identity、mutation/prompt epoch、root-cause cluster、cleanup evidence。
## 执行
1. 分类为产品、合同、Review、用户scope、authority、环境瞬态、基础设施、stale remote或unknown。
2. 只重跑被delta失效的最小sentinel。
3. transient failure不生成新candidate；用户scope变化先reconcile。
4. 第二次同根因frozen invalidation返回 `STOP_PROOF_RESET`。
5. proof reset后再次同类失败进入 `BLOCKED_REDESIGN_REQUIRED`。
6. capsule/chain损坏从最后合法generation恢复；无合法generation则fail closed。
## 停止条件
- 根因、owner、invariant、下一动作和失效Evidence明确。
## 禁止捷径
- 不硬重置或删除未审计工作。
- 不把所有失败累计成同一candidate次数。
## 权威
- `AGENTS.md`
- `docs/04-AI自主实现执行蓝图.md`
- `docs/07-Pass状态机、错误码与恢复机制.md`
