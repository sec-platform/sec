---
title: Canonical Architecture Migration, Documentation Minimization and Retirement
status: proposal
domain: proposal
tracking: issue-232
exact-main: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
authority: none
---

# Canonical Architecture Migration, Documentation Minimization and Retirement

## 1. 目标

当前 active canonical 文档体系已经完成一次结构重建，但未来设计仍存在明显膨胀：PR #226/#229/#231/#233 合计约 42 个 proposal 文件、超过 1.7 万新增行，并在架构、Agent、吞吐、Evidence、Integration 和迁移上重复表达。

这些内容尚未进入 `main`，所以不是运行时代码膨胀；但它已经形成认知、审查和迁移债务。本方案的目标不是再增加一套“最终文档”，而是压缩为：

```text
one stable authority per concept
+ one machine constraint registry
+ one machine decision ledger
+ generated navigation/projection
+ Issues for unresolved decisions
+ Evidence for experiments
+ archive for superseded history
```

## 2. 文档职责只保留六类

### Navigation

只指向唯一 owner，不拥有语义。README、`docs/README.md` 和未来 assembly projection 属于此类。

### Stable authority

只保存长期稳定的产品、边界、不变量、状态语义和职责。每个稳定概念只有一个 owner。

### Machine contract or registry

保存可执行字段、枚举、owner、关系、状态和动态支持信息。Prose 不复制完整 schema 或算法。

### Current control

只保存当前 Work Package、rolling plan 等短期动态控制事实，并与稳定 authority 分离。

### Decision / Issue

保存尚未裁决的问题、竞争方案、反例、触发条件和验收，不作为当前能力或正式设计入口。

### Evidence / Archive

Evidence 保存测量、运行和研究来源；Archive 保存已被取代的历史。二者都不参与当前 selector 或 canonical lookup。

## 3. Assembly 不建立第二架构 authority

`docs/system-architecture.md` 继续唯一拥有总体分层、authority flow、single writer 和 workspace zones。

Phase B 不再创建拥有语义的 `docs/architecture-assembly.md`。允许的产物是：

- `docs/governance/architecture-assembly.yaml`：机器关系投影，`owns: []`；
- 由该投影生成或更新 `docs/README.md` 的导航部分；
- Federation reference-closure machine contract；
- duplicate owner、missing target、revision mismatch、forbidden authority cycle 和 unresolved frontier tests。

任何人类可读 Assembly 只能是 generated/navigation projection，不能重新解释或复制领域算法。

## 4. 迁移协议

每项独立 decision 必须经过：

```text
identify decision
→ read latest main and current owner
→ adopt | adapt | reject | defer | experimental
→ update exactly one canonical owner or experiment owner
→ migrate consumers
→ add negative / compatibility / physical proof
→ retire parallel active expression
→ new-main readback
```

“新增新文档但旧 proposal 继续 active”不算迁移完成。

## 5. 综合 Spike 的确定处置

### PR #226 — 全球架构与一手技术谱系

**Disposition：adapt and absorb.**

吸收目标：

- 产品永久边界 → `docs/product.md`；
- Federation/reference closure → `docs/system-architecture.md` + machine contract；
- Source Program → `docs/brownfield-import.md` 或 focused source owner；
- Responsibility → `docs/semantic-model.md` 或 focused responsibility owner；
- Type/Behavior/Query → `docs/compiler-target-ir.md`；
- Effect/Resource/Capability → focused shared protocol owner；
- Compatibility → `docs/change-management.md`；
- Support Claim → runtime/release/verification owners；
- Publication durability → `docs/semantic-mutation.md` + physical runtime contract。

不吸收九文件 proposal 结构，也不把 110-source ledger 变成 architecture authority。来源 ledger 归类为 research Evidence。

Retirement：decision 全部迁移后，PR #226/Issue #225 标记 `absorbed research`，proposal 只保留 archive/evidence 身份。

### PR #229 — Agent Skill System V2

**Disposition：adapt.**

采纳 Role、Operation Envelope、one Primary Skill、permission intersection 和 typed outcome。Skill 数量和角色名称保持 experimental。

Activation：当前 Skill responsibilities 已 census，pure contracts 与 historical routing evaluation 可启动时。

Retirement：新 router、permission、transition consumers 完成 trusted cutover 后，旧重复 lifecycle prose 删除；PR #229 转 archive。

### PR #231 — Development Throughput Architecture

**Disposition：adapt.**

采纳 Candidate Closure orchestration、read-only plan first、Action Key before CAS、failure reuse for diagnosis、derived Repository Semantic Index、typed publication receipt 和 ready-to-main metrics。

各子状态分别迁入 Issue #177/#178/#179/#188/#189/#190/#194/#207/#205/#219/#221 或新的 focused owner，不保留一个吞吐总状态机。

Retirement：所有组合节点有唯一 owner 且 Candidate Closure read-only contract 进入 main 后，PR #231/Issue #230 标记 `absorbed synthesis`。

### PR #233 — Convergence Baseline

**Disposition：decision source only.**

