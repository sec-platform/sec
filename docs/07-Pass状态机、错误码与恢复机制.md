---
title: Pass 状态机、错误码与恢复机制
status: active
last-reviewed: 2026-07-04
---

# Pass 状态机、错误码与恢复机制

本文定义 Compiler Pass 的职责、依赖、失败语义和恢复边界。

## 1. Pass 模型

目标管道：

```text
parse
→ normalize
→ align
→ resolve
→ build-ir
→ lower/compose
→ adapt
→ verify
→ repair? / upgrade?
→ lock
→ emit
```

当前代码已经实现 parse/align/resolve/compose/adapt/verify/repair/lock/emit；`normalize`、`build-ir` 和正式 `lower` 是 v0.3 演进目标。

在正式接入 orchestrator 前，IR builder 可以作为 resolve 之后的独立纯函数被测试和投影消费。不得伪造 passStatus 中不存在的 pass 为“已实现”。

## 2. Pass 职责

| Pass | 输入 | 输出 | 性质 |
| --- | --- | --- | --- |
| parse | YAML/JSON/public source | typed authoring objects | deterministic |
| normalize | parsed sources | normalized semantic inputs | deterministic, planned |
| align | Plan/Manifest/Contract | compatibility diagnostics | deterministic |
| resolve | Block dependency inputs | Lock/resolution state | deterministic |
| build-ir | normalized inputs + resolution | Engineering IR | deterministic, active development |
| lower | IR selectors | generator/install plan | deterministic, planned |
| compose | current install/lowering plan | project artifact | deterministic/reentrant |
| adapt | bounded synthesis task | governed source/runtime materialization | AI may participate |
| verify | artifact + contract + policy | evidence/diagnostics | read-only semantics |
| repair | structured failure | bounded repair proposal/apply | AI may participate |
| lock | accepted state | locked revision/state | deterministic |
| emit | canonical/governance state | projection/artifact | deterministic projection |

## 3. 状态

通用状态：

```text
pending → running → succeeded
                  ↘ failed
                  ↘ blocked
                  ↘ skipped
```

- `failed`：Pass 已执行但不满足合同。
- `blocked`：前置条件不成立。
- `skipped`：功能未启用或当前分支无需执行；不得用 skipped 隐藏失败。
- 重试前必须确认 Pass 是否可重放以及外部 Effect 是否幂等。

## 4. 失败传播

- parse/normalize/align/resolve/build-ir 失败：停止后续语义管道。
- lower/compose 失败：不得进入 adapt/verify；允许在安全 IO 边界重试。
- adapt 失败：Task 失败，不自动扩大 Context 或权限。
- verify 失败：生成结构化 Failure Point；满足 repairability 时进入 repair。
- repair 失败：保留原失败，不覆盖原始 Evidence。
- lock 只接受允许锁定的状态。
- emit/projection 失败不能回写 canonical state。

## 5. Issue 分类

| Issue | 典型来源 | 默认责任 |
| --- | --- | --- |
| Spec | Authoring/Contract 冲突 | 用户/显式 Mutation |
| Semantic | Fact conflict、identity、authority、IR invariant | Semantic Frontend/IR |
| Composition | dependency、generator、install、lowering | Compiler/Block |
| Synthesis | Slot/AI 输出不满足 Task | bounded AI/repair |
| Verification | test/policy/acceptance/drift | Verification/repair |
| Kernel | performance/correctness/external runtime | Maintainer |

## 6. 错误码

格式：

```text
<DOMAIN>-<CATEGORY>-<NUMBER>
```

现有前缀继续保持；v0.3 新增语义错误域时使用：

```text
IR-SCHEMA-xxx
IR-IDENTITY-xxx
IR-FACT-xxx
IR-AUTHORITY-xxx
CONTRACT-SEMANTIC-xxx
LOWER-GENERATOR-xxx
```

错误码必须映射到稳定 issue type、message 和可选 diagnostics artifact。不要把原始异常字符串当机器合同。

## 7. IR 构建失败

以下必须 hard fail：

- duplicate semantic entity id 且定义不一致。
- duplicate fact id 且内容不一致。
- fact 引用不存在的 subject/object entity。
- authoritative facts 发生不可调和冲突。
- invalid predicate/object kind combination。
- revision/validity range 非法。

以下默认只产生 diagnostics/evidence：

- inferred fact 与 authoritative fact 冲突。
- provider evidence stale/partial。
- static analysis 无法解析调用。
- runtime evidence 不完整。

## 8. 恢复原则

恢复不是“继续跑”。每次恢复必须明确：

- 从哪个 accepted revision 开始。
- 哪个输入发生变化。
- 哪些 Pass 需要失效重算。
- 哪些 artifact 可删除重建。
- 哪些外部 Effect 不可重放。

IR 与 Projection 都应支持整体重建；不要把修补 canonical JSON 文件作为恢复方式。
