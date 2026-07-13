---
name: sec-work-package-plan
description: "为跨模块、高风险或多里程碑 SEC 变化创建或更新唯一 Work Package 执行计划；小型局部修复或单文件文档修改通常不要触发。"
---

# SEC Work Package Planning

本 Skill 把证据驱动的工程变化写成可持续执行计划。计划方法以根 `PLANS.md` 为准。

## 前置条件

1. 先执行同等强度的 repository audit，绑定 exact `main`、base/head、PR/Issue、review 和 evidence。
2. 读取 `docs/00`、`docs/03`、`docs/04` 与相关 `05–14`/测试 authority。
3. 确认当前没有另一份 active plan 拥有同一 Work Package 或 canonical surface。

## 计划位置

只创建或更新：

```text
docs/work-packages/<id>.md
```

从 `docs/work-packages/_template.md` 建立新计划，删除无关占位内容；不得在 Issue、PR body、聊天、`AGENTS.md` 或另一个目录复制完整执行计划。

## 计划内容

计划必须满足 `PLANS.md`，至少包含：

- frontmatter、Work Package ID、Issue、branch、PR、当前 phase；
- authority 边界与明确的非权威声明；
- exact current evidence、已确认事实、未确认项和失效证据；
- 单一目标结果、scope、non-goals；
- canonical owner、owned files/symbols、forbidden scope；
- identity/revision/determinism、state/lifecycle、error/recovery、compatibility、permission、provenance 不变量；
- 按 prerequisite 排序的实现 DAG；
- 每个里程碑的 acceptance、required evidence、reconciliation point；
- 验证矩阵和 evidence invalidation；
- risk、rollback/recovery、merge 和 closeout；
- Progress 与 Decision Log。

## 审查

可并行使用：

- `architecture-reviewer`：authority、ownership、dependency、state/recovery；
- `verification-evidence-reviewer`：Gate coverage、证据复用和最小 rerun；
- `integration-reviewer`：跨模块接缝和最终退出条件。

Reviewer 只读；计划文件保持单写者。

## 完成标准

计划只有在 exact refs、authority、ownership、DAG、验证与失败路径足以让第三方独立继续执行时，才能进入 `ready`。仍需产品或架构裁决的项不得伪装成实现步骤。
