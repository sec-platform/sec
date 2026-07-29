---
title: 编译器与目标 IR
status: stable
domain: compiler-target-ir
last-reviewed: 2026-07-29
---

# 编译器与目标 IR

本文拥有 Semantic Frontend、Pipeline、Target Profile、Type Algebra、Application/Behavior/Target Program IR、Backend 与 deterministic lowering 的职责边界。当前实现事实以 `main` 代码和适用合同测试为准。

## Pipeline

```text
parse → normalize → align → resolve → semantic/build-ir
→ lower/compose → adapt → verify → repair? → lock → emit
```

Pipeline Kernel 拥有 stage order、transaction、journal、cancellation 和 failure propagation。Pure builder/lowerer 不建立第二 coordinator。任何 downstream mutating stage只消费同一 transaction 的 validated semantic context。

每个阶段必须声明：输入/输出类型、唯一 producer、raw/validated boundary、读取 authority、副作用、diagnostic、cache/invalidator owner 与 recovery。Stage 名称和目录结构本身不构成合同。

## Target Profile

Target Profile 是生成目标的 canonical capability 输入，与执行 SEC 的 Host Runtime、仓库 Toolchain Provider 和可选 native adapter 分离。至少显式描述：

- language 与 language revision；
- runtime family/version range；
- module system 与 package manager；
- delivery/package/container；
- persistence、network、thread/process与resource能力；
- UI/server/browser能力；
- verification、deployment与platform requirements。

未知字段、未知组合或缺失 capability 确定性拒绝，不回退到当前 Host、默认框架或已有模板。

## Type Algebra

Type Algebra 拥有跨层类型 identity、canonical normalization、compatibility、nullability、collection/object/function shape、serialization 与 Target mapping。

进入 validated Type Algebra 前必须通过：唯一 identity、引用完整性、递归/循环规则、稳定 ordering、unsupported diagnostic 与 deep-freeze。Backend 不能按字符串名称重新猜类型。

## Application IR

Application IR 表达目标无关的应用结构：component/service/module、Responsibility、State、Operation、Data、Policy、Permission、Effect、Scenario 与依赖关系。

Promotion 条件：

1. upstream Engineering IR / Contract 已 validated；
2. 每个 Application node 可追溯到 canonical facts/assertions；
3. ownership、lifecycle、state writer 与 public boundary 唯一；
4. unknown/opaque 不被自动补全；
5. identity/revision 不含 Target、临时路径、UI布局或运行时间。

## Behavior IR

Behavior IR 只表达 SEC 能完整验证和 lowering 的受限行为，包括控制流、数据流、state transition、effect、error、authorization 与 transaction boundary。

允许进入的行为必须有：

- 明确输入/输出与类型；
- 可枚举 Effect 与权限；
- 确定性状态转换和错误协议；
- Target-independent verification oracle；
- 可追溯 source mapping。

复杂算法、动态反射、运行时拼接、任意外部代码或无法建模的副作用进入 Governed Extension 或 Opaque Boundary。扩展必须声明接口、Effect、capability、source owner、Verification 和 rollback；不能为了“支持一切”无限扩张 Behavior IR。

## Target Program IR

Target Program IR 表达目标语言程序结构：package/module、import/export、declaration、type、statement、expression、annotation、resource/config binding 与 artifact ownership。

它只消费 validated Application/Behavior IR、Target Profile、Type Algebra 和 Provider revision；不得重新读取 raw Contract 或按业务名称补语义。

Promotion 条件：

- 所有上游引用和 Target capability 已解析；
- unsupported 已在 emit 前拒绝；
- module/artifact ownership 唯一；
- import/export与symbol identity确定；
- source map/provenance完整；
- canonical ordering与revision通过统一 validator。

## Backend

Backend 负责 Target AST、printer、formatter、typecheck、package/config lowering 与最终 bytes。Formatter 不能改变程序语义；Backend diagnostic 必须映射回 Target Program IR 和上游语义来源。

同一 validated inputs、Target Profile、Provider revisions 与 compiler options 必须产生 byte-stable outputs。locale、timezone、cwd、绝对临时路径、Map/Set插入顺序、Host family和wall-clock不得污染 canonical bytes。

## Deterministic Lowering

每层具有独立：

```text
raw builder → validator → branded validated snapshot
→ deterministic lowerer → source/provenance map
```

后层不得重新解释前层 authoritative semantics。Lowering rule 以类型和 capability分派，不按 Ticket、Customer 或其他示例名称分支。至少三组无关业务模型用于反特化验证。

## 单写者迁移

Legacy Generator 与新 IR lowering在同一 artifact上不得长期双写。迁移顺序固定：

```text
freeze artifact owner
→ shadow generate
→ byte/semantic/runtime parity
→ switch consumer
→ remove old writer/task/template
→ main readback
```

Parity 未闭合前只有原 writer 可发布；新路径只产生 Evidence。切换后旧 writer、入口、测试映射和文档必须一起退役。

## Incremental Compilation

Compiler Incremental Graph 只优化上述 clean deterministic chain：node key 绑定真实 content、validated revision、pass/options、Target Profile 与 Provider revision。Incremental path必须经过相同 validator、fixed-point、source mapping和unsupported规则。

任何 incremental result 都必须与相同输入的 clean result byte-equivalent。未知依赖、read failure、schema/pass/provider revision变化只扩大失效；cache状态可删除、可重建且不成为第二语义。

## 验收

- raw/validated边界和唯一producer有机器合同；
- unsupported-before-emit；
- clean/incremental byte parity；
- round-trip/typecheck/runtime acceptance与negative scenarios；
-三组无关模型不修改Core；
-Extension/Opaque区域不被误标为canonical；
-同一artifact没有竞争writer。
