---
title: 工具、会话与 AI 上下文
status: stable
domain: developer-surface
---

# 工具、会话与 AI 上下文

## 1. 请求共同字段

机器客户端可以使用统一的最小 envelope，但不同工具不被迫填一个万能 DTO。共同字段只在真实需要时存在：

```text
request {
  requestId,
  purpose,
  workspace/project ref?,
  base/candidate ref?,
  target root?,
  scope?,
  options?
}
```

用户文本不是自动 Requirement；自由自然语言先产生 bounded interpretation/candidate，只有被有权采用的结构或明确 direct edit 才进入 authoring revision。

## 2. `query`

常见 query：
- Definition/symbol/reference；
- requirement/implementation explanation；
- impact/readers；
- artifact/source map；
- task/run state；
- capability/target availability。

Result 必须携带 coverage/unknown。Search/top-N 命中不是 complete query。已知 identity 可直接取，不要求先做全文搜索。

## 3. `propose`

`propose` 输入固定 base 和目标：
- author/native change；
- refactor；
- implementation candidate；
- fix candidate；
- multi-file/batch change。

输出 CandidateRef + exact changed regions + assumptions/unresolved。它没有 apply authority。

多个 proposal 可并存；只有 identity/base相同且差异兼容时才可自动合并。AI的候选评分不决定 canonical adoption。

## 4. `preview`

Preview 对 CandidateRef 计算：
- semantic delta；
- physical diff；
- impacted roots/consumers；
- predicted Effects；
- required checks；
- conflicts/frontiers。

Preview 必须纯于其冻结输入。需要读外部新信息时先返回 Needs/Requirement，由外层取得后形成新 snapshot；不能在 preview 内偷偷安装、联网或写工作区。

## 5. `check`

Check 选择 Claim/obligation closure。纯静态检查与需要现实执行的验证分开：
- pure checker 只读 frozen inputs；
- runtime/tool check 通过 Operation/Capability 取得真实环境；
- Evidence 绑定 exact candidate/artifact/environment/method。

退出0不自动等于所有 Claim PASS；结果必须解释 tool-specific status、coverage、skipped/unknown。

## 6. `apply`

Apply 前置：
- Candidate base/preimage仍匹配；
- author/write ownership可用；
- required policy/confirmation satisfied；
- stale preview/check按消费要求重核；
- multi-file commit boundary已确定。

写入采用 compare-and-set/transaction/平台真实原子能力；无法跨多个资源原子时明确 partial-effect/recovery，不通过顺序写入伪造全局原子。

Apply成功生成新 source revision；不自动 build/run。

## 7. `operation`

Operation 可以承载：
- build/materialize；
- run/task/test/debug；
- install/package；
- deploy/migrate；
- external effect。

状态至少：
```text
prepared → accepted → running/settling → terminal
```
`accepted` 不是 completed。timeout 后若外部 effect 状态未知，保留 operation identity 并查回/补偿；不得换新 id 重放非幂等作用。

## 8. batch

Batch 中每一项保持独立 identity/result；全批结果另外表示 complete/partial/blocked。默认不因为一个 item 失败取消无依赖的其他 item；共同原子 Requirement 存在时按明确 transaction/rollback contract 处理。

## 9. concurrency

并行请求必须根据真实 read/write/effect sets 调度。相同 workspace 不意味着所有任务串行；不同文件也不意味着完全独立。

同一 writer region 需要序列化或 rebase；共享 read snapshot可并发。外部 provider、cache、quota、clock 造成的隐藏耦合进入资源/影响模型，不能只看数据流边。

## 10. cancellation

取消是请求，不是“删除状态”：
- 未开始工作可直接终结；
- 已执行纯计算可以停止并丢弃候选；
- 已转移资源/发出外部 effect 的工作要等待真实 cancellation/settlement；
- shared producer 不因一个 waiter取消而杀掉其他消费者。

客户端关闭同理。

## 11. AI context

AI context 由 purpose closure生成，优先包含：
- actual user requirement/scope；
- relevant author definitions；
- impacted source spans；
- public contracts；
- current diagnostics/frontier；
- tool schemas needed for task。

默认不发送：
-全库历史；
-无关 private source；
-secret values；
-所有 tool schemas；
-过期候选/旧结果。

Context compression 可以摘要解释性材料，但 hard Constraint、negative condition、exact identity/revision、Authority/Effect boundary 不能因 token budget 丢失。无法在预算中提供最小完整 closure时返回 insufficiency，而不是“尽量猜”。

## 12. delegation

子任务委派固定：
- purpose/scope；
- readable refs；
- allowed tools/Effects；
- expected artifact；
- parent candidate/generation；
- return schema。

子任务不得扩大 scope、继承未授予的 secret/network/write authority，或把自己的 inferred fact升级为 parent canonical truth。父任务合并时重新检查版本、冲突和完整性。

## 13. 会话恢复

持久恢复只恢复有真实 owner 的对象：
- source/candidate revision；
- operation identity；
- unresolved obligations；
- durable receipts。

UI selection、模型隐藏思考、未提交内存对象等没有 durable contract 的状态不能伪装恢复。旧 session 的结果只有在 exact input/consumer仍适用时复用。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

工具请求始终绑定 purpose、exact input 和 generation；proposal/preview/check 都不自行取得写或执行权，apply 与 operation 分别承担作者提交和现实 Effect。AI context/委派只投影最小完整闭包，取消和恢复按真实资源与操作结算。
