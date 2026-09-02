---
title: Semantic Mutation 事务
status: stable
domain: semantic-mutation
---

# Semantic Mutation 事务

## 1. 所有权与定位

Semantic Mutation 把受限意图在重新派生的 authority、owner、source mapping、Delta/Impact 与 Verification 边界内发布为 canonical source transition。本文拥有 transaction state machine、授权消费、plan/apply 分离、writer coordination、publication 与 recovery 不变量。

| 可写 | 不可作为 caller 写目标 |
|---|---|
| Authoring Source | Engineering IR、Target IR |
| Adopted Governed Source | Projection、Artifact、Evidence |
| domain 明确授权的输入 | journal、control state、cache |

它不是 AI patch executor、任意文件 writer、artifact publisher 或 compatibility owner。

<!-- sec-clause {"blocker":"current-maturity-projection-unavailable","kind":"temporary-safety-denial"} -->
### 当前安全否认

在 generated maturity projection 未接管前，现行公开 surface 只能投影为：

| 当前已证缺口 | 当前能力结论 |
|---|---|
| plan 会取 lease、建删目录、复制 workspace、写 staging | public-plan-effectful |
| production ingress 不强制不可伪造 issuer grant | not-production-authorized |
| staging 可能早于 prepared intent | staging-before-prepared-journal |
| journal 保存 caller projection 且 recovery authority 未闭合 | authorization-recovery-unresolved |
| Workspace→Mutation 与 Mutation↔Verification owner cycles | dependency-owner-cycle-unresolved |

这些 denial 只收窄能力，不证明 positive maturity。修复后由 exact-tree projection 原子迁出；测试 fixture、管理员权限、caller JSON 或 self-digest 不能临时解除。

## 2. 角色与权限

~~~mermaid
flowchart LR
  C[Caller] --> I[Intent]
  I --> PP[Product policy]
  PP --> GR[Issuer-bound grant]
  I --> OR[Operation registry]
  GR --> PL[Pure planner]
  OR --> PL
  SO[Source ownership] --> PL
  SP[Source Program receipt] --> PL
  PL --> P[Immutable plan]
  P --> TX[Transaction executor]
  TX --> J[Journal]
  TX --> E[Effect capability]
  TX --> D[Delta and Impact]
  TX --> V[Verification]
~~~

| 角色 | 拥有 | 不能提交/拥有 |
|---|---|---|
| Caller/User/AI/CLI | intent、target、允许参数、expectation | path/owner/Delta/Impact/risk/terminal |
| Product Policy | authorization draft policy | physical Effect |
| Trusted issuer | bound execution grant | semantic target definition |
| Operation Registry | operation discriminant、requirements、claims | transport switch |
| Source Ownership | unique owner、writable region | semantic mutation result |
| Planner | deterministic zero-Effect plan | lease/staging/publication |
| Executor | lease 内 replan/apply/settle | product semantics |
| Journal/Recovery | durable execution facts | authority minting、IR |
| Delta/Impact/Verification | actual change、affected closure、proof | source writer |

Agent Operation、Engineering Operation 与 Source Mutation Operation 是不同 identity/authority 域。

## 3. Authorization

~~~text
MutationGrant =
  IssuerBoundPrincipal
  ∩ CallerCapability
  ∩ AllowedOperation
  ∩ SemanticTarget
  ∩ CanonicalSourceOwner
  ∩ PhysicalRegion
  ∩ PreconditionsAndPreservation
  ∩ PolicyAndForbiddenEffects
  ∩ ProviderCapability
  ∩ RequiredClaims
  ∩ CurrentWorkspaceRevision
~~~

任一项 unknown、ambiguous、stale、conflicted 或不兼容即 block。Grant 绑定 workspace、domain、operation、target、base semantic/source revisions、policy/revocation epoch、principal、Effect/Permission、provider 与 expiry；不能跨 rebase、owner migration、provider drift 或 registry evolution 复用。

## 4. Operation Registry

每个 operation 记录：

| Facet | 内容 |
|---|---|
| identity | unique discriminant；只在真实版本 consumer 存在时 versioned |
| target | kinds、required predicates |
| caller input | 可给字段与禁止 derived 字段 |
| source | owner/adapter/mapping requirements |
| Effect | allowed/forbidden paths、capabilities、budgets |
| invariant | preconditions、must-preserve、postconditions |
| change | expected Delta、additional-change policy |
| proof | owner-issued required Claim refs |
| settlement | idempotency、retry、rollback、recovery、compatibility |

不存在 registry entry 时 unsupported-before-write。transport/UI 不复制 operation switch。

## 5. Pure Plan

