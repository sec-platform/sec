---
title: 稳定交付路线
status: active
domain: roadmap
last-reviewed: 2026-07-29
---

# 稳定交付路线

本文只拥有稳定 capability DAG、阶段进入/退出条件、跨阶段反转条件和产品完成定义。当前 SHA、PR、CI、活动包、blocker、版本和支持矩阵只由 live resolver、代码合同与 `docs/work/**` 拥有。

## 状态解释

路线中的能力只有以下真实层级：

```text
proposed → contract-frozen → implemented-in-main
→ physically-verified → packaged/deployed → product-supported
```

本文件描述依赖和完成门，不自行把任何能力标记为已完成。当前层级必须从最新 `main`、相关代码合同、Evidence 和产品投影重算。一个类型、测试、PR或文档存在不能跨越后续层级。

## 总体 DAG

```text
Canonical Engineering Foundation
→ Semantic Mutation Minimal Surface
→ Blockless Source Ownership
→ Target Profile + Type Algebra
→ Application IR
→ Behavior IR
→ Target Program IR + Backend
→ General TypeScript Lowering
→ Engineering Workspace Domains
→ Workbench / AI Semantic Operator
→ TypeScript Brownfield Adoption
→ Release / Deployment / Operations
→ Registry Trust / Ecosystem / Additional Languages
```

横切基础不替代产品主线，只在存在真实消费者时逐步闭合：

```text
Documentation / Development Governance
Verification Truth / Impact / Evidence / Fault
Incremental Compilation / Artifact Graph
Host / Toolchain / Target / Provider / Distribution
Security / Privacy / Supply Chain
Performance / Resource / Operational Governance
```

没有消费者、没有可验证出口或仅为“以后可能需要”的横切系统保持 proposal，不抢占产品纵切片。

## 1. Canonical Engineering Foundation

进入条件：产品问题、非目标、authority flow和第一批用户可观察场景已冻结。

必须具备：stable Entity/Fact/Assertion identity、Semantic Contract、Responsibility、validated Engineering IR、deterministic revision、统一 Pipeline Kernel、transaction/journal/recovery、Fact/Artifact Provenance 与 Explain projection。

退出条件：

- 同输入 canonical graph byte-stable；
- authority、confidence、validity、conflict和unknown显式；
- consumer只接受统一validated boundary；
- Scenario等cache可从Facts重建；
- 不存在第二identity、revision、writer、loader或pipeline coordinator；
- 至少一个真实纵切片从Contract进入IR并产生可验证Artifact。

反转条件：若真实业务需要只能通过hard-coded业务分支进入Core，或IR无法表达必要identity/authority/effect，则返回语义模型重算，不能在下游Generator补猜测。

## 2. Semantic Mutation Minimal Surface

平台从intent独立派生authorization、source owner、path、actual Delta、Impact、minimum Verification、CAS、writer lease与rollback/recovery。Workbench、CLI和AI只消费同一个product adapter；transport不拥有语义。

退出条件：

- plan/dry-run无live write；
- apply在lease内重新plan并验证expected revision；
- isolated rebuild产生actual Delta/Impact；
- publish前后失败分别得到rejected、rolled-back或recovery-required；
- accepted后从canonical source重新构建，不存在partial-success或UI本地真值；
- 至少一个operation完成并发、crash、CAS、rollback和recovery physical proof。

## 3. Blockless Source Ownership

现有或新建workspace即使没有Block，也能建立Authoring Source inventory、source owner、governed/opaque boundary和mutation adapter。Block是分发/版本/信任单位，不是理解任何源码的前置条件。

退出条件：未被完整理解的源码仍可只读观察和受控修改；任何adopted source都有stable identity、owner、allowed operation、Verification、format/unowned-region preservation与rollback。

反转条件：如果所有源码必须先打包为Block或重写成SEC模型才能治理，说明产品被错误收缩为绿色工程模板系统，必须回退Brownfield和Repository ownership设计。

## 4. Target Profile 与 Type Algebra

Target Profile显式描述language、runtime、module、delivery、package manager、persistence、database、UI、verification、deployment和capabilities；Host Runtime、Toolchain Provider与生成Target正交。

Type Algebra首阶段至少覆盖：

```text
primitive | nominal | enum | optional | list | map | record
| union | result | async | stream
```

每种类型具有stable identity、normalization、compatibility、serialization、target mapping和unsupported behavior。递归、cycle、union discrimination、optional/nullability、map key、async/stream nesting必须明确；不能用`any`、字符串type或Backend私有默认吞掉不支持语义。

退出条件：未知Profile/Type组合在emit前确定性拒绝；Target选择不由当前Host、`cwd`、package manager或框架默认值推断；同一Profile/Type revisions在clean和incremental路径保持一致。

## 5. Application / Behavior / Target Program IR

