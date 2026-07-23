---
title: MVP 实施计划与路线图
status: active
last-reviewed: 2026-07-23
---

# MVP 实施计划与路线图

本文只维护**稳定阶段 DAG、进入/退出条件与完成定义**。当前 exact SHA、活动 PR、CI、blocker 和 active manifest 只存在于 `docs/work/**`。

## 1. 路线原则

- TypeScript 是第一目标，但 Core contract 必须语言无关。
- 每次只完成一个可合并纵向闭包；不把多年目标展开成永久微任务。
- 先证明 authority、identity、ownership、Mutation、Verification 和 Recovery，再扩大语言、框架、UI与生态。
- 外部成熟能力优先作为可替换 Provider/Adapter；引入必须删除或阻止自研重复。
- Nexus 是首个完整 Conformance Corpus，不是 Core 模板。

## 2. 稳定阶段 DAG

```text
P0  Current Reality / Canonical Foundation
→ P1  SM-4A Workbench/CLI Minimal Semantic Mutation Surface
→ P2  Blockless Semantic Source Ownership
→ P3  TypeScript Target Profile + Semantic Type Algebra
→ P4  Application IR + Behavior IR + TypeScript Program IR
→ P5  Generic TypeScript Lowering
→ P6  Engineering Workspace Domain Foundation
→ P7  Documentation / Workflow / Agent / Release Projections
→ P8  Complete Workbench Semantic Operations
→ P9  Task Envelope v2 + AI Semantic Operator
→ P10 TypeScript Brownfield Attach/Lift/Reconcile/Adopt/Normalize
→ P11 Nexus Full Parity / Retirement Closure
→ P12 Registry Trust / Multi-team / Multi-target / Production Hardening
```

活动阶段和唯一 active package 由 `work/current-state.yaml`、`work/rolling-plan.md` 与 active pointer 选择，不在本文重复。

最终产品数据流要求完整 `Validated Engineering Workspace Snapshot` 位于 Application/Behavior/Target Program IR 之前；阶段 DAG 描述的是可交付迁移顺序，不代表 P3–P5 可以另建输入 authority。P0 已有 validated Engineering IR 可作为 **provisional target-lowering input**；P6 扩展 Repository/Documentation/Workflow/Agent/Release/Decision/Evidence domains 时，必须由 `engineering-workspace-ir.md` 规定的唯一 builder 原位 reconcile，并重新绑定下游 snapshot revision。任何阶段都不得并行保留第二 loader、第二 writer、第二 revision algorithm 或第二 target-program pipeline。

## 3. 阶段出口

### P0：Canonical Foundation

必须已经进入唯一主链：

- canonical/validated Engineering IR；
- Entity/Fact identity、Assertion、authority、provenance、revision；
- Pipeline Kernel 与 deterministic coordinator；
- Fact Delta、conservative Impact；
- Semantic Mutation SM-0～SM-3基础；
- lease、CAS、journal、isolated apply、rollback/recovery contract；
- 无第二 Pipeline、IR authority 或 Projection旁路。

### P1：SM-4A最小产品闭环

只闭合一个既有 operation，例如 `add-state-transition`：

```text
raw DTO
→ platform authorization
→ plan
→ source ownership/CAS
→ isolated apply
→ canonical rebuild
→ actual Delta / Impact / Verification
→ accepted | rejected | rolled-back | recovery-required
```

CLI与Workbench必须是同一 shared adapter 的薄 transport；不扩展 operation catalog，不混入Task Envelope v2。

### P2：Blockless Source Ownership

- App/source-module/import-session可作为 Semantic Source Owner；
- Block不再是语义存在的前置许可证；
- ownership迁移不伪造Entity/Fact identity；
- Registry source保持read-only；
- 每个writable region唯一owner。

### P3：Target Profile与Type Algebra

Target Profile至少拆分language、runtime、module system、delivery、persistence、database、UI、verification、deployment。

Type Algebra至少支持primitive、nominal/entity、enum、optional、list、map、record、union、result、async、stream，并有canonical identity、normalizer、compatibility、serialization和TS mapping。

### P4：多层IR

Application IR、Behavior IR、TypeScript Program IR分别具有：

- format revision；
- canonical ordering；
- stable identity；
- raw/validated boundary；
- validator；
- deep freeze/digest；
- source mapping；
- property/contract tests。

