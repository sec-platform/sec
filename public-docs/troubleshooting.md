# SEC 故障排查

不要把所有非成功状态都归成“失败”。

SEC 的排障首先区分：

```text
invalid
failed
unsupported
unknown
unresolved
conflicted
stale
invalidated
blocked
recovery-required
```

## 1. 先找 Owner

问题属于哪个领域：

- Semantic Model；
- Compiler / Resolution；
- Provider / Dependency；
- Runtime / Host / Toolchain；
- Verification；
- Workspace / Filesystem；
- Development Control Plane；
- Release / Distribution；
- Change / Migration。

如果 owner 都不清楚，不应该直接尝试自动修复。

## 2. 再找 Invariant

问：

> 哪条规则应该成立，但现在没有成立？

例如：

```text
same exact input should give same result
candidate cannot self-verify
check should be read-only
Binding must not be reselected downstream
```

## 3. 核对 Exact Input / Environment

确认以下身份有没有变化：

- canonical input；
- revision；
- candidate；
- Provider；
- Target；
- Host / Toolchain；
- Environment；
- Evidence；
- policy / schema / verifier revision。

很多“同一个问题”其实输入已经变了。

## 4. 区分 Deterministic 与 Transient

如果 causal inputs 完全相同，failure fingerprint 也相同：

```text
重复执行同一路径
```

通常不会产生新信息。

应优先复用失败，定位 owner 和 next action。

只有 environment/transient source 真正可能变化时，retry 才是合法恢复动作。

## 5. 不要把 Unknown 当 Success

常见危险模式：

```text
分析工具没找到依赖
→ 当作没有依赖

某平台没跑
→ 当作和另一个平台一样

Provider 没报告 Effect
→ 当作无 Effect
```

这些都应该进入 unknown / unsupported / not-run，而不是 PASS。

## 6. 找 Recovery 语义

恢复可能是：

- 修输入；
- 重新观察；
- re-plan；
- migration；
- provider replacement；
- transaction rollback；
- forward recovery；
- cleanup/readback；
- re-Verification。

不能用“删缓存”“重新 clone”“再跑一次”冒充通用 recovery protocol。

## 7. 最终 Failure Atlas

后续应从稳定 Error / Reason Code 机器生成：

```text
Reason Code
→ 含义
→ canonical owner
→ 常见原因
→ required Evidence
→ retry precondition
→ recovery action
→ forbidden shortcuts
```

这样用户不需要读源码猜一个错误字符串到底代表什么。