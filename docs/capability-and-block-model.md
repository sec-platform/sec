---
title: Registry、Block 与能力协议
status: stable
domain: capability-block
last-reviewed: 2026-07-28
---

# Registry、Block 与能力协议

本文拥有 Registry、Block、Capability、Port、Slot、Semantic Contract 与 Generator 的稳定关系。精确 manifest/schema/overlay 由 loader、types 和 tests 拥有。

## Block

Block 是分发、版本、信任、升级、资产和 Artifact Provenance 单位，不是默认架构理解单位。架构理解由 Responsibility、Operation、State、Contract、Effect 和 Fact 表达。

长期 Block 由 Manifest、Contracts、Generator declarations、Files、Tests 和 Migrations 组成。文件安装是兼容面和 escape hatch，不是语义母模型。

## Capability、Port 与 Slot

- Capability 表达 Block 级组合依赖，不承担完整状态和数据流。
- Typed Port 表达 event、data、command、query、policy、view 或 lifecycle 连接；连线进入 IR 后才成为 Fact。
- Slot 是有限、局部、可验证的扩展点，不是所有自定义代码的容器。增长为独立责任时提升为 Governed Source 或 Private Block。

## Semantic Contract

Contract 声明 Entity、Field、Responsibility、Operation、State、Transition、Event、Policy、Permission、Effect、Scenario 与 Acceptance。Cross-contract 引用必须显式 import 和 qualified identity；同名、共享 namespace 或 Provider 猜测不建立关联。

## Generator

Generator 按工程动作注册，只消费 validated semantic selector 和声明，输出 plan/artifact。Lowerer 不重新读取 raw Contract。每种 generator 配置使用 discriminated schema；专用字段不能提升为全局协议。

声明 Contract 不等于运行时已经执行 Contract。Runtime enforcement 必须消费同一生成/编译结果，并由正面和禁止场景验证。