- **Application IR**：目标无关的Module、Data Model、Service、Operation、State Machine、Policy、Effect Port、Endpoint、Persistence、View和Verification plans。
- **Behavior IR**：SEC能完整验证和lowering的受限行为，如bind、validate、read/write、call/await、branch/match、effect、transaction、fail和return。
- **Target Program IR**：目标语言module、declaration、statement、expression、import/export与source binding。
- **Backend**：AST、printer、formatter、typecheck与bytes。

每层只有一个producer，具有raw/validated boundary、identity、revision、ordering、validator、deep-freeze、source mapping和stable diagnostics。复杂算法进入Governed Extension或Opaque Boundary，不通过无限扩张Behavior IR伪装通用支持。

退出条件：

- 至少三组无关业务模型不修改Core；
- 缺producer/type/effect/permission时unsupported-before-emit；
- legacy/new writer对同一artifact完成bytes、diagnostics、side-effect和consumer parity后只保留一个writer；
- Backend不重新解释业务语义或拥有第二套type compatibility。

## 6. 通用 TypeScript Lowering

Lowering只消费validated upstream IR与Target Profile，不重新读取raw Contract或Manifest。相同inputs/profile/provider revisions产生byte-stable TypeScript artifacts、tests、config与Provenance。

首个反特化验收至少同时覆盖：

- lifecycle/state-machine业务；
- reservation/concurrency业务；
- approval/policy workflow；
- 一个包含Governed Extension的复杂区域；
- 正面、禁止、失败、upgrade和round-trip场景。

退出条件：常见新业务能力主要增加Contract/Block/Adapter，不增加业务名称分支；生成物无TODO/空实现；typecheck、runtime Acceptance、negative scenarios与source mapping闭合。

## 7. Compiler Incremental Graph

增量编译是clean deterministic compilation的优化投影，不是第二编译语义。Pass node identity只绑定content、validated revisions、pass/options、Target Profile与Provider revision；未知依赖只扩大失效。

阶段：exact census/benchmark → in-memory graph → artifact/lowering incrementality → optional persistent derived cache → development daemon integration。

进入前必须先有clean correctness和可测critical path；不能因为AI开发需要快就用stale cache换取假绿。

退出条件：clean/incremental byte-equivalent；小变化只重算真实影响节点；过期revision可取消且不发布partial state；CPU、memory、queue、cache hit/miss/GC与critical path可观察；daemon重启后不依赖隐藏内存恢复正确性。

## 8. Verification 与开发反馈

目标能力按真实依赖分阶段：

```text
Verification Result Truth
├→ Semantic/Repository Test Impact
├→ Epoch / Failure Core
└→ Hermetic Result Integration

Epoch / Failure Core → Trusted Bootstrap → Evidence DAG / Run Journal
Hermetic Resource Core → Physical Fault Traversal
Impact + Watch Evidence → Warm Plan-only Feedback
Result + Epoch + Hermetic Runtime → Automatic Execution
Evidence DAG → Persistent Reuse / Resume / Flake Governance
```

这些节点在各自contract、producer、consumer和migration进入`main`前保持proposal；现有CI contracts继续拥有当前事实。

退出条件：未执行、平台不匹配、unknown impact、stale evidence或candidate自证永不显示PASS；已证明无影响才not-run；相同有效节点可复用；失败给出稳定owner、最小复现、cleanup状态和唯一下一动作；Full发现漏选会修复selector而非仅补测试。

## 9. Engineering Workspace Domains

Repository、Documentation、Workflow/Gate、Agent Operations、Release、Product Decision与Evidence Ledger分别建立独立raw/validated boundary、identity/revision、validator、query、mutation和migration。最终Workspace Snapshot只聚合domain revisions和跨域引用完整性。

初始进入顺序由真实consumer和migration risk重算，原则上优先：

```text
Repository ownership
→ Documentation authority
→ Workflow/Gate truth
→ Agent Operations
→ Evidence / Product Decision
→ Release
→ aggregate Workspace Snapshot
```

禁止一次创建巨型optional object，也禁止文档、Issue、PR body、Agent会话或路径字符串成为domain authority。当前registry/ledger只是阶段性实现时必须明确保留旧consumer authority和退出条件。

## 10. Workbench 与 AI Semantic Operator

Workbench是canonical state的理解、Review与受控操作面，不是低代码运行时。AI只提交proposal；Task Envelope限制operation、target、path、must-preserve、forbidden Effects、Verification与budget。

退出条件：

- Architecture、Scenario、Data、State、Contract、Effect/Permission/Trust、Impact和Evidence都是有引用的projection；
- unknown/opaque/stale/conflict和实现成熟度在UI可见；
- CLI/Workbench对同一请求绑定同一canonical plan；
- UI/layout不进入semantic revision；
- local transport在读取workspace前完成Host/Origin/capability拒绝；
- AI confidence、Context Packet和Provider结果不能扩大权限；
- accepted/rejected/rolled-back/recovery-required都有稳定产品结果和可操作next action。

