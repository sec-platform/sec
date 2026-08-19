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
→ Plan
→ Delta / Impact
→ Authorization
→ Apply
→ Readback
→ Verification
```

不要把“AI 生成了一段 patch”直接等同于 canonical mutation。

## AI / Workbench

AI 提交 proposal，不直接取得 canonical write authority。

用户应该能看到：

- 当前 canonical subject；
- exact revision；
- proposed change；
- Delta / Impact；
- rejected/unknown reasons；
- required Verification；
- final terminal。

精确 owner：`docs/workbench-and-ai-operations.md`。

## Block / Capability

开发可复用能力时，先定义 Contract/Port/Capability，再决定 Block、Provider 或具体实现。

不要让 UI node、文件路径或包名反向定义 Capability identity。

## Provider / Adapter

接入第三方工具时：

```text
真实 requirement
→ capability decomposition
→ Provider candidate
→ security/license/data/conformance
→ thin Adapter
→ physical Evidence
→ adoption / cutover / retirement
```

“这个库很流行”不是 adoption authority。

## Target / Backend

生成新目标时必须区分：

- Engineering semantics；
- Target Profile；
- Implementation Binding；
- Target Program IR；
- Backend lexical/materialization details。

Backend 不能重新选择上游实现。

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

“为了兼容先留着”必须有 retirement condition。

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
→ exact input/environment
→ failure class
→ stale/unknown boundary
→ next action
```

相同 causal inputs 和同一 failure fingerprint 未变时，不机械全仓重跑。