---
title: SEC-TS 多层 IR 与确定性 Lowering 规划
status: active
last-reviewed: 2026-07-22
---

# SEC-TS 多层 IR 与确定性 Lowering 规划

本文是 TypeScript 第一目标下 **Target Profile、Semantic Type Algebra、Application IR、Behavior IR、TypeScript Program IR 与通用 Lowering** 的唯一规划 owner。现有 Engineering IR、Entity/Fact/Assertion、revision、Fact Delta、Impact 与 Semantic Mutation 合同仍由 `docs/14-Engineering IR与语义事实规范.md` 独占；本文不复制或修改这些合同，也不把规划写成已实现能力。

## 1. 分层目标

```text
Validated Engineering IR Snapshot
        + Validated Target Profile
        + Semantic Type Algebra
                    ↓
             Application IR
                    ↓
              Behavior IR
                    ↓
        TypeScript Program IR
                    ↓
    Validated SEC-TS Compilation Snapshot
                    ↓
      TypeScript AST / printer / typecheck
                    ↓
       Source / Test / Adapter projections
```

每一层只回答一种问题：

| 层 | 唯一职责 | 明确不负责 |
| --- | --- | --- |
| Engineering IR | 系统意味着什么、哪些事实成立 | 组件布局、目标语法、框架 glue |
| Target Profile | 本次编译允许使用哪些语言、运行时与交付能力 | 业务语义、源码模板、项目特例 |
| Type Algebra | 类型身份、归一、兼容和目标映射 | Entity/Fact authority、任意 TypeScript AST |
| Application IR | 需要哪些应用组件及其稳定关系 | TypeScript statement/expression |
| Behavior IR | SEC-TS v1 可表达的受限行为 | 任意算法或框架专用语法 |
| TypeScript Program IR | module、declaration、statement、expression 与 source binding | 重新解释业务语义 |
| Backend | AST、printer、format、typecheck 和 bytes | 决定权限、Effect、Policy 或 Verification |

现有 generator、template、`CodeBuilder` 输出或 `project/**` 文件都不能因能生成 TypeScript 而被称为上述任一 canonical IR。

## 2. Target Profile

Target Profile 是编译目标能力的唯一结构化边界，替代单字符串 stack 和散落在 manifest/template/runtime 分支中的选择。首版至少分离：

- language 与 language revision；
- runtime；
- module system；
- delivery；
- persistence；
- database；
- UI；
- verification adapter；
- deployment target。

Profile 必须有独立 format revision、validator、canonical ordering、identity、digest 和 deep-freeze。组合合法性由版本化 compatibility rules 决定；未知组合 deterministic reject，不允许降级成默认 Next.js、Prisma、SQLite 或 Bun。Nexus 的 Bun、SPECTRA、HALO、Chrome、WebAudio、locale 与路径只能作为 Profile value、Policy Pack、Adapter 或 fixture，不能成为 Core 分支。

Target Profile 的迁移面必须逐项裁决：legacy `PlanApp.stack`、Manifest `stackProfiles`、`SUPPORTED_STACK` 及 parser/resolver/template/runtime consumers 只能作为 bounded import/compatibility projection，最终不得与 structured Profile 双写目标选择。Repository IR 的 host `ToolchainProfile`（实际 Bun/Node/TypeScript/package-manager/dependency generation）继续由 Repository domain 持有；host toolchain 升级不自动改变 target revision，target capability 改变也不改写 toolchain revision，两者仅由显式 compatibility validator 连接。

## 3. Semantic Type Algebra

首版类型集合冻结为：

```text
primitive | nominal | enum | optional | list | map | record
| union | result | async | stream
```

每个类型具有 canonical identity、normalizer、validator、compatibility、serialization 与 TypeScript mapping。递归引用、cycle、union 歧义、optional/nullability、map key、async/stream nesting 必须有显式规则；不支持的组合在 Application/Behavior lowering 前失败。禁止用 `any`、字符串 Type、隐式 optional 或 emitter 私有规则吞掉不支持语义。

