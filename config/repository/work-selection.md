---
title: 当前 Work Selection Catalog
status: active
domain: current-control
---

# 当前 Work Selection Catalog

本文件是现行 WorkSelection 与 document-control consumer 的机器控制投影，只拥有当前 catalog。稳定能力节点、进入/退出条件和产品完成边界由[实施主线](../../docs/演进/实施/主线前沿与准入.md)拥有；此处的工作记录不构成另一套产品规范。

| Catalog责任 | 唯一owner |
| --- | --- |
| capability语义、依赖与退出合同 | [实施主线](../../docs/演进/实施/主线前沿与准入.md) |
| catalog schema、strict parser与consumer contract | WorkSelection live contract owner |
| 当前items及其排序输入 | 本current-control projection |
| 字段/引用迁移、reader切换与旧generation退役 | [兼容迁移](../../docs/演进/兼容迁移与退役.md)与上述两个owner |

字段名、字符串值和本文件位置都不产生ownership。当前catalog中的`stageRef`与`roadmap:r14/*`只属于待原子迁移的旧control schema address，不得被稳定设计、测试或新consumer解释为capability identity；目标合同以`capabilityRef`引用semantic capability node，并在writer/parser/全部consumer同一cutover后删除旧字段和旧引用，不保留alias或双读。

### 现行 `capability.agent-operation-verification` 工作选择投影

以下块仍被现行 WorkSelection 与 document-control consumer 读取，因此在迁移完成前必须保持机器可读。它是运行期工作目录的过渡载体，不是稳定 capability DAG；只能由唯一 renderer 原子更新，不得手工成为第二 roadmap。终态是由 canonical work records 编译独立 runtime projection，再将本块及 roadmap reader 一次性退役。

<!-- sec-work-selection-roadmap-catalog-v1:begin -->
```json
{
  "schema": "sec-roadmap-work-catalog-v1",
  "stageRef": "r14-agent-operation",
  "items": []
}
```
<!-- sec-work-selection-roadmap-catalog-v1:end -->
