# Engineering Compiler

Engineering Compiler（SEC）是一个本地优先的工程语义编译器，也是面向完整工程闭环的 **Engineering Workspace Compiler**。它把产品意图、应用规格、Block 合约、策略、验收、受治理源码和既有工程证据编译为可运行项目，以及一致的源码、测试、文档、Gate、Agent、Release 与 Evidence 投影。

SEC 不是低代码运行时、模板市场或自由 AI 编码器。长期目标是把软件开发的主要操作从“直接修改文件”提升为“声明工程语义、组合能力、约束例外、验证结果”。

## 当前状态

当前主干已经具备文件装配与治理闭环：

```text
source/app.yaml
  → resolve
  → compose
  → adapt
  → verify
  → repair / upgrade
  → lock
  → explain
```

已实现的核心能力包括 Block Registry、依赖解析、Slot 合成、Verification、Acceptance Coverage、Policy Gate、Artifact Provenance、Repair、Upgrade、Explain Graph、Review Summary、Workbench 基础、canonical/validated Engineering IR、Fact Delta、Impact Propagation，以及 Semantic Mutation SM-0～SM-3 transaction。Workbench/CLI 的 Semantic Mutation v2 产品 adapter 尚未接入；现有 legacy View Mutation 不能代表该能力。

稳定产品阶段、依赖与完成定义只由 `docs/03-MVP实施计划与路线图.md` 维护；当前 `main`、CI/Review、唯一 active Work Package 与近期候选只由 `docs/work/**` 三个控制面维护。README 不复制会随合并变化的当前任务、SHA、PR 或 blocker。长期目标链路为：

```text
Product Intent / Existing Workspace
  → Authoring Source + imported Evidence
  → Canonical Workspace Input Snapshot
  → Semantic Frontend
  → Engineering IR + independently validated workspace domains
  → Validated Engineering Workspace Snapshot
  → Application IR
  → Behavior IR
  → Target Program IR（SEC-TS v1 为 TypeScript Program IR）
  → Validated target Compilation Snapshot
  → Source / Test / Docs / Gate / Agent / Release Projections
  → Verification / Provenance / Workbench
  → Semantic Mutation / Rollback / Recovery
```

`ExplainGraph` 是治理解释投影，不是 Engineering IR，也不是第二事实源。

## 开始开发

```bash
bun install
bun run check:affected
bun run check:fast
bun run check:full
```

编译器 CLI：

```bash
bun run sec -- <command>
```

常用闭环：

```bash
bun run demo:quickstart
bun run reference:refresh
bun run demo:closed-loop
```

## Workspace 模型

| 根目录 | 职责 |
| --- | --- |
| `source/` | 开发事实源：规格、模型、受治理源码、Slot、Patch、View Mutation、私有 Block |
| `project/` | 编译生成的可运行目标；可调试，但不是默认编辑面 |
| `control/` | Lock、Verification、Provenance、Graph、Review、Workflow、Workbench、CI 控制面 |
| `.sec/` | 可删除、可重建的本地缓存、索引、预览与 AI 会话状态 |

正常产品开发优先修改：

- `source/app.yaml`
- `source/model/**`
- `source/code/**`
- `source/patches/**`
- `source/views/**`
- `source/blocks/private/**`

不要直接修改编译器内部、官方 Registry 或 `control/**` 产物。对 `project/**` 的人工修改必须被识别为 Override/Drift，并回收为受治理输入。

## 编译器边界

编译器本体位于 `platform/compiler/**`，公共 API 统一从 `platform/compiler/index.ts` 暴露。`platform/**` 的其他模块不得穿透导入 compiler 子目录。

Compose 层生成 TypeScript/TSX 必须通过 `CodeBuilder` 的程序化代码生成 API；禁止继续扩张大段模板字符串生成路径。

AI 不是主控制器。平台生成 Task Envelope 与 Context Packet，限定目标、允许操作、路径、必须保持的合同和验证要求；AI 只能提交 Source Patch 或 Semantic Mutation 提案，最终事实由编译器重建和验证。

## 文档入口

文档权威顺序和职责见 [docs/00-文档索引与一致性规则.md](docs/00-文档索引与一致性规则.md)。

首次阅读建议：

1. [01-用户能力模块化开发-主题整理稿.md](docs/01-用户能力模块化开发-主题整理稿.md)：核心命题与概念。
2. [02-工程编译器-MVP-PRD与架构稿.md](docs/02-工程编译器-MVP-PRD与架构稿.md)：产品与总体架构。
3. [03-MVP实施计划与路线图.md](docs/03-MVP实施计划与路线图.md)：稳定阶段 DAG、进入/退出条件与完成定义。
4. [14-Engineering IR与语义事实规范.md](docs/14-Engineering IR与语义事实规范.md)：已落地的语义内核及其后续合同。
5. [SEC-TS 多层 IR](docs/architecture/sec-ts-ir-layers.md)、[Engineering Workspace IR](docs/architecture/engineering-workspace-ir.md) 与 [Brownfield Import](docs/architecture/brownfield-import.md)：长期架构的 canonical 规划 owner。
6. [当前事实](docs/work/current-state.yaml)、[滚动计划](docs/work/rolling-plan.md) 与 [唯一活动 Work Package 选择器](docs/work/active-work-package.md)：三个相互分离的近期控制面；选择器指向 canonical frozen manifest。
7. `05–11`：实现级协议；[12-编译管道与行为流图示.md](docs/12-编译管道与行为流图示.md) 只画当前权威主数据流。

测试与 CI：

- [test-architecture.md](docs/test-architecture.md)
- [test-feedback-and-ci-lanes.md](docs/test-feedback-and-ci-lanes.md)
- [slow-suite-registry.md](docs/slow-suite-registry.md)

## 开发原则

1. 一个工程事实只允许有一个权威定义位置。
2. 结构化事实优先于源码反推；源码分析只能提供派生证据。
3. Engineering IR 是语义事实统一表示；Explain、Review、Workbench 都是投影。
4. Block 是分发/版本/信任单位；Semantic Responsibility 是理解与架构单位；Semantic Fact 是最小工程事实单位。
5. AI 只能在平台授予的语义与物理边界内操作。
6. 新能力必须形成可重复闭环，并进入类型、合同、验证和文档四个层面。
