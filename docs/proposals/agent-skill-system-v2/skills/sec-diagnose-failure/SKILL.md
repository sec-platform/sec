---
name: sec-diagnose-failure
description: 对可重复的测试、Gate、Review、candidate、process、cleanup或控制面失败建立根因、owner、invariant、失效 Evidence 和唯一下一 operation；不负责无依据重试、直接修码或维护第二 failure 状态机。
compatibility: SEC Agent Skill System v2 proposal
metadata:
  sec-schema: sec-agent-skill-v2
  sec-version: '2'
  sec-operation: diagnose-failure
  sec-risk: read-only
---

# sec-diagnose-failure

## 目标

把 failure observation 转换为机器可消费的 diagnosis。Skill 负责竞争解释、因果链和升级判断；fingerprint、epoch、retry legality、Evidence invalidation与cleanup truth由 deterministic services 拥有。

## 触发

- focused test、typecheck、docs、Risk/Full、CI、Review或merge前置失败。
- candidate stale、manifest/permission冲突、process/cleanup residue、external capability失败。
- 相同症状重复出现，需要判断共享根因还是独立事件。
- operation返回 `diagnosis-required`。

## 不触发

- Job仍在正常运行或结果只是 pending。
- 仅有一次无基线的时长波动，没有 correctness failure。
- 根因、owner、最小修复和 envelope 已冻结：进入 `sec-implement-change`。

## 必需输入

- exact failure observation：subject/base/head/environment/gate/command/exit/tail；
- epoch/failure classifier输出或其缺失状态；
- cleanup/settlement receipt；
- upstream inputs 与最近 delta；
- related authority、owner、tests和已有 failure cluster。

缺失 exact input 或 failure tail 时返回 `unresolved`；不得只凭自然语言“又失败了”形成根因。

## 权限边界

- 默认 `read-only`。
- 可运行由 envelope授权的最小复现/只读探针；不可修改 candidate、清空 cache、扩大 timeout或重跑昂贵 Gate。
- 不创建 successor branch、不改变 Work Package、不关闭 Review thread。
- transient retry是否允许由 failure classifier/retry policy决定，Skill不能自行批准。

## 执行

1. 验证 failure identity 与 cleanup state；stale、混合 head 或未settled process先返回 `reconcile-required`/`blocked`。
2. 读取 classifier输出：failureCode、phase、owner候选、fingerprint、prior occurrence、invalidated Evidence和合法 retry状态。
3. 建立至少一个主解释和最强竞争解释，追踪 input → shared mechanism → failed consumer，而不是停在最后抛错行。
4. 执行 sibling census：同一 parser、selector、cache、writer、state owner、error protocol或资源类是否存在相同模式。
5. 区分：产品实现、contract/schema、authority/ownership、verification selector/result、环境能力、资源settlement、stale external facts、Review omission、tooling defect或unknown。
6. 只有具体因果输入改变且retry policy允许时，输出 `retry-authorized` reference；Skill本身不执行重试。
7. 若同一 root-cause class 已重复或局部修复无法闭合 sibling class，输出 `design-required`；不要用硬编码次数替代 classifier事实。
8. 生成唯一 next operation与最小充分输入：implement、design、integrate、orient/reconcile或blocked。

## 输出合同

```yaml
schema: sec-failure-diagnosis-v2
failureIdentity:
classification:
rootCause:
  owner:
  invariant:
  causalChain: []
competingExplanations: []
siblingCensus: []
minimalReproduction:
invalidatedEvidence: []
cleanupState:
retryDecisionRef:
missingDecisiveEvidence: []
nextOperation:
  operation:
  requiredInputs: []
outcome: completed | unresolved | blocked | design-required | implementation-required | integration-required | reconcile-required
```

## 失败与转移

- 输入/fingerprint混杂 → `orient`/`reconcile-required`。
- 叶节点implementation defect且owner明确 → `implement-change`。
- shared abstraction、owner或架构假设失效 → `design-change`。
- Gate/merge/cleanup集成问题 → `integrate-change`。
- 环境能力缺失且无支持合同 → `govern-capability` 或 blocked。
- 无法区分竞争解释 → 保持 `unresolved` 并列出决定性证据，不用重试抹平。

## 示例

同一 test 在 Windows超时：若 process tree receipt显示子进程未settled，根因属于resource/cleanup owner，不允许只把timeout从120秒改到180秒。

Review指出 aggregate顺序依赖：diagnosis追踪到共享aggregate算法并对排列做 sibling census，转 `design-change`，而不是修一个调用者。

## 资源

- `../../registry.yaml`
- `../../README.md`
- epoch/failure classifier、Evidence invalidator、resource/cleanup receipts
- canonical domain authority与历史最小反例

## 禁止

- 不把重复执行当调查。
- 不以清cache、重启、扩大timeout或删除断言冒充根治。
- 不自行累计“失败次数”作为控制状态。
- 不在 diagnosis 中改产品代码。
- 不因证据不足取消判断；应给出最高概率解释、竞争解释和反转条件。