Type Algebra 引用 Engineering IR 的 Entity identity，但不拥有 Entity/Fact identity 或 revision algorithm。当前 legacy `SemanticContractField.type: string` 已进入 loaded-contract/input revision，并被写入 Engineering Entity attributes，因而属于 semantic payload；迁移前必须由 `docs/14` / Engineering IR owner 冻结 canonical Type identity 的 serialization 与 revision 规则。Type identity 改变必须按该合同改变 input/semantic revision，同时独立改变 type-algebra revision；legacy string 只能经显式 migration/diagnostic 进入新模型，不能与 structured Type 并存为第二 authority。

## 4. Application IR

Application IR 表达目标无关的应用组件计划，首版候选节点为：

- `ModulePlan`；
- `DataModelPlan`；
- `ServicePlan`；
- `OperationPlan`；
- `StateMachinePlan`；
- `PolicyPlan`；
- `EffectPortPlan`；
- `DeliveryEndpointPlan`；
- `PersistencePlan`；
- `ViewPlan`；
- `VerificationPlan`。

每个节点必须绑定来源 Engineering Entity/Fact IDs、Target Profile revision 与 Type identities。Application IR 不得写目标 AST，也不得从 label、文件名、Lock 或 UI 投影猜测业务语义。缺少 producer、owner、effect 或 type mapping 时输出稳定 diagnostic，不生成 TODO skeleton。

`ModulePlan.id` 是目标无关的逻辑应用组件身份，不是 Repository physical module/package ID，也不是 source-program 或 TypeScript output module ID。跨域只保存 stable mapping/reference；禁止复用路径或同名字符串把不同 revision domain 合并。

## 5. Behavior IR

Behavior IR 只表达可被 SEC 确定性验证和 lowering 的行为：

```text
bind | validate | sanitize | read | write | mutate | call | await
| branch | match | fail | emit | perform-effect | transaction | return
```

行为节点必须绑定 Application IR operation、输入/输出 Type、Effect/Port、Policy/Permission、source mapping 与 Verification expectation。Control/data-flow ordering、transaction scope、error/result semantics 和 async boundary 都是合同的一部分。

复杂算法不得通过无限扩张 Behavior IR 假装通用。无法完整表示的区域只能成为：

- Governed Extension：有明确接口、Effect、Owner、Source binding 与 Verification；
- Opaque Boundary：显式 unknown/unsupported，不能被重生成或自动语义修改。

## 6. TypeScript Program IR

TypeScript Program IR 是目标程序模型，不是 TypeScript Compiler API AST 的别名。它至少表达 module、import/export、type alias、interface、enum、const、function、class、statement、expression 与 source binding，并为每个节点保留上游 Application/Behavior/Engineering identity。

Program IR validator 必须在打印前拒绝：

- unresolved symbol/type/import；
- 不可表示的 Behavior；
- Effect/Permission 或 async contract 丢失；
- duplicate public identity；
- 非确定性 module/import/declaration order；
- emitter 需要重新猜测业务语义的输入。

TypeScript Compiler API 或 ts-morph 只负责 AST、printer 和 typecheck。Backend 不得拥有第二套 type compatibility、business default、Policy、Effect 或 source-owner 规则。

TypeScript Program IR module 是一个目标程序 compilation unit，必须显式引用 Application `ModulePlan.id` 与 Repository delivery binding；它不能反向成为 physical repository owner。Brownfield Source Program Model module 则表示已存在源码的 observed symbol/module boundary，只能经 Lift/Adopt mapping 关联 Application/Program IR，不能直接获得生成 authority。

## 7. 通用 Kernel 合同

每个新增 IR domain 都必须独立拥有：

- format revision 与 input binding；
- raw/validated 类型边界；
- total validator 与 stable diagnostics；
- canonical identity、ordering 与 digest；
- clone 后递归 deep-freeze；
- source mapping 与 provenance reference；
- 唯一 builder/lowerer owner；
- public facade 与 compile-time boundary；
- unit、property、negative、contract 与 deterministic repetition tests。

相同 validated inputs、Profile、registry/policy revisions 必须产生 byte-stable validated IR 和最终 source。任何会改变 identity、ordering、normalization、compatibility 或 lowering 语义的修改必须升级对应 revision，并通过 Contract Freeze；不得把实现私有 Map/Set insertion order、绝对路径、时间戳或环境变量纳入 digest。

### Validated SEC-TS Compilation Snapshot

Workspace aggregate 不复制 SEC-TS 各层字段。由本域独占一个 compilation binding，把完整 lowering chain 原子绑定到输出：

