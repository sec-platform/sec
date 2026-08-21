---
name: sec-external-capability-governance
description: 在多个成熟外部机制之间裁决 direct reuse、薄 Adapter、Provider adoption、replace、reject 或 defer；不拥有 package/lock、Effect 或 SEC 语义真值。
---

# sec-external-capability-governance

本 Skill 仅在 trusted applicability 选中后加载；只消费 Operation Read Plan 已准入事实，`effectAuthority=none`。

## 适用边界
- 适用：真实 consumer 已存在，但 direct reuse、官方 API/library、薄 Adapter、现有 SEC owner、自研之间仍有不可由机器事实唯一决定的 tradeoff。
- 不适用：当前 Provider/Capability owner 已批准 exact route/version/effect，或 package/lock、materialization、availability 可由确定性 owner直接完成。

## 已准入输入
- 仅使用 Read Plan 给出的 consumer/problem、候选机制能力与限制、machine interface、physical compatibility/performance Evidence、license/security/data/effect 边界。
- 未准入官网/README/网络讨论或工具输出不因本 Skill 自动读取；缺事实返回 `evidence-needed`。

## 判断职责
1. 按 `direct reuse → official API/library → thin Adapter → existing SEC owner → new implementation` 比较，优先最窄稳定 machine interface。
2. 只有 protocol/platform normalization、Effect/Permission bounding、credential isolation、version binding、Evidence/readback、batch/performance、compatibility/security 确有新增价值时才允许 Adapter。
3. 比较 semantic leakage、failure/recovery、portability、supply-chain、性能与长期 retirement 成本。
4. 缺 physical parity/benchmark 时选择 defer/evidence-needed，不猜测采用。

## 判断输出
- `capabilityDecision`：`direct-reuse | thin-adapter | provider-adopt | replace | reject | defer`、consumer、候选对比、adapterJustification、风险、Evidence refs、rollback/retirement 条件。

## 停止与回退
- 已能交给 package/provider/effect owner执行时停止。
- Provider事实或新 Evidence 推翻关键假设时重新裁决；不长期保留无 consumer 双实现。

## 禁止
- 不为 Git/GitHub/compiler/search/test/container 等成熟能力建立只改名字的一对一 SEC wrapper。
- 不把 presentation 文本、退出码、Provider success 或 AI解释提升为 SEC truth。
- 不修改 package/lock、credential、Provider state；没有 consumer/Evidence 时不引入。

## 语义权威（非自动读取）
以下只声明优先级；是否读取仍由当前 Read Plan 决定：
- `docs/external-provider-policy.md`
- `docs/governance/external-capability-ledger.yaml`
- 当前 capability 的 package/provider/security canonical owner
