---
title: 外部 Provider 政策
status: stable
domain: external-provider
last-reviewed: 2026-07-28
---

# 外部 Provider 政策

本文拥有外部工具、MCP、编译器基础设施和分析 Provider 的 authority、安全、引入与退役政策。具体候选、版本、路由和复核状态只存在于 `docs/governance/external-capability-ledger.yaml`。

## 定位

外部能力只能是 Core substrate、replaceable Provider、Adapter、Workbench projection、test/fixture tool、project utility 或 rejected/superseded。它不能拥有 Engineering IR、identity、actual Delta、publish decision 或 source writer。

## 引入流程

```text
明确问题 → 主来源研究 → 能力拆分 → SEC owner mapping
→ security/license/data boundary → SEC + Nexus A/B
→ 决策 → 集成/吸收 → 删除重复 → 版本固定
→ revalidation / retirement
```

禁止先选工具再找用途，也禁止多个功能重叠的 standing MCP 同时暴露给 Agent。

## Evidence

Provider 输出必须绑定 provider/source revision、coverage、freshness、diagnostics 和 unresolved regions。源码 bytes只证明物理内容；AST/graph是derived/inferred；runtime trace只对应具体环境；LLM摘要永不直接升格。Predicted impact、planned Impact、actual Delta 和 Verification safety是四种不同对象。

## 安全

MCP server和native dependency视为高权限代码；必须固定版本、明确网络/telemetry/source upload/credential、限制写权限和输出。工具失败不得改变 canonical semantics；需要执行不受信代码时必须有独立 sandbox authority。

## 退役

重大版本、license、安全事件、重复 stale、原生能力替代或无真实 consumer会触发复核。退役必须同时移除入口、配置和重复实现，并保留必要 Evidence/迁移记录。
