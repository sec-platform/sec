# SEC 核心概念

## Canonical

平台正式认可、其他模块必须以其为准的状态或事实来源。

Canonical 不等于“只有一个物理副本”。

## Authority

谁有资格决定某个事实。

“读到了某个值”不等于“有权修改它”。

## Projection

从 canonical truth 导出的面向特定任务的视图。

例：

- UI；
- 图；
- 文档；
- AI Context Packet；
- report；
- cache。

Projection 不拥有它展示的产品事实。

## Evidence

一次可追溯的观察或验证材料。

Evidence 支持 Claim，但不自动成为产品规则。

## Entity / Fact / Assertion

用于表达工程中“有什么东西”“关于它的事实是什么”“某个来源声称什么”。

精确语义见 `docs/semantic-model.md`。

## Responsibility

某个工程语义责任。

不要简单等同于：

- 文件；
- class；
- package；
- 历史 Block。

## Capability / Contract / Port

Capability 表示“需要或提供什么能力”的语义；Contract 定义能力必须满足的稳定边界；Port 是实现层消费该 Contract 的 typed connection point。

三者都不由包名、目录、UI node 或某个 Provider 品牌反向定义。Capability/Contract 的语义由 `docs/semantic-model.md` 拥有，implementation port 与 realization 边界由 `docs/implementation-architecture/model-and-boundaries.md` 拥有。

## Implementation Candidate / Resolution / Binding

Implementation Candidate 是满足某个 Requirement 的具体实现闭包候选。Implementation Resolution 先执行 hard eligibility，再在合格候选中按已批准 policy 裁决；Implementation Binding 是裁决后冻结的具体实现闭包。

下游只消费 Binding，不得每个模块重新选一次。

精确语义见 `docs/compiler-target-ir.md`。

## Distribution Package / Distribution Binding

Distribution Package 只是具有独立分发、信任、Support 或演进生命周期时才存在的物理分发载体；它不是 Capability identity，也不是每项实现都必须有的壳。

Distribution Binding 只把合格 distribution source/content 与 exact acquisition requirement 绑定，不取得业务语义或 Resolution authority。

精确语义见 `docs/runtime-and-distribution/distribution-and-support.md`。

## Legacy Block / Slot

`Block`、`Slot` 仍可能存在于当前实现、历史 schema、迁移 reader 或测试中，但它们已经不是 target architecture 的通用 canonical primitive。新设计不得为了兼容这些旧载体恢复第二套 Capability/Resolution/Registry 本体；它们只能在 Change Management 证明真实旧 consumer 后作为有界 migration source 存在，并在 consumer-zero 后退役。

## Delta / Impact

Delta 表示“什么变了”。

Impact 表示“这个变化会传播到哪里”。

两者不是同一个概念；Git diff 也不能直接替代 Semantic Delta。

## Engineering Operation

对 canonical engineering state 提出或执行的受治理操作。

理想结构：

```text
input
→ pure plan
→ admission(grant + binding + allocation + preimage)
→ effect
→ settlement / readback
```

Pure plan 描述应做什么；live Grant、Provider、Allocation、deadline 和物理 preimage 属于 Admitted Execution，不应反向污染 pure plan identity。

## Verification

回答：

```text
某个 Claim 在什么 Environment 下，
是否有足够 Evidence 支持？
```

它不是单纯的 `exit code == 0`。

## Host / Toolchain / Target / Runtime

四个容易混淆的轴：

- Host：SEC 自己运行在哪里；
- Toolchain：执行 build/typecheck/package 等的工具；
- Target：SEC 要生成什么目标；
- Runtime Environment：生成程序最终在哪里运行。

一个轴成功不能证明另一个轴成功。

## Unknown / Unsupported / Not-run

这些都不是 PASS，也不是 false。

- Unknown：缺少足够事实；
- Unsupported：当前能力合同不支持；
- Not-run：根据可信 applicability 可能是无需执行，也可能只是尚未执行；必须保留具体 reason，不能把两者混在 presentation 文本里。

把这些状态压成一个布尔值会制造错误确定性。