Behavior IR只表达SEC-TS v1支持的行为；复杂算法使用Governed Extension或Opaque Boundary。

P4 只消费 P0 已冻结的 provisional validated input，并显式记录输入 revision 与迁移状态；它不能把 provisional input 宣称为完整 Workspace Snapshot。P6 引入新 domain 后，旧 target snapshot 失效并通过同一 lowering owner 重建，不允许 adapter 偷渡双写。

### P5：通用TS Lowering

按Entity、Responsibility/Operation、State Machine、Policy/Permission、Effect/Port、Scenario/Acceptance和目标Adapter逐步lower。

退出条件：

- 三个无关业务模型不修改compiler core；
- 不支持行为在emit前确定拒绝；
- 生成物无TODO/Not implemented；
- 相同validated input/profile/provider revisions产生相同bytes；
- 用户自定义逻辑通过显式Custom Implementation Unit接入。

### P6：Engineering Workspace domains

Repository、Documentation、Workflow/Gate、Agent Operations、Release、Product Decision、Evidence各自独立version/validate/freeze/digest；聚合Snapshot只组合revision和跨域一致性，不形成巨型optional object。

P6 是从 provisional Engineering IR input 到完整 Validated Engineering Workspace Snapshot 的迁移闭包：现有 semantic frontend/filesystem IO 必须被唯一 snapshot builder 吸收或退役；Application/Behavior/Program IR 仍由原 owner消费新 snapshot revision，不能创建平行 target pipeline。

### P7：治理投影

- 一份Document/Gate/Skill/Release contract可确定生成或验证各宿主投影；
- CI是evidence executor，不是第二Gate authority；
- public/privacy/permission/locale projection同源；
- 外部Provider结果保持Evidence身份。

### P8：完整Workbench

支持主要Semantic Operations、影响预览、Verification、冲突、unknown/opaque、rollback/recovery和source下钻；用户不直接编辑generated project/control。

### P9：AI Semantic Operator

AI只允许bounded proposal、governed extension patch、review/repair proposal；不能选择越权路径、提交actual Delta/Impact、降低Verification或直接发布。

### P10：Brownfield MVP

- workspace artifact inventory完整；
- 高确定symbol具有稳定identity；
- Provider输出绑定version/source revision/coverage/diagnostics/unresolved；
- unknown/ambiguous/opaque显式；
- 至少一个真实模块完成Attach→Lift→Reconcile→Adopt→Normalize→Mutation→rollback；
- 未拥有区域零无意漂移。

### P11：Nexus Parity

满足Conformance Spec中的100% path classification、mechanism decision、EPR/Skills/entrypoints/public surfaces覆盖、accepted parity、unexplained delta=0和authorized retirement。

### P12：生产化

包括Registry trust/version、两个独立团队Block生命周期、更多数据库/目标、稳定CLI/Workbench/IDE/MCP、SBOM/签名/SLSA、迁移兼容、性能与安全硬化。

## 4. 完成定义

### 单个Work Package

- 一个真实产品或架构结果进入唯一主链；
- canonical owner明确且无第二writer；
- 正面、负面、失败、兼容测试通过；
- 适用CI/Review无阻塞；
- 旧路径删除或有明确迁移；
- 结果进入main并完成清理；
- 从新main重算下一项。

### SEC-TS MVP

- 三个无关业务模型不修改Core；
- supported models完整生成，unsupported在emit前拒绝；
- 同输入byte-stable；
- Workbench可执行主要Semantic Operations；
- AI只能提交受控proposal；
- 失败可rollback或进入recovery-required。

### Engineering Workspace MVP

- Docs/Gate/Skill/Toolchain/Release/Evidence结构化；
- Toolchain、Effect、Permission、文档移动和发布目标变化可计算跨域影响；
- public candidate可确定生成和审查；
- 用户看到健康、影响、证据和阻塞，而非脚本细节。

### “无漏洞”保证边界

SEC不能保证不存在未知漏洞。它必须保证：

- 每项声明性质有范围、方法、证据和假设；
- unknown/opaque/residual risk显式；
- 未验证、失败、超时或未执行不能宣称通过；
- actual Delta超出计划则阻断发布；
- 新漏洞能映射回合同/Generator/Block/受影响项目并形成永久回归。