~~~mermaid
flowchart TD
  R[Raw request] --> V[Validate]
  V --> A[Resolve grant and base]
  A --> T[Resolve target owner path]
  T --> X[Isolated transform]
  X --> B[Canonical rebuild]
  B --> D[Preview actual Delta]
  D --> C[Expectations and preservation]
  C --> I[Impact and unknown frontier]
  I --> Q[Claims resources risks]
  Q --> P[Immutable plan or blocked]
~~~

目标 plan/dry-run 的 Effect 集合严格为空：

~~~text
Effects(plan) = empty
~~~

Plan 绑定 operation/grant/base revisions、source bytes、owner/path proof、preview Delta/Impact、Claim refs、provider/toolchain/profile、estimated resources 与 expiry。它不能获取 writer lease、创建 staging/journal/cache/目录、启动 side effect 或把临时 bytes 当 authority。当前 effectful plan 在 cutover 前保持 unavailable。

## 6. Source Mapping 与 Path Proof

~~~mermaid
flowchart LR
  SR[Semantic Responsibility authority] --> AB[Adopted source binding]
  AB --> SP[Exact Source Program observation]
  SP --> J[Unique mapping join]
  J --> PP[Path and region proof]
~~~

Source Program 只证明 file/symbol/span/module/reference/physical owner 与 unknown；不能创造 semantic owner、allowed operation、Effect grant 或 support。

Path proof 至少验证：

| 维度 | 要求 |
|---|---|
| logical | repository-relative canonical Address |
| physical | retained platform resolution、containment、type、mode |
| identity | workspace/repository/source bytes/revision |
| owner | adopted owner 与 writable region |
| topology | symlink/reparse/junction/case/Unicode |
| classification | authoring/governed/generated/opaque/unowned |
| forbidden | control、journal、IR、Evidence、unowned region |

absolute path、UI path、glob、related files 或字符串拼接不产生写权限。Workspace 只能提供 observation/query contract，不得反向 import Mutation runtime。

## 7. Isolated Transform

Transform 在内存或 operation-owned isolation root 中执行：

- 输入只来自 plan 引用的 frozen authoritative source/context；
- output deterministic 且有 canonical formatting；
- comments、format、unowned regions 有明确 preservation；
- 不执行 ambient install/build/script/network；
- secret/environment 只按 capability allowlist；
- time/memory/process/network/output 有共享预算；
- parse/type/rebuild 失败时 live workspace 零变化；
- AST/LST/codemod/AI output 只是实现或 proposal，不证明 parity。

## 8. Expectation、Delta、Impact

| 检查 | 失败结果 |
|---|---|
| required change 未出现 | block |
| forbidden change 出现 | block |
| must-preserve 变化 | block |
| additional change 无 allowance | block |
| source/artifact 无 semantic provenance | block |
| unknown/opaque 超出 grant | block |

Predicted preview 不可作为 actual。apply lease 内 rebuilt result 与 plan 不等价时 replan 或拒绝。Impact 只转发 Verification owner 签发的 Requirement/Claim refs；Mutation 不拥有 selector、ActionKey、Result 或 Aggregate。

## 9. Apply

~~~mermaid
sequenceDiagram
  participant X as Executor
  participant L as Writer lease
  participant J as Journal
  participant E as Effect owner
  participant V as Verification

  X->>X: validate request and plan identity
  X->>L: acquire unique writer
  X->>X: reobserve owner source policy providers
  X->>X: replan and compare equivalence
  X->>J: publish authenticated prepared intent
  X->>E: stage writes and recovery material
  X->>V: prepublication claims
  X->>E: source and semantic CAS publish
  X->>X: live rebuild actual Delta and Impact
  X->>V: postpublication and readback claims
  X->>J: terminalize
  X->>L: release plus cleanup receipt
~~~

Prepared intent 必须早于本 transaction 第一个 durable directory/staging/backup/source Effect。所有 phases 共享一个 absolute deadline、AbortSignal、resource ledger 与 commit fence。另一个 writer、manual edit、rebase、owner/policy/Target/Provider drift 都使旧 plan stale。

不同 operations 只有资源/owner resolver 证明不相交时才能并行；路径不同本身不够。

## 10. Publish 与 terminal

多文件 mutation 使用 staging、journal、commit marker 和 recovery；不做逐文件 best effort。Mutation write set 只含 authoritative source inputs；derived artifacts 由 Compiler/Runtime owner 重建，跨 revision compensation 由 Change Management 拥有。

Publication observation：

| 状态 | 处理 |
|---|---|
| definitely not published | 可安全拒绝/清 stage |
| definitely published | 进入 readback/Verification |
| durability/publication unknown | 保留 journal/recovery material |

process exit、file exists、rename success 或缺失 parent fsync 不能单独证明 durable publication。

产品 terminal 只有：

