---
title: Engineering Workspace IR 规划
status: active
last-reviewed: 2026-07-22
---

# Engineering Workspace IR 规划

本文是 Repository、Documentation、Workflow/Gate、Agent Operations、Release、Product Decision/Portfolio、Evidence Ledger 与聚合 Engineering Workspace Snapshot 的唯一规划 owner。业务语义由 `docs/14-Engineering IR与语义事实规范.md` 持有；SEC-TS 应用与目标程序层由 `docs/architecture/sec-ts-ir-layers.md` 持有；Brownfield Source Program Model 由 `docs/architecture/brownfield-import.md` 持有。

这些 domain 尚未因本文而实现。正式代码必须按独立 Work Package、独立 revision 和独立 validator 落地，禁止一次创建巨型 optional workspace object。

## 1. 产品边界

Engineering Workspace Compiler 的 canonical 输入与输出不只包括业务源码：

```text
Product Intent / Existing Workspace
        ↓
Canonical Workspace Input Snapshot
        ├─ Authoring Sources
        ├─ imported physical/runtime Evidence
        └─ exact source/tool/policy revisions
        ↓
independently validated domains
        ├─ Semantic / Engineering IR
        ├─ Repository IR
        ├─ Documentation IR
        ├─ Workflow / Gate IR
        ├─ Agent Operations IR
        ├─ Release IR
        ├─ Product Decision / Portfolio IR
        ├─ Evidence Ledger
        └─ optional Source Program Model reference
        ↓
Validated Engineering Workspace Snapshot
        ↓
governance projections + input to domain-specific Compilation Snapshots
```

Canonical Workspace Input Snapshot 只冻结一次编译观察到的 inputs 与 source revisions，不是 validated domain。最终 Snapshot 是各独立 validated domain revision 的原子组合与一致性证明，不重新拥有域内字段。各域通过稳定 workspace/repository/package/application/artifact/evidence IDs 关联，不共享可变对象或以路径字符串充当跨域身份。

### 1.1 与现有 Semantic Frontend 的迁移合同

当前 `main` 的 `loadWorkspaceEngineeringIRBuildInput()` 是 Engineering semantic inputs 的唯一 filesystem loader，`buildWorkspaceSemanticBundle()` 是唯一 Semantic Frontend bundle builder。Canonical Workspace Input Snapshot 落地时不得与这两者并行扫描 Plan、Lock、Manifest、Contract 或 Policy：

- **retain**：`buildWorkspaceSemanticBundle()` 保留为 Engineering semantic domain 的 canonical producer；它最终只消费 Snapshot 中已冻结的 semantic input slice，不重新访问 workspace；
- **migrate**：唯一 Snapshot builder 吸收 `loadWorkspaceEngineeringIRBuildInput()` 当前的 filesystem read 与 raw source-revision custody；同名能力迁移为只从 Snapshot semantic slice 投影 `EngineeringIRBuildInput` 的纯函数；迁移期间仍只能有一条实际 IO chain；
- **retire**：所有接受 workspace path 并自行重复读取上述 inputs 的 legacy overload/adapter，在现有 callers 全部迁移且 revision/bytes parity 通过后退役。

迁移前保持现有 loader 为唯一 IO owner，不允许先新增第二个 Snapshot scanner。迁移后 Snapshot builder 独占 raw bytes、source revision 与一次性读取；semantic bundle 只拥有从同一 frozen input 派生的 IR、Generator Plan、Views 与 source-candidate binding。相同输入必须保持现有 Engineering `inputRevision` / `semanticRevision` 与 bundle bytes，除非独立 migration contract 明确升级 revision。

## 2. Repository IR

Repository IR 表达物理工程拓扑与 owner：

- repository、workspace、package、application、module；
- dependency 与允许方向；
- Toolchain Profile；
- source、generated、protected、opaque zones；
- canonical owner 与 public surface；
- lifecycle、release target 与 projection relationship。

它不解释业务语义，不把 Git 状态当 authoring truth，也不复制 TypeScript symbol graph。路径是 versioned binding，不是 Entity identity；rename/move 必须保持稳定 ID 或显式产生 replacement/migration。

Repository `ToolchainProfile` 只描述 host/build 工具事实与可复现执行绑定，例如实际 Bun/Node/TypeScript/package-manager identity、lock/dependency generation 和 platform。SEC-TS `TargetProfile` 描述目标程序允许的 language/runtime/module/delivery 能力。前者变化不得自动改变 target revision，后者变化也不得改写 repository toolchain revision；两域只通过显式 compatibility binding 关联。

## 3. Documentation IR

Documentation IR 表达：

- document identity、type、audience、owner、lifecycle；
- canonical path、redirect 与 generated compatibility mirror；
- links、projection-of、evidence scope；
- freshness、review date 与 replacement relation。

