# SEC Reference

Reference 的目标是**精确查阅**，不承担长篇教学。

## 最终应机器生成的内容

优先包括：

- CLI commands / subcommands / options；
- Config fields；
- Schemas；
- Engineering Operation types；
- Result / Failure / Reason Code；
- Capability IDs；
- Provider / Target identifiers；
- Runtime / Support Matrix；
- Architecture Maturity state；
- public package / release surface。

## 为什么不长期手写

如果代码与手写 Reference 各维护一份：

```text
实现变化
→ 文档可能忘改
→ 用户看到不存在的字段、命令或状态
```

因此长期结构是：

```text
machine contract
→ deterministic docs projection
→ validation / readback
```

人工文档主要解释：

- 字段为什么存在；
- 怎样组合使用；
- 常见错误；
- 边界与例子。

字段 identity 仍来自 machine contract。

## Reference 与 Tutorial 的区别

Tutorial 可以说：

> 用 Quickstart 建立第一个 reference workspace。

Reference 应回答：

```text
命令 identity
参数 schema
默认值的 authority
input/output
side effect class
failure codes
applicability
```

两者不应该复制同一份字段表。

## 当前可直接查询的真实来源

在机器 Reference generator 尚未形成前，精确事实应回到：

- `package.json`：当前 repository script 入口；
- CLI / contract source；
- canonical domain docs；
- machine ledgers；
- owning tests / Verification。

本页不会把今天的 command/version 列表写成永久 truth。