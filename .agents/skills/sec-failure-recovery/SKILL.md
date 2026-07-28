---
name: sec-failure-recovery
description: 用于测试、Gate、Review、candidate、进程或控制面失败后分类根因、最小重跑、proof reset和设计回退；不用于无分类重复尝试。
compatibility: SEC 仓库；按本 Skill 的权威、权限和验证边界执行。
---

# sec-failure-recovery

## 触发
- focused/Gate失败、Review changes、candidate invalidation、capsule损坏、remote stale或基础设施故障。

## 不触发
- 结果尚未完成或只是单次性能离群。

## 输入
- failure tail、exact identity、mutation/prompt epoch、root-cause cluster、cleanup evidence。

## 权限与路径
- 只处理失败证据、最小delta和恢复状态；不扩大产品scope。

## 允许工具与操作
- failure tail读取、root-cause分类、最小sentinel、capsule recovery、proof reset。

## 前置门禁
- exact failure identity、cleanup状态和输入变更已知。

## 执行
1. 分类为产品、合同、Review、用户scope、authority、环境瞬态、基础设施、stale remote或unknown。
2. 只重跑被delta失效的最小sentinel；环境瞬态只有在锁owner结束、cache修复、network恢复等具体因果输入变化后才允许现有primitive定义的受限重试，输入与failure tail未变时复用失败证据并停止。
3. transient failure不生成新candidate；用户scope变化先reconcile。
4. 第二次同根因frozen invalidation返回 `STOP_PROOF_RESET`。
5. proof reset后再次同类失败进入 `BLOCKED_REDESIGN_REQUIRED`。
6. capsule/chain损坏从最后合法generation恢复；无合法generation则fail closed。

## 完成证据
- failure class、root-cause cluster、invalidated Evidence、owner/invariant/next action。

## 停止与恢复
- 根因、owner、invariant、下一动作和失效Evidence明确。
- 瞬态受限重试；二次同根因STOP_PROOF_RESET；再犯BLOCKED_REDESIGN_REQUIRED。

## 禁止捷径
- 不硬重置或删除未审计工作。
- 不把所有失败累计成同一candidate次数。

## 权威
- `AGENTS.md`
- `docs/04-AI自主实现执行蓝图.md`
- `docs/07-Pass状态机、错误码与恢复机制.md`
