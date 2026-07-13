---
name: sec-verification-evidence
description: "为 SEC PR、Work Package 或修复审计验证覆盖、exact-head freshness、证据复用与最小 rerun；仅询问如何运行一个已知测试时不要触发。"
---

# SEC Verification Evidence

本 Skill 把测试结果视为有作用域和失效规则的 evidence，而不是泛化的绿色标签。

## 输入

- exact PR head、current base、merge-base；
- diff/changed paths 与 source ownership；
- verification profile 和 CI contract revision；
- 相关 invariant、Contract Freeze、focused/affected/fast/slow/full Gate；
- 既有 evidence ledger、status、artifact 与 failure tail。

## 流程

1. 建立每条 evidence 的 key：

```text
tested head
current base
profile
contract revision
Gate/command
scope
result
duration/artifact
invalidation rule
```

2. 检查 PR head 是否落后于 base；behind 时禁止复用 merge-ready 结论。
3. 将 changed source 映射到 required test impact；未知 ownership 必须升级 correctness backstop。
4. 区分：
   - exact-head 可直接复用；
   - baseline + intervening diff impact + delta validation 可组合复用；
   - 已因 head/base/contract/scope 变化失效；
   - 从未运行。
5. 只选择被失效或仍缺失的最小 Gate。
6. 失败时读取具体 failed Gate 和 failure tail，区分 implementation、test contract、reference/artifact、environment/transient。
7. 不自动添加 `run-quick`/`run-full`，不盲目 rerun，不扩大 timeout，不删除测试。

可委派 `verification-evidence-reviewer` 做 read-only audit。

## 输出矩阵

| Invariant/Gate | Evidence | Head/Base | Result | Reusable | Invalidation | Required action |
| --- | --- | --- | --- | --- | --- | --- |

任何未实际执行的检查必须标记“未运行”。只有完整满足 Required Verification Contract 时才可给出 merge-ready 结论。