```ts
interface ValidatedSecTsCompilationSnapshot {
  readonly formatVersion: string;
  readonly workspaceSnapshotRevision: string;
  readonly engineeringSemanticRevision: string;
  readonly targetProfileRevision: string;
  readonly typeAlgebraRevision: string;
  readonly applicationIrRevision: string;
  readonly behaviorIrRevision: string;
  readonly targetProgramIrRevision: string;
  readonly loweringRegistryRevision: string;
  readonly backendRevision: string;
  readonly compilationRevision: string;
}
```

该片段冻结职责与依赖，不是最终可实现 schema。Validator 必须确认 Engineering semantic revision 来自所指 Workspace Snapshot，后续各层 exact 绑定前一层、Profile/Type Algebra/registry/backend revisions 全部可解析。任一输入 revision 改变都必须使 `compilationRevision` 改变；Source/Test 与 target-specific artifact 只能从 validated compilation snapshot 生成。

## 8. Dependency 与单写者

允许的主依赖方向只有：

```text
Engineering IR + Profile + Type Algebra
→ Application IR
→ Behavior IR
→ TypeScript Program IR
→ Validated SEC-TS Compilation Snapshot
→ Backend
```

共享 facade 只暴露 validated inputs/outputs。Backend、Workbench、CLI、AI、Brownfield Provider、Projection 和 Nexus adapter 都不能反向成为 canonical builder。现有 Pipeline stage order 由 Pipeline authority 维护；各 IR package 只提供 pure producer，接入主链必须另行冻结 Work Package，不能在 kernel 实现中顺手建立第二个 coordinator。

### 8.1 Module 与现有 generator 的 reconciliation

四类 module identity 与当前 artifact producer 必须保持分域：

| Identity / producer | 语义 | 决策 |
| --- | --- | --- |
| Repository IR module/package | physical ownership、dependency 与 path binding | **retain/migrate** 现有 workspace/package inventory；不拥有逻辑行为 |
| Application IR `ModulePlan` | target-independent logical component | **new owner**；只通过 stable mapping 指向 repository/source identities |
| Brownfield Source Program Model module | observed existing source/compiler symbol boundary | **retain as observed input**；Lift/Adopt 前无 writer authority |
| TypeScript Program IR module | target compilation unit、imports/exports 与 source binding | **new owner**；由 lowering 创建，不按目录名猜测 identity |
| 现有 `SemanticGeneratorPlan` task/artifact | 当前已实现的 State Transition artifact producer | **retain until parity migration**；不是上述任一 module IR |

新 lowering 在同一 artifact 上达到 source bytes、diagnostics、side effects 与 consumer parity 之前，不得与 `SemanticGeneratorPlan` 同时写同一路径或 artifact identity。迁移必须以 artifact 为单位选择唯一 writer：先 shadow/read-only compare，再切换 consumer，最后退役对应 legacy task；不能用新 ModulePlan/Program IR 的存在宣称旧 generator 已被吸收。

## 9. 实施顺序与退出门

正式顺序：

1. Target Profile kernel；
2. Semantic Type Algebra kernel；
3. Application IR kernel；
4. Behavior IR kernel；
5. TypeScript Program IR kernel；
6. generic TypeScript lowering；
7. Next.js、Prisma、SQLite、React 等独立 adapters；
8. 迁移 legacy Ticket/Customer/template producers 并删除旁路。

每一步只在前一层的 public contract、revision、negative behavior 和 test ownership 冻结后进入。最终 lowering 的产品完成至少要求 Ticket lifecycle、Inventory reservation、Approval workflow 三个反特化模型在不修改 compiler core 的情况下通过；缺 producer 时 deterministic reject；重复编译零 diff；generated source 无 TODO 或业务硬编码。

## 10. 当前状态

`main` 已有 canonical/validated Engineering IR、Pipeline semantic handoff 和有限 IR-owned State Transition 母例。Target Profile、Type Algebra、Application IR、Behavior IR、TypeScript Program IR 与通用 lowering 仍是规划能力；本文存在不能证明它们已实现。当前路线由 `docs/03-MVP实施计划与路线图.md` 持有，`docs/work/active-work-package.md` 只选择唯一 frozen manifest。
