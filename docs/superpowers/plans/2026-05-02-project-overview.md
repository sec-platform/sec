# Project Overview 实施计划（历史）

> 状态：historical。原任务已进入代码和当前治理体系；本文不维护 checkbox、文件列表或当前测试事实。

## 历史目标

为 CLI 和 Workbench 提供共享 Project Overview，聚合 Lock、ExplainGraph、Provenance、Verification、Policy、Coverage、Artifact、Repair/Upgrade 和 Review 摘要。

## 已保留的工程原则

- Builder 计算与 IO 分离。
- CLI/Workbench 消费同一对象。
- View Template 不计算独立 Review 语义。
- Optional Tool Evidence 不成为 Contract Freeze 前置。

## 当前权威

Overview 的当前行为以 production types/builders/tests 为准；架构边界见 `docs/08-Verification、Provenance与Graph规范.md` 和 `docs/11-Workbench与可视化规范.md`。

后续工作不继续维护本文的旧任务步骤。
