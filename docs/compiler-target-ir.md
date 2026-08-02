---
title: 编译器与目标 IR
status: stable
domain: compiler-target-ir
last-reviewed: 2026-08-03
---

# 编译器与目标 IR

本文唯一拥有 **Compiler Pipeline、Target Profile、Type Algebra、Application IR、Behavior IR、Target Program IR、Backend、deterministic lowering 与 Compiler Incremental Graph**。Host Runtime、Toolchain Provider、package/distribution 和 Support Claim 只由 `docs/runtime-and-distribution.md` 拥有。

当前实现事实、字段定义、pass 名称、provider revision 和 byte-level algorithm 以代码合同、schema 与测试为准；本文只保存稳定边界。

## Pipeline

```text
parse → normalize → align → resolve → semantic/build-ir
→ lower/compose → adapt → verify → repair? → lock → emit
```

Pipeline Kernel 拥有 stage order、transaction、journal、cancellation 和 failure propagation。Pure builder/lowerer 不建立第二 coordinator。任何 downstream mutating stage只消费同一 transaction 的 validated semantic context。

每个阶段必须声明：

- typed input/output 与唯一 producer；
- raw → validated promotion boundary；
- authority、revision 与 invalidation owner；
- side effects、diagnostic、cache/rebuild 与 recovery；
- unknown/unsupported 如何 fail closed。

目录、函数名、Ticket 或 Customer 示例不构成编译合同。

## Target Profile

Target Profile 是**生成目标**的 canonical capability input。它不描述执行 SEC 的当前 Host，也不等于当前 Toolchain、package 或 deployment。

至少显式绑定：

- language 与 language revision；
- target runtime family/version range；
- module system、package manager 与 ABI；
- delivery/package/container form；
- persistence、network、thread/process、resource 与 Effect 能力；
- UI/server/browser能力；
- verification、deployment 与 platform requirements；
- profile revision、provider requirements 与 unsupported diagnostics。

未知字段、组合或 capability 必须在 lowering/emit 前拒绝。禁止从 `process.platform`、当前 Node/Bun、PATH、仓库模板或已有 generated output 推断 Target。

## Type Algebra

Type Algebra 唯一拥有跨层 type identity、canonical normalization、compatibility primitive、nullability、collection/object/function shape、serialization 与 Target mapping。

Promotion 前必须验证：

- identity/reference closure；
- recursive/cycle rule；
- canonical ordering；
- unsupported mapping；
- deep freeze 与 revision；
- source/provenance mapping。

Backend 不能按字符串名、业务名或当前 language service 重新猜类型。

## Application IR

Application IR 表达 target-independent 应用结构：component/service/module、Responsibility reference、State、Operation、Data、Policy、Permission、Effect、Scenario 与依赖。

Promotion 条件：

1. upstream Engineering IR/Contract 已 validated；
2. node 可追溯到 canonical Fact/Assertion；
3. ownership、lifecycle、state writer 与 public boundary 唯一；
4. unknown/opaque 不被自动补全；
5. identity/revision 不含 Target、临时路径、UI layout 或 wall-clock。

Application IR 只引用 Responsibility、Policy、Effect 等 owner 的 validated identity，不复制其定义。

## Behavior IR

Behavior IR 只表达 SEC 能完整验证和 lowering 的受限行为：control/data flow、state transition、Effect、error、authorization 与 transaction boundary。

允许进入的行为必须具有：

- typed input/output；
- 可枚举 Effect、permission 与 resource；
- deterministic transition/error protocol；
- target-independent verification oracle；
- complete source mapping。

任意反射、动态拼接、未知外部代码或无法建模的副作用进入 Governed Extension/Opaque Boundary。Extension 必须声明 interface、Effect、capability、source owner、Verification 和 rollback，不能为“支持一切”无限扩张 Core IR。

## Target Program IR

Target Program IR 表达 target-language 程序结构：package/module、import/export、declaration、type、statement、expression、annotation、resource/config binding 与 artifact ownership。

它只能消费 validated Application/Behavior IR、Target Profile、Type Algebra 和 Provider revision；不得重读 raw Contract 或按示例名补语义。

Promotion 条件：

- upstream reference 与 Target capability closure；
- unsupported-before-emit；
- module/artifact writer 唯一；
- symbol/import/export identity 确定；
- source map/provenance 完整；
- canonical ordering/revision 通过统一 validator。

## Backend

Backend 负责 Target AST、printer、formatter、typecheck invocation、package/config lowering 与最终 bytes。

同一 validated inputs、Target Profile、Provider revisions 与 compiler options 必须产生 byte-stable outputs。locale、timezone、CWD、临时绝对路径、Map/Set 插入顺序、Host family 和 wall-clock 不得污染 canonical bytes。

Formatter 不能改变语义；diagnostic 必须映射回 Target Program IR 与上游语义来源。

## Deterministic lowering 与单写者迁移

每层固定：

```text
raw builder
→ validator
→ branded validated snapshot
→ deterministic lowerer
→ source/provenance map
```

后层不得重新解释前层 authoritative semantics。

Legacy Generator 与新 IR lowering 在同一 artifact 上不得长期双写。迁移顺序：

```text
freeze artifact owner
→ shadow generate
→ byte/semantic/runtime parity
→ switch consumer
→ remove old writer/task/template
→ main readback
```

Parity 未闭合前只有原 writer 可发布；新路径只产生 Evidence。切换必须同步删除旧 writer、入口、测试映射和文档表述。

## Compiler Incremental Graph

Incremental Graph 只优化 clean deterministic chain。Node key 绑定：content、validated revision、pass/options、Target Profile 与 Provider revision。

要求：

- incremental path 经过相同 validator、fixed point、source mapping 与 unsupported rule；
- 相同输入与 clean result byte-equivalent；
- unknown dependency、read failure、schema/pass/provider change 只扩大 invalidation；
- cache 可删除、可重建、不成为第二语义或 Evidence owner。

## 与其他 owner 的接口

| 输入/输出 | 唯一 owner | Compiler 行为 |
| --- | --- | --- |
| Fact/Assertion/semantic revision | Semantic Model | 只消费 validated snapshot |
| Responsibility/Impact | Delta & Impact | 只引用 identity，不复制 projection algorithm |
| Mutation transaction | Semantic Mutation | Compiler lowerer不直接写 canonical source |
| Host/Toolchain/Package/Support | Runtime & Distribution | Target 只声明 requirements，不推断 Host |
| Verification truth | Verification Governance | 只发出 gate requirements，不创建 PASS |

## 验收

- Target Profile 与 Host Runtime 没有双 owner 或隐式推断；
- raw/validated边界和唯一 producer有机器合同；
- unsupported-before-emit；
- clean/incremental byte parity；
- round-trip、typecheck、runtime acceptance 与 negative scenario；
- 至少三组无关业务模型不修改 Core；
- Extension/Opaque 不被误标 canonical；
- 同一 artifact 没有竞争 writer。
