---
title: Workbench 与 AI 操作边界
status: stable
domain: workbench-ai
last-reviewed: 2026-07-28
---

# Workbench 与 AI 操作边界

本文拥有 Workbench、Semantic View、Context Packet、Task Envelope 和 AI bounded operator 的产品边界。Canonical Mutation、IR 与 Verification 仍由各自领域拥有。

## 权力关系

Platform 拥有 canonical state、policy、任务选择和授权；AI 只提交 proposal；Compiler 重建事实；Verification 接受或拒绝。AI confidence、Provider related files 和 Context Packet 都不能扩大权限。

## Workbench

Workbench 是本地理解、Review 和受控操作面，不是 IDE 或低代码运行时。Architecture、Scenario、Data、State、Contract、Effect 和 Impact 是同一 canonical state 的不同 projection。UI 可以聚合、布局和标注，但必须保留 Fact/Evidence reference，不能反向写 IR。

## Context 与任务

Context Packet 是任务的只读最小充分投影。Task Envelope 约束 operation、target、path、must-preserve、forbidden effects、Verification 和 budget。只有结构化上下文不足时才下钻相关源码，不能默认整仓扫描。

## 操作

Workbench、CLI 和未来 AI caller 必须消费同一个 product adapter 与 Semantic Mutation facade：

```text
transport DTO → trusted product policy
→ canonical plan/apply/query/recover
→ product result projection
```

Transport 不计算 source owner、risk、Delta、Impact、Verification 或 terminal state。Local HTTP 写入面必须限制 loopback/origin/host/capability，并在读取 workspace 前拒绝跨站或伪造请求。