一个主题只有一个 canonical owner。摘要、导航、mirror 和历史记录不能成为竞争 authority。文档检查器是该 IR 的 consumer/validator adapter，不因读取 Markdown 就拥有产品或实现事实。

## 4. Workflow / Gate IR

Workflow/Gate IR 表达：

- Gate identity、revision、trigger 与 applicability；
- scope、capability/command、runtime、dependency 和 timeout；
- required-for、evidence output、failure classification；
- `gate_owner`、reuse key、freshness 与 invalidation rule。

package script、Git hook、CI workflow、Skill 和 release checklist 都应投影同一个 Gate，不复制规则。Hosted workflow 不是 Gate 本体；一次 CI success 只能证明绑定 exact head/profile 的 evidence，不能把旧结果伪装为新 head 结果。

现有 Verification authority 与未来 IR 的固定分层是：

| 层 | 唯一职责 | 不拥有 |
| --- | --- | --- |
| Engineering IR `VERIFIED_BY` | 业务/工程语义对 Acceptance 或 selector intent 的关系 | runnable command、CI lane、执行结果 |
| Application IR `VerificationPlan` | target-independent verification requirement | repository Gate 定义、Work Package owner、run evidence |
| Workflow/Gate IR | 可执行 Gate identity、command/capability、trigger、order/dependency、reuse/invalidation contract | 当前候选选择、一次运行结果 |
| CI verification plan / test-impact adapter | 从 validated Gate + exact candidate/profile 选择 hosted/local execution projection | 第二套 Gate identity/order/command authority |
| frozen Work Package | 为当前候选选择 required Gates 并指定唯一 `gate_owner` | Gate 定义或伪造 PASS |
| Evidence Ledger | 记录 exact head/profile 上的一次 immutable run instance、result、artifact 与失效状态 | Gate 规划、选择或执行 |

现有 `ci-verification-plan`、`ci-evidence-contract` 与 `test-impact-contract` 在 Workflow/Gate IR 实现前继续保留各自当前 authority；迁移时每个 Gate 必须逐项记录 retain/migrate/retire 与 byte-parity projection。所有 consumers 完成迁移前，禁止让新 Gate IR 与旧 CI plan 同时写 command、order、selector 或 evidence identity。

## 5. Agent Operations IR

Agent Operations IR 表达：

- Skill/operation identity 与 trigger；
- phase、target、prerequisite；
- allowed tool/operation/path；
- forbidden shortcut 与 authority boundary；
- required Verification、completion evidence 与 publication authorization。

Agent prompt、`AGENTS.md`、Skill 文件和 host-specific hook 是 projections/adapters。它们不能各自拥有第二套工程规则，也不能让 AI 自行扩权、选择 canonical path、降低 Verification 或发布结果。

## 6. Release IR

Release IR 表达：

- Release Target 与 candidate commit；
- included artifact、excluded source 与 public projection；
- privacy、permission、locale、store metadata；
- build profile、signing、SBOM、Verification；
- publication authorization 与 receipt。

私有→公开仓库、extension/store、package、site 或其他发布方式是 adapter。Public README、权限声明、locale 与实际 binary/source 必须由同一 release snapshot 派生；手工同步多份声明不能成为长期 owner。

## 7. Product Decision / Portfolio IR

该域保存会影响产品路线但不等于当前事实的结构化决策：

- hypothesis、candidate capability、user outcome；
- decision gate、assumption、competing option；
- public commitment 与 expiry/revalidation trigger；
- accepted、rejected、deferred、superseded 状态及 rationale。

Product Decision canonical revision 不包含 support/contradict edge、evidence expiry/invalidation 或 reverse index；它只先冻结稳定 decision ID 与决策内容。它不取代 `docs/03` 的当前执行顺序，也不能把候选功能写成已完成能力。易变的 active selector 位于 `docs/work/active-work-package.md`，完整执行闭包只在其指向的 frozen `docs/work-packages/<id>.md`。

## 8. Evidence Ledger

Evidence Ledger 表达：

- evidence identity、source、observedAt、sourceRevision；
- scope、profile、metric definition 与 sample；
- evidence source authority classification、observation/measurement confidence、bias、competing explanation；这些字段不是 semantic claim authority/confidence；
- evidence → decision 的 supporting/contradicting edge、expiry 与 invalidation rule；
- historical revision 与 supersession。

Evidence Ledger 是 support/contradict 关系的唯一 writer 与 revision owner；它只能引用已存在的 stable decision ID。两域独立验证后，Workspace/query projection 才可由 product-decision revision + ledger revision 派生只读 reverse index，不能把该 index 写回任一 canonical domain。测试报告、CI run、runtime trace、research、GitNexus/Graph provider output 都先成为 Evidence；它们不会自动提升为 authoritative semantic/workspace Fact。Evidence 可组合，但组合必须公开 baseline、intervening diff 和 delta validation，不能制造不存在的 exact-head success。

