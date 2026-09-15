---
title: 工作选择、Operation 与 Authoring
status: stable
domain: development-governance
---

# 工作选择、Operation 与 Authoring

本片段拥有 goal/work selection、Agent Operation、Work Package、authoring/freeze/promotion、impact/typecheck 与外部工具路由。

## 7. Goal、work selection 与计划

### 7.1 Selection order

```text
terminal user outcome
→ current exact repository/external facts
→ MainHealth: ordinary | repair | locked
→ existing work identity/spec reconciliation
→ WorkDecision
→ smallest coherent root-cause DAG
```

ordinary 才做 WorkDecision；repair 只消费 owner-issued repair decision；locked 停止。Issue catalog、roadmap、PR prose 和 chat 不在 MainHealth 前抢占 routing。

当前 checkout 的候选选择消费完整 open PR inventory，并以同一 canonical Git observation 的 current branch/HEAD 与 PR head branch/SHA、default base branch/exact main 唯一匹配。多个独立 PR 本身不构成歧义；零匹配、重复匹配或后续身份漂移保持 unresolved。registry 继续保留并验证所有 PR，current lifecycle 只绑定选中 PR 的 exact number/base/head entry；不得通过关闭、隐藏其他 PR 或 caller hint 制造唯一性。detached/default checkout 不由该规则推定候选，仍消费对应生命周期路由。

选择当前候选不得裁剪完整 non-default local/remote refs 与 worktree census。branch-lifecycle owner 显式区分 active transport、与其他 exact open PR 对应的 preserved transports 和其余 closeout obligations；preservation 必须绑定实际 PR/branch/head/base 与一致的物理 ref/worktree 身份，并进入同一 projection digest。未映射、重复、漂移或 orphan subject 保留 blocker，不能以 registry 中存在另一 PR 代替物理责任，也不能在 caller 过滤掉这些对象后宣称 closeout 为 none。

### 7.2 Records

| Record | Owns | Does not own |
| --- | --- | --- |
| Product spec | outcome/boundary/success | current plan |
| Architecture spec | relation/constraint/owner/DAG | domain fields |
| Roadmap | stable capability dependency and entry/exit | current status |
| Issue | one real problem/decision/acceptance/counterexample | execution log |
| Rolling projection | active + next bounded candidates | backlog authority |
| Work Package | frozen delivery scope/owners/capabilities/Evidence | global principles |
| Operation Envelope | one actor/role/operation/seam/budget | integration |
| PR | exact candidate diff/review surface | completion |
| Evidence | exact Claim facts | roadmap/authority |

## 8. Agent Operation System

### 8.1 Objects

| Object | Required content | Authority |
| --- | --- | --- |
| Task Capsule | pure unbound planning content、goal/scope candidate、non-goal | none |
| Scope Grant | exact base、allowed/forbidden Effect、resources、trust epoch | trusted issuer |
| Operation Read Plan | minimal owner clauses/symbols/unknown + read budget | read only |
| Skill Applicability | zero-or-one bounded heuristic recipe | no product/Effect authority |
| Operation Envelope | actor、role、operation kind、subjects、bounds、obligations | upper bound only |
| Action Plan | normalized pure executable requirements | no Effect |
| Effect Grant | principal+subject+operation+budget+validity | operation-specific |
| Settlement/Readback | actual provider/domain result | issuer-specific |

Task Capsule、manifest、pointer、journal、digest、本地 ref/file 或 self-generated JSON 不是 issuer credential。

### 8.2 Lifecycle

```mermaid
stateDiagram-v2
  [*] --> Oriented
  Oriented --> Selected: MainHealth + WorkDecision
  Selected --> Scoped: trusted Scope Grant
  Scoped --> Designed: DesignAdmission closed
  Designed --> Authoring: one mutable candidate
  Authoring --> Reconcile: logical slice delta
  Reconcile --> Authoring: frontier remains
  Reconcile --> Frozen: implementation obligations closed
  Frozen --> Verifying: affected Claims/Actions
  Verifying --> Review: required Evidence sufficient
  Review --> Integrating: fresh independent verdict + authorization
  Integrating --> Readback
  Readback --> Complete: new-main + closeout + replan
  Authoring --> Blocked: external/authority/unknown
  Integrating --> RecoveryRequired: ambiguous Effect
```

