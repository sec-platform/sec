---
title: TypeScript Brownfield Import 与 Source Program Model 规划
status: active
last-reviewed: 2026-07-22
---

# TypeScript Brownfield Import 与 Source Program Model 规划

本文是现有 TypeScript 工程的 Attach、Lift、Adopt、Normalize、Source Program Model、Provider Evidence 与 unknown/opaque 处理的唯一规划 owner。业务语义 authority 仍属于 Authoring Contract 与 `docs/14-Engineering IR与语义事实规范.md`；Repository/Documentation/Gate/Agent/Release 域属于 `docs/architecture/engineering-workspace-ir.md`。源码分析结果不能直接升级为 authoritative Engineering IR。

## 1. 产品结果

Brownfield Import 不是“扫描源码后生成一张图”，而是让现有工程逐步进入可治理、可验证、可安全修改的 workspace：

```text
Existing TypeScript Workspace
        ↓ Attach
complete physical artifact inventory
        ↓ Lift
Source Program Model + typed Evidence candidates
        ↓ human/policy reconciliation
authoritative / derived / observed / inferred / ambiguous / unknown
        ↓ Adopt
Governed Source + canonical bindings
        ↓ Normalize（only when fully representable）
SEC-owned deterministic projections
```

任何阶段都必须允许用户保留复杂区域，而不是强迫全仓重写。

## 2. 四个阶段

### Attach

对 exact source revision 建立 100% 物理 inventory：repository/workspace/package/build target/file、mode、object/content digest、generated/vendor/protected/opaque classification、public/release surface 与 current owner。Attach 只证明“看见了什么”，不证明理解或可重生成。

### Lift

构建 Source Program Model 并生成候选：module、symbol、declaration、type、reference、import/export、call/control/data-flow、effect、framework binding、source span 与 unresolved region。每个候选必须绑定 provider/source revision、coverage、confidence、diagnostic 和 evidence reference。

### Adopt

把经人或 policy 明确接受的 source/contract/binding 纳入 Governed Source。Adopt 必须建立稳定 owner、identity、revision、allowed mutation boundary 与 Verification；它不能只把推断 confidence 调高。与 authoritative Contract 冲突时，保留冲突并要求显式决策。

### Normalize

只有 SEC 能完整表示、验证、round-trip 并安全迁移的模块才可转为 SEC-owned deterministic projection。Normalize 必须先证明 consumer migration、source mapping、behavior/effect parity、rollback 和零 unexplained delta；否则保持 Governed Extension 或 Opaque Boundary。

## 3. Source Program Model

首版模型至少表达：

- workspace、package、build target；
- file、module、symbol、declaration、type；
- reference、import/export、call candidate；
- control/data-flow candidate 与 effect candidate；
- framework binding、source span；
- generated/vendor/protected/opaque region；
- unresolved、ambiguous 与 provider-conflict region。

模型必须独立 version、validate、canonical order、digest 与 freeze。Identity 优先来自 repository revision + stable logical binding，而不是绝对路径或 provider-specific ID；rename/move、declaration merge、overload、generated files、symlink/reparse、case folding 与 multi-package resolution 必须有显式策略。

Source Program Model 是 observed/derived representation，不是 Engineering IR、TypeScript Program IR 或 Repository IR 的别名。跨域关联只通过稳定 IDs 与 evidence references。

## 4. Provider Contract

TypeScript Compiler API/ts-morph、GitNexus、Graph-It-Live、Graphify、runtime trace、CodeQL/CPG 或 IDE provider 都必须适配统一 contract：

```text
providerId
providerRevision
sourceRevision
coverage
confidence
diagnostics
unresolvedRegions
evidenceReferences
```

Provider 只能增加证据与候选。多个 provider 冲突时保留 competing explanations，不使用“多数票”或最高 confidence 自动覆盖 authority。Provider 缺失/stale/partial 不得被伪装成全量覆盖；只有显式 Verification contract 要求该 provider 时才成为 hard blocker。

## 5. Authority、置信与未知

- authoritative：来自用户/项目明确拥有的 Contract 或 policy decision；
- derived：由 canonical rules 从 authoritative inputs 确定性得到；
- observed：由 exact source/runtime state 直接观察；
- inferred：由静态/动态分析推断；
- ambiguous：存在多个仍可行解释；
- unknown：覆盖或语义不足，不能作出结论。

`confidence = 1.0` 仍不能把 inferred 提升为 authoritative。unknown/ambiguous/opaque 必须进入用户可见的 Workbench、Impact 与 Verification 边界，不得通过默认框架假设、`any`、空 TODO 或 silently skipped file 消失。

## 6. Owner、Mutation 与 round-trip

Attach/Lift 默认只读。Adopt 后每个 source region 必须唯一属于 application、source module、block、generated projection、governed extension 或 opaque owner。Registry 仍是 read-only；同名 mirror、copy 或未被 canonical frontend 装载的文件不能获得 writable authority。

未来 Brownfield mutation 必须：

- 通过版本化 operation registry；
- 从 canonical binding 解析 source owner/path；
- 使用 source-byte CAS、workspace lease、isolated rebuild、actual Delta/Impact 与 Verification；
- 原子 publish 或 verified rollback/recovery；
- 保留格式、comments 和未拥有 region；
- 对不完整 source mapping fail closed。

现有 Semantic Mutation v2 的首版 `add-state-transition` 不能被泛化成 arbitrary source patch。

## 7. 安全与隐私

导入现有 workspace 时默认不执行不受信脚本、不上传源码、不跟随越界 symlink/reparse、不读取未授权 secret/environment。需要 runtime trace、build、package manager 或 browser 的 provider 必须有显式 capability、sandbox/host boundary、timeout、bounded output 与 Evidence scope。忽略规则、vendor、generated、binary 和 secret classification 必须可审计，不能用“未扫描”冒充“不存在”。

## 8. 完成门

Brownfield MVP 至少要求：

- exact revision 下物理 artifact inventory 100%；
- supported TS packages/modules/symbols 有可复现 coverage；
- unresolved/ambiguous/opaque 显式且可导航；
- Provider output 不越权；
- 至少一个真实现有工程完成 Attach → Lift → Adopt；
- 至少一个完整可表示模块完成 Normalize、round-trip、Mutation 与 rollback；
- 同输入重复导入 byte-stable；
- source move/change 触发 deterministic delta census；
- 没有 unexplained owner、consumer 或 generated-output drift。

Nexus Full Import 只有在 Workspace IR、Nexus Census/Parity 与 Brownfield contracts 分别成熟后才能开始。当前阶段不得把 Nexus 当前 exact tree 的 1,439 路径 Census 或外部图索引当成 Brownfield 完成证据。
