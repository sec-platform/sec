---
name: task-delegation
description: 用于判断 frozen Work Package 是否值得拆成互不重叠的角色任务，并约束 Worker、Reviewer 与 A0 的责任边界；不用于单一纵切片或同一 authority 的并发写入。
---

# task-delegation

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
2. 每个角色只接收一个 bounded outcome，并继承同一 exact base 与更窄权限。
3. 同一 canonical type、revision、builder、pipeline order 或 authority 段落保持单写者。
4. Worker 不 merge、不触发 hosted Gate、不递归扩权；Reviewer 保持 read-only，只返回 exact path、symbol 与 invariant。
5. 主线程只集成与 frozen package 一致的结果；冲突或越界结果 fail-closed。

## 完成证据
- role projection、owner/path disjoint proof、角色结果与 Reconciliation Delta。
- 若没有实际并行收益，`no-delegation` 是合法且优先的结果。

## 停止与恢复
- 出现 owner 重叠、依赖未闭合、授权不明或独立性不成立时停止委派并返回 typed blocker。
- 角色完成、明确 blocker 或用户改变优先级后停止；不以轮询维持虚假进度。

## 禁止捷径
- 禁止同一文件或 authority 的多个写者。
- 禁止递归分派、主动轮询、为 finding 创建 successor worktree，或把 Agent 输出当作自动 merge 授权。
- 禁止在真实 production Task Capsule compiler 和 consumer cutover 之前仅凭目标架构删除本 Skill。
