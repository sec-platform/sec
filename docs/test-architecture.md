---
title: 测试架构
status: active
last-reviewed: 2026-07-04
---

# 测试架构

本文定义 SEC 仓库的测试层级、测试事实源和 Testkit 边界。CI lane 见 `test-feedback-and-ci-lanes.md`。

## 1. 稳定模型

测试架构固定为：

- 4 类反馈入口：affected、fast、slow、full。
- 4 个测试层：unit、contract、integration、e2e slow。
- 公共测试事实优先放在 `platform/shared/*-contract.ts` 或紧邻 production builder 的公共 Schema。
- Testkit 保持薄层，不引入第二套业务模型。

测试代码应读起来像规格：测试写不变量和场景，重复执行细节由 Testkit/Builder 统一。

## 2. 测试层

| 层 | 职责 | 禁止 |
| --- | --- | --- |
| `tests/unit` | 纯 Builder、Selector、Index、Formatter、安全边界 | 完整 Workspace/CLI/浏览器流程 |
| `tests/contract` | 公共 CLI/JSON/Package/CI/Error/IR Shape | 复制完整命令表、脚本对象、Slow Suite 列表 |
| `tests/integration` | Workspace Pipeline、Artifact Flow、IR/Projection 集成 | 大型浏览器矩阵 |
| `tests/e2e` | 明确的慢产品路径和单一浏览器 Smoke | 成为全部业务逻辑测试仓库 |

### IR 测试归属

- Entity/Fact ID、排序、引用完整性、revision digest、index：unit。
- IR public JSON/schema：contract。
- Plan/Lock/Manifest → IR → Projection：integration。
- Ticket observable runtime：unit/integration/API；只保留关键浏览器 smoke。

## 3. 事实源

主要事实源：

- `test-budget-contract.ts`：测试发现、fast/slow 分类、slow suite model。
- `test-impact-contract.ts`：变更到 affected test 的选择。
- `ci-contract.ts`：CI lane contract。
- `runtime-dependency-spec.ts`：生成运行时依赖。
- `*-schema.ts` / production contract builder：公共数据 shape。

规则：

- 测试不得复制 slow suite IDs、glob、完整 CI command array、完整 package scripts。
- 优先测试“count 与 list 一致、sorted unique、lane boundary、coverage invariant”等语义不变量。
- Import Graph 能表达的 impact 不再额外维护 semantic owner table。
- Cross-domain 风险才使用显式 semantic impact rule。

## 4. Testkit

当前核心 primitive：

- `tests/testkit/contracts.ts`：合同不变量。
- `tests/testkit/cli.ts`：CLI text/JSON/compact JSON。
- `tests/testkit/workspace.ts`：Workspace 场景创建、清理和 Pipeline。

新增 Testkit helper 的门槛：必须替换至少多个真实重复点、减少测试代码，或把一个公共不变量集中到唯一实现。

Testkit 不能自己维护 Product/IR Schema。

## 5. Playwright 边界

Playwright 只证明生成 Runtime 的浏览器 Smoke：

- Next App 能启动。
- 登录路径可用。
- 一个关键页面可打开。
- 一个租户隔离路径可通过浏览器验证。

业务状态机、Contract、Fact Delta 和 Impact 不放进浏览器矩阵。

## 6. 依赖策略

当前测试栈：

- Bun test。
- `bun:test` mocking。
- Zod 仅用于公共边界。
- ts-morph 用于 AST/import graph。
- Playwright 用于单一 Runtime browser smoke。
- Bun snapshot 只用于稳定协议 JSON。

不通过增加 Jest/Vitest/Sinon/happy-dom 等近义工具解决测试结构问题。

## 7. 新能力测试清单

任何新 compiler capability 至少检查：

1. 同输入是否确定性。
2. 重复执行是否幂等。
3. ID/排序是否稳定。
4. Invalid input 是否产生稳定错误域。
5. Public shape 是否可解析/序列化。
6. 是否意外复制事实源。
7. 是否需要 integration 闭环。
8. 是否扩大 slow/browser 边界。

## 8. 完成标准

- 测试表达不变量而不是复制实现。
- Testkit 只负责执行 primitive。
- Playwright 不进入 affected/fast。
- Slow suite 数据只由代码 Registry 维护。
- 改一个事实源不要求同步三份数组和文档。
