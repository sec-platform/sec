# SEC 指南

指南按“你要完成什么”组织，而不是按内部 domain 文件组织。

## 新项目

目标路径：

```text
Intent
→ Engineering Semantic Model
→ Implementation Resolution
→ Target Program
→ Verification
```

需要进一步理解：

- `docs/semantic-model.md`
- `docs/compiler-target-ir.md`
- `docs/verification-governance.md`

## 已有项目 / Brownfield

目标路径：

```text
Attach
→ Observe Source Program
→ Lift
→ Reconcile
→ Adopt
→ Normalize
```

未知、动态、反射、native 或暂时无法理解的区域可以保持 opaque，不强制伪装成完整 Engineering IR。

精确 owner：`docs/brownfield-import.md`。

## 修改工程

正式修改遵循：

```text
Engineering Operation
→ Pure Plan
→ Admission(Grant + Binding + Allocation + Preimage)
→ Apply
→ Settlement / Readback
→ Verification
```

Pure Plan 不能因为 live credential、Provider instance、deadline 或临时目录改变就变成另一份业务计划；这些属于执行准入。不要把“AI 生成了一段 patch”直接等同于 canonical mutation。

## AI / 机器接口

AI 提交 proposal，不直接取得 canonical write authority。

用户应该能看到：

- 当前 canonical subject；
- exact revision；
- proposed change；
- Delta / Impact；
- rejected/unknown reasons；
- required Verification；
- final terminal。

精确 owner：`docs/agent-and-user-machine-interface.md`。

## Capability / Contract / Port

开发可复用能力时，先定义 Capability Contract 与 Requirement，再由 Implementation Architecture 产生 typed Port/realization，由 Resolution 选择具体 Implementation Candidate/Binding。

只有实现真的具有独立 distribution/trust/support/evolution 生命周期时才建立 Distribution Package。不要让 UI node、文件路径、包名、旧 Block/Slot 或 Provider 品牌反向定义 Capability identity。

精确 owner：`docs/semantic-model.md`、`docs/implementation-architecture/model-and-boundaries.md`、`docs/compiler-target-ir.md` 与 `docs/runtime-and-distribution/distribution-and-support.md`。

## Provider / Adapter

接入第三方工具时：

```text
真实 requirement
→ capability decomposition
→ Provider candidate
→ security/license/data/conformance
→ exact Binding
→ physical Evidence
→ adoption / cutover / retirement
```

Adapter 只在协议、credential、identity、resource、settlement、Target lowering 等真实边界增加价值时存在；稳定 machine interface 足够时直接消费。“这个库很流行”不是 adoption authority。

## Target / Backend

生成新目标时必须区分：

- Engineering semantics；
- Target Profile；
- Implementation Binding；
- Target Program IR；
- Backend lexical/materialization details。

Target Profile 不应依赖先完成 Brownfield adoption；Brownfield/Provider 只是 Implementation Candidate 的可能来源。Backend 不能重新选择上游实现。

## 升级与迁移

长期变化应考虑：

```text
old state
→ Delta
→ Compatibility Decision
→ Migration / Compensation / Provider switch
→ Verification
→ Consumer Cutover
→ Old Path Retirement
```

“为了兼容先留着”必须有真实旧 consumer、支持窗口与 retirement condition。

## Runtime / Support

不要把以下轴混在一起：

```text
Host
Toolchain
Target
Runtime Environment
Distribution
Support
```

Windows 成功不能证明 Linux；Node 成功不能证明 Bun；source verification 成功不能证明 packaged install。

## Verification / Debugging

失败时先定位：

```text
owner
→ invariant
→ exact reachable input closure
→ environment/provider dependencies
→ failure class
→ stale/unknown boundary
→ next action
```

相同 causal inputs 和同一 failure fingerprint 未变时，不机械全仓重跑；无关 generation 变化也不应污染局部 ActionKey。