它不是 canonical authority，也不整体合并。正式迁移完成后：

- constraints 转入相应 canonical owners 与 docs-doctor rules；
- decisions 转入 owner docs/Issues；
- DAG 转入 roadmap/current selector owner；
- relation projection 由 machine registry 生成；
-本目录整体进入 archive。

## 6. Issue #222 与 #224

### Issue #222 Web Frontend

采纳，但拆到 Source Program、Target Profile、Browser Verification、Mutation 和 Support Claim owners。不创建 Web 总域。

Activation：TypeScript self-observation、governed Mutation 和 Brownfield Adopt 已有现实闭环。只读 corpus 可提前，不成为正式前置。

### Issue #224 Responsibility

属于产品核心，必须迁入 canonical Responsibility contract、Source Program candidate producer、Impact rules 和 Mutation operation registry。

Retirement：责任合同、自观察 corpus 与一个责任级 Mutation 进入 main 后，Issue 转 implemented/absorbed。

## 7. 当前已注册 Proposal 的明确处置

### `docs/proposals/development-run-kernel.md`

- disposition: adapt;
- canonical targets: `docs/development-governance.md`, Issue #177 candidate/failure, Issue #179 Evidence/Run Journal, Candidate Closure focused owner;
- activation trigger: Candidate Closure read-only contract and exact state-owner boundaries exist;
- prohibited: owning Verification Result, Mutation terminal or Integration Epoch;
- retirement target: machine Run transition consumers cut over, then archive proposal.

### `docs/proposals/engineering-workspace-domains.md`

- disposition: adapt;
- canonical targets: `docs/system-architecture.md`, `docs/roadmap.md`, and each activated domain authority;
- activation trigger: a real consumer requires a domain with its own raw/validated boundary, identity/revision, producer and Mutation;
- prohibited: one giant optional Workspace object or pre-creating every future domain;
- retirement target: adopted domain decisions are mapped to unique owners and the generic proposal moves to archive.

### 其他 Proposal

每个 proposal 必须在 `docs/authority.json` 或配套 lifecycle registry 中具有且仅具有一种状态：

```text
canonicalTarget
activationTrigger
experimentalEvidence
rejectedReason + reversalCondition
retirementTarget
```

没有 disposition 的 indefinite draft 必须使 docs doctor 失败。

## 8. 未来内容的极简规则

1. 没有真实 consumer，不写完整未来 schema、package layout、workflow 或 state machine。
2. 未来设计默认只记录：不变量、owner、trigger、proof obligation、migration、retirement。
3. 同一 decision family 同时最多一个 active proposal；其他版本必须 superseded 或 archived。
4. 字段和算法进入代码合同；文档只解释含义和边界。
5. 动态 SHA、PR、run、支持矩阵、性能数字不进入稳定文档。
6. 研究来源只支持 rationale，不成为产品 runtime dependency。
7. 只有正式 Work Package 启动时才扩写实现级规格。
8. 每个新增 active 文档必须同时说明它替代、合并或为何不能归入现有 owner。
9. 文档优化以减少 active authoritative surfaces 和 update fan-out 为目标，不以压缩字数为唯一目标。
10. Architecture/Skill/Throughput 不得再各自生成一套并列“最终总装”。

## 9. Canonical 迁移批次

### Batch A — Reference closure and documentation lifecycle

- Federation reference-closure contract；
- generated assembly/navigation projection；
- proposal lifecycle/disposition validator；
- no new architecture authority。

### Batch B — First product slice contracts

- Source Program；
- Responsibility；
- only the Effect/Resource/Capability subset consumed by first Mutation。

### Batch C — Integrity and delivery

- Verification truth；
- Candidate Closure read-only service；
- Agent Role/Operation pure contracts；
- Integration resolver correctness。

### Batch D — Product implementation

- TypeScript self-observation；
- Responsibility Impact/Explain；
- Governed Mutation；
- minimal Target/Type/IR/Lowering；
- Workbench shared facade。

### Batch E — Acceleration and expansion

- Evidence/Run、Test Impact、Query/Feedback、safe virtual merge；
- Brownfield、Web、Release、Registry。

## 10. 每个文档迁移 PR 的退出条件

- exact latest main and owner read；
- one indivisible decision family only；
- no duplicate stable owner；
- consumers and compatibility enumerated；
- old active expression retired or time-bounded；
- docs doctor, authority and relationship tests pass；
- independent Review；
- squash merge and new-main readback；
- proposal/Issue/branch closeout receipt。

## 11. 最终 active 文档形态

```text
README.md / docs/README.md                    generated or navigation
docs/authority.json                           document identity/lifecycle/ownership
docs/system-architecture.md                   one architecture authority
docs/<domain>.md                              one stable owner per domain
platform/shared/<domain-contract>/            executable contracts
docs/work/**                                  current control only
docs/evidence/**                              measurements and research evidence
docs/archive/**                               superseded history
gitHub Issues                                 unresolved decisions and activation
```

完成后，不再保留 `docs/proposals/**` 中并列的 architecture/Skill/throughput “最终版本”。
