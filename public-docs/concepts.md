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
- Block。

## Capability / Block

Capability 表示能力语义；Block 是可复用、可解析和连接的实现/组合结构之一。

精确语义见 `docs/capability-and-block-model.md`。

## Port / Contract / Slot

用于表达：

- 可以连接什么；
- 需要满足什么合同；
- 哪些位置允许受治理的实现变化。

## Implementation Resolution

把：

```text
我要什么能力
```

变成：

```text
由哪个具体实现闭包负责
```

它必须先做 hard eligibility，再在合格候选中按 policy 排序。

## Implementation Binding

已经冻结的具体实现选择。

下游只能消费 Binding，不能每个模块重新选一次。

## Delta / Impact

Delta 表示“什么变了”。

Impact 表示“这个变化会传播到哪里”。

两者不是同一个概念；Git diff 也不能直接替代 Semantic Delta。

## Engineering Operation

对 canonical engineering state 提出或执行的受治理操作。

理想结构：

```text
input
→ plan
→ delta / impact
→ authorize
→ apply
→ readback
```

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
- Not-run：适用但尚未执行。

把它们压成一个布尔值会制造错误确定性。