Current capability只有 machine contract + producer/consumer + failure/recovery + focused Evidence + new-main readback闭合后 active；stable docs 不维护 current matrix。

生命周期中的`Designed`只在设计演算 owner 的
`ImplementationWorkAdmitted(targetSlice)`成立时成立：它同时要求递归
`DesignClosed`、`AdversarialFixedPointClosed`、同一输入世代的实现/符合性冻结回执
以及局部性、owner、资源、演进与未知边界闭合。没有该谓词只能做纯设计、观察或
bounded experiment，不能开始实现写入；这条引用不复制准入逻辑，也不把本文件变成
设计事实 owner。

## 9. Work Package 与 ownership

Work Package freezes:

```text
problem/outcome + non-goals
+ exact base and scope
+ responsibility/owner DAG
+ worker envelopes and forbidden overlap
+ capabilities/resources
+ acceptance/Claims/Evidence
+ migration/retirement/closeout
```

### 9.1 Delegation decision

| Condition | Decision |
| --- | --- |
| independent bounded read/implementation seams + material speed/quality/context gain | delegate |
| same canonical writer/file/state/branch/external Effect | single writer |
| unclear ownership or shared mutable artifact | do not delegate; refine DAG |
| tiny task or coordination cost ≥ work | local |
| reviewer must be independent | separate read-only reviewer |

Child receives only required context and narrower Envelope. A0 retains current authorization, architecture, integration and final verification.

### 9.2 One logical run

```text
active mutable worktrees per logical run = 1
active candidate refs per logical run = 1
finding successor worktrees = 0
```

Parallel pure reads/independent workers are allowed；concurrent writes to same owner/file/state/lock/generated artifact/branch/external object are not.

## 10. Authoring、freeze 与 promotion

Document-control freeze 还提供一个显式 `proposal-only` authoring lane，用于在 manual Tier 0
operator 尚未签发 activation authority 时生成唯一的候选投影。它只在当前 pointer 所指
manifest 与 live exact default 中的 blob byte-exact、active resolution 为
`none / matching-default-blob`、目标 manifest 为 `tracking:none` 且其 `base` 等于 live
exact default SHA 时成立。pointer、rolling plan、旧 pointer-bound predecessor manifest 的退休、index
publication 与 readback 仍由同一个 document-control renderer 和事务 owner 完成；result
及 recovery journal 始终标为 `PROPOSED`。
rolling projection 的唯一 owner 同时生成显式 `authority:none` 的machine view，绑定exact
main/tree与target manifest identity；其digest只保护表示完整性，不产生任何authority。

该投影不接收或产生 WorkDecision、MainHealth repair、activation receipt、
IntegrationAuthorization 或 merge authority。正常 activation lane 仍必须消费真实
WorkDecision；selection 失败不能降级为 proposal-only。候选合入 default 后，pointer
manifest 与 default blob 相同只解析为 `state:none / matching-default-blob`，不会因投影
已发布而产生 active Work Package authority。

| Phase | Allowed | Forbidden |
| --- | --- | --- |
| Authoring | mutate authorized candidate、focused/incremental proof | hosted status、merge claim |
| Reconciliation | compile before/after consumer/effect/test/state closure | commit-as-closure |
| Freeze | exact tree/environment/Bindings、stop mutation | evidence on moving target |
| Verification | ActionKey reuse/execute missing Claims | broad rerun by habit |
| Review | independent exact subject counterexample | producer self-approval |
| Promotion | single-use live authorization + CAS/readback | blind merge retry |
| New-main | reload truths/owners/capabilities、retire old epoch | continue old grant |

Commit 是 local repository Effect，seal 一个已闭合 slice；它不能创造闭包。每个文件Effect遵循：

```text
plan(preimage,target)
→ acquire workspace lease
→ final pre-effect fence
→ write/rename/delete
→ durability/readback
→ settlement/residue
```

staging/format/import rewrite 必须限制于 task-owned exact paths；不能吸收 unrelated dirty。

## 11. Impact、typecheck 与验证成本

