---
title: Development Run Kernel 提案
status: draft
domain: proposal
last-reviewed: 2026-07-29
---

# Development Run Kernel 提案

目标是让上下文压缩、进程退出、新会话、worktree切换或Agent替换后，执行者只依赖外部权威状态重算同一合法 next transition；绑定不一致时fail closed。它不恢复隐藏思维，也不拥有产品语义、Verification Result或GitHub计划。

## 唯一职责

Development Run Kernel只拥有：

- stable runId与repository/workspace fingerprint；
- current Work Package/epoch/reference binding；
- transition preconditions；
- immutable event/capsule chain；
- lock/lease与single-transition serialization；
- resume、cancel、supersede和terminal transition；
- external prompt intake与reconciliation trigger。

以下能力由其他唯一owner拥有，Kernel只引用：

- Authoring/Candidate/Frozen与failure fingerprint：Epoch/Failure contract；
- Gate结果真值：Verification Result；
- Gate节点、Evidence复用和persistent next action：Evidence DAG / Run Journal；
- 多Work Package冲突和merge order：Parallel Work Package / Integration Queue；
- source mutation：Semantic Mutation；
- compiler/test影响：Compiler Incremental Graph与Semantic Test Impact。

## 状态模型

```text
created
→ oriented
→ authorized
→ running
→ blocked | candidate | cancelled | superseded
→ frozen
→ verified
→ integrated
→ read-back
→ completed
```

非法跳转、缺少precondition、repository fingerprint变化、base/head/tree/manifest不一致或event chain损坏全部fail closed。`blocked`不等于失败终态；只有输入或依赖发生明确变化才能继续。

## Capsule 与 Event

Capsule是某一合法状态的可验证快照，至少绑定：

- runId、Work Package identity和manifest digest；
- repository、common-dir、workspace、branch、base/head/tree；
- authority/read/write/resource set；
- current epoch和failure fingerprint；
- completed/reusable/invalidated Evidence refs；
- next action、resume preconditions与reload_if；
- event chain head和format revision。

Event不可变追加，记录transition intent、input digest、result与新Capsule identity。聊天摘要、隐藏推理和进程内对象不进入chain。

## 并发与锁

同一run transition必须串行；不同Execution Work Package是否并行由Integration conflict resolver决定。Kernel锁不能替代workspace writer lease、Gate lease、port/process owner或Git ref保护。

锁丢失、owner未知或stale无法证明时停止，不猜测抢占。取消或supersede必须终止owned process/resource并取得cleanup receipt。

## Prompt Intake

新用户指令先作为外部input记录：

```text
prompt bytes/digest
→ classify goal/scope delta
→ compare active authority and Work Package
→ continue | reconcile | invalidate candidate | create new plan
```

Prompt不能直接改写current phase、权限、Evidence或完成状态。用户扩大长期Goal时更新canonical goal/roadmap；不修改已冻结candidate，除非其scope被明确证伪。

## Recovery

恢复固定执行：

1. 从latest main和Git/GitHub facts重新orientation；
2.读取最后一个验证合法的Capsule/event chain；
3.重新验证repository/workspace/base/head/tree/manifest/authority绑定；
4.加载引用的machine results和failure record；
5.重算唯一合法next transition；
6.若任何输入不一致，进入reconcile或invalidated，不继续旧动作。

禁止通过历史聊天猜“做到哪一步”，也禁止重复运行未失效的昂贵Gate来恢复信心。

## Project Hook 边界

Hook只覆盖本地工具的workflow防线，例如显式path stage、imports freeze、candidate binding和capsule update。Hook不是完整安全沙箱，不能阻止外部进程、管理员或任意filesystem写入。

## 分阶段交付

1. Manual-shadow：外部状态人工可验证，明确不能声明自动恢复。
2. Kernel Shadow：机器生成Capsule/event但不控制执行，比较人工transition。
3. Hook Activation：关键本地transition由Hook拒绝非法状态。
4. Run Journal Integration：跨会话恢复Gate/failure/next action。
5. Parallel Integration：消费冲突resolver与Integration Queue。
6. Compact/Restart Acceptance：真实压缩、进程重启、worktree切换和Agent替换验证。

## 完成定义

- 同一外部状态总是得到同一合法next transition；
- context压缩/进程退出不会回到旧任务、重复Gate或扩大scope；
- stale/corrupt/mismatched state fail closed且可从最后合法generation恢复；
-没有第二epoch、failure、Gate、Impact或integration语义；
-每阶段进入main并readback，退役被替代的manual状态。
