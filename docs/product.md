---
title: 产品目标与系统边界
status: stable
domain: product
last-reviewed: 2026-07-28
---

# 产品目标与系统边界

本文只拥有 SEC 要解决的问题、用户价值、非目标与长期成功判据。实现状态、路线顺序和字段合同分别由 `main`、`docs/roadmap.md` 与代码拥有。

## 问题

大型软件的工程知识分散在源码、测试、配置、运行时行为和开发者经验中。文件与函数是必要实现载体，但不足以表达能力边界、责任、状态所有权、权限、Effect、验收、来源、迁移和影响。

SEC 的核心命题是：

> 把隐式工程知识提升为可声明、可组合、可推导、可验证、可追踪并可安全变更的工程语义。

## 产品结果

用户可以声明产品意图和工程合同，或导入既有 workspace；SEC 建立 canonical 工程状态，并确定性地产生源码、测试、文档、Gate、Agent、Release 和 Evidence 投影。

核心价值只有三类：

- 降低理解成本：直接查看 Responsibility、State、Contract、Effect、Impact 和 Evidence。
- 降低实现成本：以 Block、Contract、Generator 和受限扩展复用能力。
- 降低维护成本：以 stable identity、Fact Delta、Verification、Migration 和 Recovery 控制漂移。

## 核心单位

- **Block**：分发、版本、信任、升级和资产封装单位。
- **Semantic Responsibility**：架构理解和状态/行为责任单位。
- **Semantic Fact**：最小 canonical 工程陈述。
- **Governed Source / Opaque Boundary**：无法完全结构化时保留真实源码和显式边界，不伪装为已理解。

## 非目标

SEC 不是通用 IDE、低代码私有运行时、模板市场、单纯代码知识图或自由式 AI 编码器。源码不会消失；变化的是工程权威与主要操作不再完全依赖源码反推。

## 永久边界

- AI、Workbench、CLI 和 Provider 不直接写 canonical IR。
- Projection、报告、图和 Evidence 不反向成为事实源。
- 新同类业务模型不得要求 compiler core 增加业务名称分支。
- unknown、ambiguous、stale、conflicted 和 opaque 必须显式。
- 任何自动写入都必须有唯一 owner、授权边界、Verification 和 rollback/recovery。

## 成功判据

SEC 成功时，同一 workspace facts 能驱动多个确定性投影；新增常见能力主要增加 Contract/Block/Adapter；变更前可计算影响，变更后可验证 actual Delta；AI 只在小而明确的 Context Packet 和权限交集内操作。
