---
title: Engineering IR 语义模型
status: stable
domain: semantic-model
last-reviewed: 2026-07-28
---

# Engineering IR 语义模型

本文拥有 Engineering IR 的概念模型、身份、authority 和 validated boundary。精确 TypeScript shape、Predicate signature、diagnostic 和 digest payload以 `platform/shared/engineering-ir/**`、`platform/compiler/ir/**` 及合同测试为唯一事实源。

## 模型

Engineering IR 是有向、强类型、属性多重图，不是 AST、调用图、ExplainGraph、Workbench View Model 或 AI Knowledge Graph。

- Entity 表达稳定工程对象。
- Fact 表达规范化 triple：`subject --predicate--> object`。
- Assertion 表达某个来源对该 exact triple 的独立声明。
- Scenario 是由 canonical Entities/Facts 确定性重建的只读 cache，不是第二声明入口。

同一 triple 只有一个 Fact；不同 authority、provenance 和 Evidence 作为多个 Assertions 保留，禁止 strongest-wins 熔合。

## 身份与 revision

Entity、Fact 和 Assertion identity 必须确定性、与显示 label 和数组位置分离。输入声明 revision 与最终语义图 revision 是不同域，不能折叠。时间戳、绝对路径、UI 布局和 execution identity 不得污染 semantic identity。

## Authority

Assertion authority 分为 authoritative、derived、observed、inferred。Authority 是权力层级，不是概率；`inferred confidence=1` 不能覆盖 authoritative claim。冲突由 predicate/source policy 和 graph-context validator处理，Projection 不自行裁决。

## Predicate 与验证

Predicate shape 由唯一 registry total-check；预留但无 producer 的关系不能进入 canonical Facts。Builder、validator、index 和 consumers 不得各自复制 predicate switch。

Raw IR 仍是不受信计算结果。只有统一 validator 校验 identity、排序、引用、signature、derived cache 和 revisions 后，才能签发 deep-frozen validated snapshot。所有 IR-native consumer 只接受该 branded boundary。