Development operation复用System Architecture唯一的`RequiredExecutionClosure`与`ExecutionSet`；本层只提供当前delta、operation与Claim roots，不重定义impact/reuse代数。

| Fact | Behavior |
| --- | --- |
| fresh PASS | reuse |
| fresh deterministic failure | reuse failure; stop |
| authenticated in-flight | join |
| missing/stale | execute once |
| unknown start/outcome | reconcile/block |

Source snapshot、Source Program facts、dependency closure、typecheck/test-impact/audit inputs共享，不各自扫描。编辑期使用 Language Service/affected canonical typecheck；full frozen proof只在 Claim 需要时一次。同一 TypeScript revision、config、dependency generation、tree 的 PASS 以 Action identity复用。

Performance optimization order：

```text
delete duplicate owner/scan
→ share exact snapshot/facts
→ narrow dependency/Claim closure
→ reuse terminal/in-flight
→ improve provider implementation
→ parallelize independent pure work
```

不得以放宽 coverage/identity/unknown/readback 换速度。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
### 11.1 Validation Route Compiler

验证入口不是按文件扩展名或“上次用了什么命令”选择，而是由 exact semantic
delta 编译出的最小路线：

```text
ValidationRoute =
  docs-graph
  | source-program
  | import-graph
  | owner-sentinel
  | runtime-effect
  | final-exact

compileValidationRoutes(delta, sourceGeneration, claimGraph):
  classify changed relations and affected claims
  select RequiredClosure ∩ MissingOrStale routes
  require every selected route's input generation/provider/ActionKey
  reject path-only escalation, duplicate route owners and hidden side-reads
  emit route set + skipped-route reasons + unknown frontier
```

| 变化关系 | 最小路线 | 明确跳过 |
| --- | --- | --- |
| 仅 documentation source/header/relation/view | `docs-graph`（semantic graph、link/renderer、migration frontier） | `imports:apply`、`imports:freeze`、TypeScript `tsc`、runtime Effect |
| 语言声明、import/export、package/config 或 Source Program 输入 | `source-program` → 受影响的 `import-graph` | 未受影响模块的全量重编、第二 AST/解析图 |
| 仅实现 owner 的纯算法/contract | owner sentinel + 受影响 property/contract claims | 全仓测试、无关 import freeze |
| provider、process、filesystem、Docker、network、credential 或持久 state | owner sentinel → `runtime-effect`/readback | 用纯 typecheck 或 provider exit 替代 Effect 结算 |
| release/freeze/merge 或 Claim 要求 exact environment | `final-exact` 一次（frozen tree/environment） | 在 moving tree 上重复 expensive Evidence |

`imports:apply` 只在 selected `import-graph` route 且存在可重写的 task-owned
TypeScript targets 时运行；`imports:freeze` 只在 apply 后且 import graph 确实改变时
运行。两者均为有界的单写者 operation，不得由 docs-only、测试数据或无 import 语义的
文本变更触发。裸 `tsc` 只作为 `final-exact` 的 canonical type contract（或 owner
明确声明的受影响 type claim），编辑循环优先复用 Language Service、Source Program
fact shards 与已有 ActionKey；没有受影响 claim 时必须记录 skip，而不是执行 no-op
全量检查。

每条 route 都必须输出 `selected | reused | skipped | blocked` 与 exact reason、输入
generation、provider/algorithm、resource allocation 和 unknown frontier。route 选择本身
不改变 scope、Authority 或 completion；route 失败沿其 owner 的 typed failure 结算，不能
通过升级到全量命令把 unresolved、预算耗尽或 provider 不可用伪装成 PASS。

## 12. External capabilities 与工具

采用成熟工具由 `docs/external-provider-policy.md` 决定。普通离散操作直接消费最窄稳定 machine interface；只有 protocol/credential/Effect/resource/settlement/security/compatibility 边界需要薄 Adapter。

shell 是 process transport，不签发 semantic/completion truth。Presentation output 不解析成 authority；Git 使用 porcelain/NUL-safe/object interfaces，JSON/YAML使用 strict parser。工具缺失不触发临时安装，除非 task 明确授权 provisioning。
