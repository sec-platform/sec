---
title: 测试与 Package 架构历史记录
status: historical
last-reviewed: 2026-07-04
---

# 测试与 Package 架构历史记录

本文仅保留测试架构重构的历史入口，不维护当前事实。

当前权威：

| 主题 | 文档 |
| --- | --- |
| 测试层级、事实源、Testkit、Playwright 边界 | [test-architecture.md](test-architecture.md) |
| 本地反馈、PR Quick/Risk、Release/Full、Package Script 边界 | [test-feedback-and-ci-lanes.md](test-feedback-and-ci-lanes.md) |
| Slow Suite 运行和分片 | [slow-suite-registry.md](slow-suite-registry.md) |
| 生成项目 Verification、Provenance、治理投影 | [08-Verification、Provenance与Graph规范.md](08-Verification、Provenance与Graph规范.md) |

历史结论：测试事实列表不应复制到多个测试、Workflow 和 Markdown；稳定列表由 `platform/shared` 合同维护，测试只验证公共 Shape 与不变量。