Engineering IR `FactAssertion` 与 Ledger 不竞争同一 record：Assertion 仍独占对 exact semantic triple 的 claim assessment（`authority`、`confidence`、`provenance`）及排序后的 opaque `EvidenceReference` IDs；Ledger 独占这些 IDs 指向的 evidence record、source/run metadata、bias、expiry/invalidation、supersession 与 decision edge。Ledger metadata 或 support/contradict edge 变化不得改变 Engineering `semanticRevision`；只有 Assertion claim 字段或其 evidence-reference 集变化才按 `docs/14` 改变该 revision。Workspace aggregator 只校验引用完整性，绝不能据 Ledger score/expiry 自动提升或重写 Assertion authority/confidence。

## 9. Validated Engineering Workspace Snapshot

目标聚合合同是 revision reference 的显式 product，不是所有字段的复制：

```ts
interface ValidatedEngineeringWorkspaceSnapshot {
  readonly formatVersion: string;
  readonly workspaceId: string;
  readonly semanticRevision: string;
  readonly repositoryRevision: string;
  readonly documentationRevision: string;
  readonly workflowRevision: string;
  readonly agentOperationsRevision: string;
  readonly releaseRevision: string;
  readonly productDecisionRevision: string;
  readonly evidenceLedgerRevision: string;
  readonly sourceProgramRevision?: string;
  readonly snapshotRevision: string;
}
```

该片段只冻结职责与引用方向，不是可直接实现的最终 TypeScript schema。每个被引用 domain 必须先独立 validate、freeze、digest；aggregator 再验证 ID、owner、public surface、Gate、release、evidence 和 projection 的跨域引用完整性。某域未实现时，不能用空对象或 optional 字段宣称完整 workspace snapshot。

Application/Behavior/Target Program 等 target lowering revision 不进入本 aggregate，也不由本文定义。SEC-TS 由 `docs/architecture/sec-ts-ir-layers.md` 的独立 `ValidatedSecTsCompilationSnapshot` exact 引用本 `snapshotRevision` 和完整 lowering/backend revisions；只有该 compilation snapshot 可以驱动 TypeScript Source/Test/artifact bytes。Workspace Snapshot 自身只驱动其已实现 domain 的治理投影。

## 10. Writer、Mutation 与 Projection

- Authoring Source/Policy Pack 是输入 authority；IR 与 Snapshot 是确定性派生。
- live writer 必须服从同一 workspace lease、CAS、journal、atomic publish、rollback 与 `recovery-required`。
- Semantic Mutation v2 只修改其 operation registry 授权的 Authoring Source；未来 workspace mutation 必须新增独立 operation revision，不能借用现有 `add-state-transition`。
- Workbench、CLI、AI、docs generator、CI generator 和 release tooling 只能提交 proposal 或消费 validated projection，不能直接 patch validated IR/Snapshot。
- 一个 domain 只有一个 builder/validator/revision owner；compatibility mirror 永远只读。

## 11. Nexus Conformance 边界

`QzCrane/nexus` 是第一个完整 conformance corpus，不是 Core 模板。Nexus 的具体版本、产品 ID、权限、locale、路径、hardlink 或脚本名称进入 Project Policy Pack、Profile、Adapter 或 fixture；一般机制进入对应 domain IR。分类、Parity 和 retirement 的唯一合同见 `docs/governance/nexus-absorption-and-conformance.md`。

Nexus Census 可以只读并行发现机制，但不能在 inventory/decision 未闭合时反向一次性设计所有 Workspace IR 类型。共享 identity/revision 与每个 domain canonical type 保持单写者。

## 12. 实施顺序与完成门

正式实现顺序由最新 DAG 重算；初始候选顺序是 Repository → Documentation → Workflow/Gate → Agent Operations → Release → Product Decision/Portfolio → Evidence Ledger → Workspace Snapshot aggregator。每个 domain 都需要：

- raw/validated boundary、stable identity、ordering、digest 与 deep-freeze；
- total validator、stable diagnostics、migration 与 Contract Freeze；
- positive/negative/property/contract tests；
- 至少一个真实 consumer，不允许只落类型；
- Nexus corpus 或独立 fixture 的反特化验证；
- legacy owner/consumer reconciliation，禁止长期双写。

只有所有 required domain 已实现、跨域引用验证通过、projection 可重建、Mutation/recovery 与真实产品纵切面闭合，才能称 Engineering Workspace Snapshot 完成。当前仅有 Engineering IR 和部分治理 artifact 能力，其他域与聚合 Snapshot 均为规划状态。
