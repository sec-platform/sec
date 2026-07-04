---
title: 测试反馈与 CI 分层
status: active
last-reviewed: 2026-07-04
---

# 测试反馈与 CI 分层

本文是本地反馈、PR quick、PR risk、release/full 和 Package Script 边界的权威文档。

## 1. 目标

```text
本地小改动 → 快速得到相关反馈
PR 新提交   → 先给高信号 quick 结果
PR 风险     → 再跑 impact-selected 风险验证
发布/定时   → 完整 correctness backstop
```

不要用大量近义 package scripts 表达同一层级。

## 2. 本地入口

```bash
bun run check:affected
bun run test:affected
bun run check:fast
bun run check:full
bun run imports:organize
```

`affected` 只选择相关 fast tests；未知映射产生 notice，不自动膨胀为全部 slow/full。

## 3. PR Quick

职责：最快发现当前提交的 TypeScript 和受影响 fast test 问题。

逻辑：

```text
install frozen dependencies
→ organize changed imports
→ typecheck
→ affected fast tests
```

Quick 不默认跑 slow e2e，不使用 broad fast fallback，除非显式开启现有 fallback 环境变量。

Affected selector 默认关注最近提交反馈，避免大型 PR 的每个小修复都重新扩张到整个 PR diff。

## 4. PR Risk

职责：处理 PR 范围的合同、Workspace 和 slow impact 风险。

逻辑：

```text
contract freeze if impacted
→ impact-selected slow suite/files
→ workspace fast gate
```

PR Risk 不无条件执行所有 slow suites，也不默认执行 `verify --lane all`。

Engineering IR/Fact/Projection 公共类型、Builder、Schema、Artifact Path 变化应进入 Contract Freeze 或对应风险选择规则。

## 5. Release / Full

职责：最终 correctness backstop。

```text
preflight
→ contract freeze
→ slow suite matrix
→ benchmark/runtime dependency checks
→ full workspace compile/verify/lock/explain
→ reference drift
→ final summary
```

触发方式由 GitHub Workflow 事实源决定。文档不复制完整 Workflow YAML。

## 6. Diff Base

分开两个责任：

```text
SEC_CHANGED_BASE
  PR 范围，用于 contract/workspace risk。

SEC_AFFECTED_TESTS_BASE
  最近提交范围，用于快速 affected feedback。
```

不要只用 `HEAD^1..HEAD` 判断整个 PR 的合同风险；也不要默认用整个 PR diff 选择每次 affected test。

## 7. Contract Freeze

Contract Freeze 保护机器或开发者依赖的稳定面，例如：

- CLI public command/JSON。
- package public surface。
- error protocol。
- CI/test budget contracts。
- Artifact path contract。
- Engineering IR public schema（正式冻结后）。
- Semantic View/Mutation public schema（正式冻结后）。

新增 Contract Test 必须接入 Contract Freeze target source。Target 列表以 `contract-freeze-contract.ts` 为事实源。

## 8. Affected Test 选择

按三层：

1. 直接变更 test：运行相关 fast test；slow test 进入风险提示。
2. 自动源码引用：扫描 import/明确 repo path reference。
3. 小量 Cross-domain Semantic Rule：只表达 import graph 无法表达的产品风险。

缺少 mapping 时给清晰 notice。不要因为 selector 不完整就把 PR Quick 变成 Full。

v0.4 后可将 Fact Impact 作为第四类选择 Evidence，但在 Impact Engine 稳定前不得用低置信 inferred fact 跳过 correctness backstop。

## 9. Slow E2E

Slow E2E 有价值，但不属于 PR Quick 默认路径。

失败只分两类：

- 真实实现回归：修实现。
- 预期行为已明确改变：更新 assertion。

禁止为了 CI 变绿直接删除 Slow Test。

## 10. Package Script 边界

`package.json` 是 script value 事实源。文档和测试不复制完整 script object。

稳定人类入口族：

```text
sec
dev
typecheck
test:*
check:*
imports:*
```

复杂 orchestration 放在 dev-runner、CI scripts 或 shared contract builder。

## 11. 日志

每个 CI Gate 输出：

- gate id。
- started/finished。
- duration。
- exit code。
- selector reason（如适用）。

GitHub Actions 使用 group 展开边界，失败日志必须能快速定位负责 Gate。

## 12. 大改动模式

大规模重构：

```text
在独立分支形成逻辑提交
→ 先跑 affected/typecheck/docs doctor
→ 推送 PR
→ 读取远端 CI 的具体 Gate 日志
→ 按失败根因修复
→ full backstop
```

不要在不理解失败来源时连续堆补丁，也不要让文档指向已经删除的合同文件。
