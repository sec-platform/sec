---
title: Pass 状态机、错误码与恢复机制
status: active
last-reviewed: 2026-07-13
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

当前代码已经实现 parse/align/resolve/build-ir/compose/adapt/verify/repair/lock/emit；Semantic Frontend 内完成 workspace semantic input 的 local normalization，IR-owned Generator Plan / lowering 已进入 canonical 主链。逻辑 Pass 职责与物理 stage 不要求一一对应，不得为了匹配文档名称再建立平行 Pipeline 或第二套 lowering authority。

`compileWorkspace()` 中的物理 `semantic` stage 拥有 `build-ir` pass，严格位于 resolve 与 compose 之间。它执行 workspace semantic input load / local normalize、IR build、`validateEngineeringIR()`，并把结果绑定到当前 transaction 的 `PipelineSemanticContext`。不得用只存在于类型或单测中的 pass 伪造“已实现”。

普通 API / CLI / Workbench / CI transaction 每次使用新的 UUID identity。`source=reference` 是唯一例外：它使用 workspace-local 的命名 identity `tx:reference-workspace`，开始新一轮 reference compile 时替换 journal 中同名旧记录，完成后该记录就是当前真实 execution。这个可重放 identity 只用于消除受管 reference artifact 的随机漂移；不得在 Provenance 中删掉 transaction binding，也不得让普通 transaction 复用 identity。

Pipeline transaction 与 Semantic Mutation transaction 是两个不同的状态域。Semantic Mutation apply 不是 Pipeline pass；其跨进程 lease、同卷 staging/backup、durable recovery record、request replay 和 terminal retention 由 `docs/14-Engineering IR与语义事实规范.md` 第 18 节持有。不得复用 `pipeline-journal.json` 的进程内队列或“新 transaction 中断旧 transaction”语义冒充 Mutation lease/recovery。Mutation accepted 后仍必须复用现有 Pipeline registry 推导从 `resolve` 开始的失效与 canonical rebuild，不得维护第二张 pass order 表。

## 2. Pass 职责

| Pass | 输入 | 输出 | 性质 |
| --- | --- | --- | --- |
| parse | YAML/JSON/public source | typed authoring objects | deterministic |
| normalize | parsed sources | normalized semantic inputs | deterministic, Semantic Frontend 内执行 |
| align | Plan/Manifest/Contract | compatibility diagnostics | deterministic |
| resolve | Block dependency inputs | Lock/resolution state | deterministic |
| build-ir | normalized inputs + resolution | transaction-owned validated Engineering IR snapshot | deterministic |
| lower | validated IR selectors | generator/install plan | deterministic, IR-owned |
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

`build-ir` 失败由 Pipeline Kernel 记录为 failed，并把 compose/adapt/verify/repair/lock/emit 标为 blocked。Compose 的依赖是 `build-ir`，不再只依赖 resolve；新 transaction 必须重新执行 semantic stage，旧 transaction 的 in-memory snapshot 不得复用。Standalone `composeWorkspace()` 也会在同一 transaction 内自动执行 semantic stage，不能绕过 validated IR / Generator Plan boundary。

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

现有前缀继续保持；语义错误域包括：

```text
IR-SCHEMA-xxx
IR-IDENTITY-xxx
IR-FACT-xxx
IR-AUTHORITY-xxx
CONTRACT-SEMANTIC-xxx
LOWER-GENERATOR-xxx
SEMANTIC-MUTATION-xxx
```

错误码必须映射到稳定 issue type、message 和可选 diagnostics artifact。不要把原始异常字符串当机器合同。Semantic Mutation 的稳定 code 与 precedence 只由 `docs/14` 第 18.6 节维护。

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

IR 与 Projection 都应支持整体重建；不要把修补 canonical JSON 文件作为恢复方式。涉及 live Authoring Source publish 的 Semantic Mutation 恢复必须遵循独立 lease、byte CAS、verified rollback 和 durable recovery record；普通 Pipeline journal 或通用 JSON 覆盖写不构成该证明。
