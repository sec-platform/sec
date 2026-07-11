---
title: 测试反馈与 CI 分层
status: active
last-reviewed: 2026-07-11
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

## 13. 验证证据复用账本

昂贵验证结果必须持久记录，不能因为后续出现新 commit 就无条件重跑。每条记录至少包含：

- tested head SHA、base SHA、profile 和 verification contract revision（已知时）。
- 命令或 Gate、覆盖范围、PASS / FAIL、duration 和原始 evidence 定位。
- 复用条件与失效条件。

旧结果不得伪装成新 head 的 exact-head 结果。A0 可以把“已验证 baseline + intervening diff 的影响判断 + 只覆盖 delta 的目标验证”组合为当前 integration state 的 trusted evidence；组合判断本身必须记录。只有 diff 触及 Gate 的输入、合同、选择器、运行时依赖或被覆盖语义时，该 Gate 才失效并需要重跑。

### 2026-07-11 P0-2A integration baseline

| Tested head                                                                                   | Evidence                                        | Gate / scope                                          | Result       | 复用与失效规则                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c324514d7a32b74e2b9f60d92155d8d218bf9cee`（base `37bc21fb6e503e62a00c2b072d02294ae8ed5261`） | GitHub run `29140910853`; artifact `8245260187` | imports                                               | PASS（4.2s） | 后续 diff 未改变 import 规则时可复用；变更源文件只需 changed-only check。                                                                                           |
| 同上                                                                                          | 同上                                            | typecheck                                             | PASS（7.9s） | 类型面变化时失效，只重跑 typecheck。                                                                                                                                |
| 同上                                                                                          | 同上                                            | docs-doctor                                           | PASS         | 文档变化时失效，只重跑 docs doctor。                                                                                                                                |
| 同上                                                                                          | 同上                                            | full-fast                                             | PASS（217s） | 后续 delta 已由对应 focused tests 覆盖且未改变 fast runner / selector / shared test infrastructure 时复用。                                                         |
| 同上                                                                                          | 同上                                            | test-budget                                           | PASS         | suite registry、预算合同或选择逻辑变化时失效。                                                                                                                      |
| 同上                                                                                          | 同上                                            | all-slow-risk                                         | PASS（830s） | slow implementation、fixtures、toolchain/runtime boundary 或选择合同变化时失效；纯 identity plumbing 由目标 seam tests 覆盖时不重跑。                               |
| 同上                                                                                          | 同上                                            | benchmark、dependency warmup                          | PASS         | benchmark 路径、预算、依赖锁或运行时安装边界变化时失效。                                                                                                            |
| 同上                                                                                          | 同上                                            | resolve / compose / adapt、verify-all、lock / explain | PASS         | 对应 pipeline stage、artifact schema 或 reference inputs 变化时，仅重跑受影响 Gate。                                                                                |
| 同上                                                                                          | 同上                                            | reference-check                                       | FAIL         | 失败限定为 6 个 ExplainGraph / Lock / Workbench reference artifacts 漂移；不否定其余 PASS Gate。刷新这些 artifacts 后必须在新 commit 上单独重跑 `reference:check`。 |

本 baseline 之后的 App identity delta 修改了 Lock / ExplainGraph identity 和 6 个 reference artifacts，因此只使 typecheck、App / ExplainGraph focused tests、docs / imports changed-only checks 与 reference-check 失效；full-fast、all-slow-risk、benchmark 和 dependency warmup 继续复用上述证据。