| Terminal | 条件 |
|---|---|
| accepted | source 已发布；live rebuild、actual Delta、required Verification/readback 通过 |
| rejected | 未发布 live change；原因和 next action 明确 |
| rolled-back | exact prior bytes/modes/state 恢复并验证 |
| recovery-required | 不能证明 accepted 或 exact rollback |

不存在 partial-success、accepted-with-warning 或 failed-but-files-written。blocked 是 plan 状态，不是 terminal。

## 11. Journal

~~~text
Journal owns execution facts;
Journal does not own semantic truth, grant issuance, Evidence truth or UI state.
~~~

| 必须绑定 | 禁止作为 authority |
|---|---|
| transaction/operation/grant locator/plan | caller projection/self-digest |
| workspace/base/live revision、lease | path/ACL/admin identity |
| owner/path proof、write set | journal 自身存在 |
| prior/staged/published identities | expired authorization payload |
| phase、Verification refs、cleanup、terminal | test issuer |
| recovery preconditions、retention lineage | timestamp-only ownership |

Durable schema 绑定 exact byte grammar；同一 revision 不能接受第二 serialization。算法/required-key 变化需要新 schema 与 one-way migration，不得刷新 fixture 或永久 dual-read。

Terminal replay 只返回 retained result，不重做 Effect。Compaction 保留 active、uncertain、recovery generations 与 terminal lineage。

## 12. Rollback 与 Recovery

### Rollback

- 只恢复本 transaction 拥有且仍匹配 published identity 的 entries；
- 恢复 journal 记录的 prior bytes/mode/absence/directory effects；
- 恢复后重建 canonical base state；
- 不覆盖后继 writer、unowned entry 或 unknown publication；
- rollback 失败继续 recovery-required。

### Recovery state machine

~~~mermaid
stateDiagram-v2
  [*] --> Inspect
  Inspect --> NotPublished: proof of no publish
  Inspect --> PublishedNeedsChecks: publish complete
  Inspect --> PartialOrUnknown: incomplete evidence
  Inspect --> OwnerLive: active owner
  NotPublished --> Rejected
  PublishedNeedsChecks --> Accepted: rebuild and verify
  PublishedNeedsChecks --> RecoveryRequired: checks unresolved
  PartialOrUnknown --> RolledBack: exact CAS recovery
  PartialOrUnknown --> RecoveryRequired
  OwnerLive --> Blocked
~~~

Recovery 幂等、可重入并绑定 exact transaction/generation。只有有效 grant 已开始且 journal 证明 ownership 的 settlement 可继续；尚无 Effect 的新 operation 必须重新授权。timeout 不证明 owner dead。

## 13. Verification 与 transport

Mutation 只在 prepublication、postpublication/readback 与 terminal settlement 消费 typed Verification refs。Verification owner 独立计算 applicability、ActionKey、execution、Result、Aggregate 与 freshness；双方只依赖 contract/query projection，禁止 reciprocal runtime imports。

CLI/Agent/API 只调用同一 plan/apply/query/recover adapter。Transport 不实现 owner/path/risk/Delta/Impact/Verification/terminal switch，也不是 authority issuer。无真实 consumer 时不保留 HTTP/UI/alias route。

## 14. Retention、审计与隐私

Audit 记录 operation/principal/policy、grant locator、plan/result digests、actual source/Fact Delta、Verification 与 terminal；不保存模型隐藏推理。secret、credential、source bytes、host paths、prompt 与 environment 按 classification redact/encrypt/omit。backup/journal 必须有 owner、permission、expiry 与 verified deletion condition。

## 15. 无代码逻辑验证

| 场景 | 必须得到 | 必须拒绝 |
|---|---|---|
| plan 创建 temp directory | effectful/unavailable | pure plan |
| caller 提交 owner/path/Delta | schema reject | derived authority |
| staging 先于 prepared intent | recovery blocker | 事后 journal 追认 |
| source byte相同、semantic revision变 | CAS stale | 仅 byte CAS |
| publish 成功但 readback unknown | recovery-required | accepted |
| rollback target 被后继 writer替换 | preserve + blocker | 覆盖后继 |
| process handle lost | journal/readback | 重做 Effect |
| journal含旧 caller grant | 仅 locator/历史事实 | 续租 authority |
| multi-file第二项失败 | exact rollback/recovery | partial success |
| AI codemod typechecks | transform candidate | semantic parity |
| no public transport consumer | capability obligation | alias/HTTP empty shell |

## 16. 完成条件

~~~text
MutationClosed =
  issuer-bound grant
  AND pure zero-Effect plan
  AND unique source mapping and writer
  AND prepared intent before first durable Effect
  AND source plus semantic CAS
  AND actual Delta/Impact
  AND independent Verification/readback
  AND exact rollback or typed recovery
  AND journal cannot mint authority
  AND terminal replay is effect-free
  AND legacy writers and owner cycles are retired
~~~