## 11. TypeScript Brownfield Adoption

```text
Attach → Lift → Reconcile → Adopt → Normalize
```

TypeScript为第一目标，Core contract保持语言无关。Source Program Model是observed/derived representation；unknown、ambiguous、conflicted和opaque可以长期存在。Normalize仅在round-trip、behavior/effect parity、consumer migration与rollback闭合后发生。

退出条件：

- exact revision物理inventory无未解释遗漏；
- supported package/module/symbol coverage可重复；
- Provider不越权，freshness/coverage可见；
- 一个真实外部工程完成Attach→Adopt；
- 一个完整模块完成Normalize、Mutation、round-trip与rollback；
- source move/change产生deterministic delta census；
- 没有unexplained owner、consumer、generated-output或release drift。

## 12. Nexus Conformance 与机制吸收

Nexus是第一个复杂conformance corpus，不是Core模板。所有路径、机制、EPR、Skill、Provider、runtime、browser、release和治理对象必须逐项分类：

```text
project-specific | reusable mechanism | provider evidence
| already represented | migrate | reject | unknown
```

完成要求不是“扫描过”或“计数相等”，而是：

- path/mechanism inventory和coverage可验证；
- accepted parity绑定exact source/core revisions；
- reusable mechanism进入唯一domain owner；
- Nexus特有值留在Policy/Profile/Adapter/fixture；
- duplicate owner、unexplained delta和未裁决unknown为零或显式阻塞；
- 被吸收旧实现有consumer migration和retirement proof；
- SEC在Nexus上的结果不反向特化Core。

Nexus Full Import只有在Workspace domains、Brownfield contracts和conformance ledger分别成熟后开始。

## 13. Release、Deployment 与 Operations

Release candidate、artifact、build profile、SBOM/signing、Verification、promotion与publication receipt必须结构化。Deployment、configuration/secrets、migration、feature flag、canary、rollback、observability、SLO、incident与operational Evidence在出现真实运行消费者后逐域升格。

退出条件：clean package/public projection可重复；每个支持Host/Target/platform有真实package/deployment Evidence；secret/privacy/license/supply-chain边界闭合；发布、部署、健康、回滚和事故状态来自同一Release/Operations truth，不由README或UI猜测。

构建成功不等于可发布，发布成功不等于部署安全，运行trace不自动改写canonical truth。

## 14. Registry Trust、生态与更多语言

进入条件：TypeScript纵切片、Brownfield、Upgrade、Release和Provider contract已现实闭合；否则扩大生态只放大未解决的Core缺口。

每种新语言至少需要Frontend、Source Analysis、Target Backend、Build/Runtime Adapter和cross-language Contract/FFI边界。新增语言不能复用一个“万能AST”或把语言私有IR直接提升为Engineering IR。

Registry生态需要identity、content digest、trust/signing、Effect/Permission声明、compatibility、Verification、revocation/yank、Migration和supply-chain Evidence。社区数量不是完成指标。

## 路线规则

- TypeScript first，Core language-neutral。
- 每次交付一个可合并纵向闭包；Spike默认不合并。
- 外部能力先作为可替换Provider/Adapter；引入必须删除或阻止重复实现。
- 阶段顺序表达依赖，不授权第二loader、writer、revision、selector、cache或pipeline。
- 当前能力、目标设计、测试部署和现实效果分别标记，不用一个“支持”覆盖。
- 没有真实阻塞时及时merge/close/cleanup，不制造无证据修改。
- 新Evidence推翻上游identity、owner、语义或产品假设时，返回相应阶段重算，不在下游追加例外。

## 单包退出

Work Package只有在结果进入唯一主链、owner无竞争、正负/失败/兼容测试通过、required CI/Review无阻塞、旧路径退役或有明确迁移，并完成新`main` readback后结束。

如果该包只完成proposal、类型、实现、单平台测试或PR合并中的一层，必须按实际层级记录，不得提前关闭现实能力目标。

## 产品完成边界

SEC-TS MVP至少要求：

1. 多组无关业务模型不修改Core；
2. unsupported-before-emit；
3. 同输入和revisions byte-stable；
4. 主要Semantic Operations可由Workbench/CLI通过同一Mutation facade执行；
5. AI只能提交bounded proposal；
6. 失败可在发布前拒绝、恢复prior state或进入recovery-required；
7. 用户可以看到健康、影响、证据、未知、支持层级和阻塞下一动作；
8. clean package在声明Host/Target/platform上通过真实消费者路径。

Engineering Workspace MVP还要求Documentation、Repository、Gate、Agent、Toolchain、Release、Decision与Evidence结构化，并能计算跨域影响和失效。

任何“无漏洞”“全部支持”“完全兼容”“跨平台”或“任意工程可导入”声明必须绑定范围、版本、样本、方法、owning environment Evidence、coverage、失败记录与residual risk。
