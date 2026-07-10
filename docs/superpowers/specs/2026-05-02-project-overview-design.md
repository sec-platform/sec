# Project Overview 设计记录（历史）

> 状态：historical。本文记录 2026-05-02 的 Overview 设计决策，不维护当前规范事实。

## 当时的问题

Workbench、CLI 和 AI 需要读取多个分散治理 Artifact，缺少统一的只读项目入口。

## 当时的决策

建立共享 `ProjectOverview` builder，由 CLI 与 Workbench 同时消费；Overview 只聚合已有治理 Artifact，不写 Authoring Source，不引入第二 Graph Schema，不把外部 Tool Evidence 升级为 canonical fact。

## 保留的架构结论

- Shared Builder 是单一计算点。
- CLI/UI 不重复 Review 逻辑。
- Overview 是 Projection/Navigation，不是事实源。
- Optional Evidence 缺失不阻塞 Overview。

## 当前权威

- 总体架构：`docs/02-工程编译器-MVP-PRD与架构稿.md`
- Explain/Review/Evidence：`docs/08-Verification、Provenance与Graph规范.md`
- Workbench/Projection：`docs/11-Workbench与可视化规范.md`
- Engineering IR：`docs/14-Engineering IR与语义事实规范.md`

实现状态和字段请读取当前 TypeScript 类型与上述规范，不使用本历史记录作为实现依据。
