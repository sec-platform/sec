---
title: Fact Delta 与 Impact
status: stable
domain: delta-and-impact
last-reviewed: 2026-07-28
---

# Fact Delta 与 Impact

本文拥有语义变化与影响传播的稳定含义。精确 union、diagnostic、排序和 revision payload由 `platform/shared/engineering-ir/delta-types.ts`、Compiler producers 和合同测试拥有。

## Fact Delta

Fact Delta 比较两个 transaction-referenced validated endpoints，只描述 canonical Fact/Assertion 变化。它不是完整 snapshot diff，也不是 Authoring、Impact、Mutation、Projection 或 artifact authority。

- Triple/object 变化表现为旧 Fact removed 与新 Fact added。
- Authority/provenance 变化表现为 Assertion remove/add。
- Confidence/Evidence 变化表现为 retained Assertion update。
- Entity-only 变化允许 Fact Delta 为空；空 Delta 不等于无影响。

Producer 必须保留 from→to 方向、校验 lineage 和 canonical payload，并确定性输出、deep-freeze，不修复输入。

## Impact

Impact 同时消费 canonical Delta 和两端 validated graph。它从变化 seed 沿版本化传播规则计算 direct/transitive occurrences、unknown frontier 与 Verification recommendation。

- Addition 只遍历新端，removal 只遍历旧端。
- inferred/observed-only relation 不升级为 definite transitive edge。
- 未注册 active predicate 形成 unknown frontier，不按名称猜方向。
- Cycle 正常收敛到有限 fixpoint；canonical path 保留最短且稳定的单一 witness。
- Impact 只推荐 Acceptance 或 selector，不解释为测试文件、不执行 Gate。

Workbench、Review、Mutation 和 changed-file test selection 都不得建立第二个 Delta comparator 或 Impact producer。
