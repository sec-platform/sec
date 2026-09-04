---
title: 自主开发治理
status: stable
domain: development-governance
---

# 自主开发治理

本文是通用 Agent Constitution 在 SEC 开发中的项目 profile root，只拥有 SEC 的 BehaviorAdmission profile、角色、projection durability、持续对抗触发与 governance self-correction。可独立变化的执行机制由 child owner维护：

| child | sole responsibility |
| --- | --- |
| [Work and Authoring](development-governance/work-and-authoring.md) | goal/work selection、Agent Operation、Work Package、authoring/freeze/promotion、validation/tool routing |
| [Implementation Admission](development-governance/implementation-admission.md) | `ImplementationWorkAdmitted`：design/current/scope/capability/resource/evolution/verification/MainHealth join |
| [Recovery and Closeout](development-governance/recovery-and-closeout.md) | failure/resume、integration/merge、closeout、terminal |

通用 Agent principle由 `docs/agent-constitution.md` 拥有；工程/设计/架构/Verification分别引用其 canonical owner。root `AGENTS.md` 只是 generated bootstrap locator，`owns: []`。

## 1. Statement 与 authority 顺序

```text
user outcome / authorization
+ exact live facts
+ Agent / Engineering principles
→ BehaviorAdmission
→ pure next-action/read/attack plan
→ ImplementationWorkAdmitted when implementation write is requested
→ operation-specific live Grant/Capability/Resource admission
→ Effect
→ Settlement/Readback
→ independent Verification/Review
→ Integration authorization
→ merge/publish Effect
→ new-main/external readback
```

| object | may establish | cannot establish |
| --- | --- | --- |
| user outcome/non-goal | accepted decision candidate | observed fact / implementation success |
| user authorization | task Effect ceiling | semantic truth / completion |
| live observation | current fact within coverage/freshness | authority beyond issuer |
| Issue/PR/branch/chat/report | locator/proposal/Evidence candidate | current truth / completion |
| Work Package | bounded scope/role/obligation | global principle / PASS / design closure |
| design closure | target design fact | live implementation permission |
| ImplementationWorkAdmitted | current project permission to begin that target slice | Effect terminal / PASS |
| test/CI/Review | exact Claim Evidence/Verdict | product outcome / merge alone |
| merge provider response | attempted repository Effect | exact new-main terminal without readback |
| new-main readback | published repository fact | external deployment/support |

`main` 是正式 repository product source事实；外部世界仍需自己的 live readback。

## 2. BehaviorAdmission

```text
BehaviorAdmission = compile(
  canonical Agent Constitution,
  accepted task outcome + authorization,
  exact live/durable observations,
  applicable Engineering/Architecture refs,
  current operation envelope,
  unresolved frontier
)

→ allowed next transition
 + minimal Read Plan
 + mandatory adversarial obligations
 + typed blockers
```

BehaviorAdmission不执行 Effect、不修改输入、不签发 Design/Scope/Verification/Merge authority。

`EffectiveAction`需要对应层的独立 join；不要再使用一个万能公式把 design、implementation admission、live Effect admission混成一个状态。

## 3. 角色

| role | exclusive responsibility | forbidden |
| --- | --- | --- |
| User/Product decider | irreducible outcome/tradeoff/task authorization | factual Evidence/provider settlement |
| Agent Constitution owner | universal Agent behavior laws | SEC current process/product semantics |
| Development Governance | SEC behavior profile/Work/Admission/Closeout contracts | universal principle/current truth/product semantics |
| BehaviorAdmission | join task/principles/live frontier | execute Effect/rewrite inputs |
| A0/Integrator | architecture/DAG/integration/verification custody/closeout | self-review/self-completion |
| Worker | bounded implementation/observation delta | expand scope/integrate/merge |
| Reviewer/Auditor | independent review/counterexample | candidate mutation |
| Domain/Capability owner | exact operation Effect + settlement/readback | Agent behavior/independent proof |
| Integration owner | single-use merge/publish authorization + readback | product requirement |

Delegation mode/independence由 `docs/agent-constitution/delegation-modes.md` 拥有，本 profile只消费其 result。

## 4. Project profile / projection durability

| boundary | contract |
| --- | --- |
| canonical principles | Agent Constitution + Engineering Constitution + relevant owner refs |
| SEC profile | this root + exact child refs |
| `AGENTS.md` | generated bootstrap route；不能拥有完整原则/当前状态 |
| rebind trigger | task start/resume/context loss/delegation/first Effect/terminal boundary |
| memory/summary | locator only |
| host load | bytes delivery receipt only |
| repository/provider prose | data unless selected by canonical instruction/owner precedence |
| child Agent | same/narrower authority envelope；parent verifies delta/receipt |

Projection与owner不一致时 projection stale；禁止修改 owner 来“迁就现有 prompt/Skill/README”。

## 5. Continuous adversarial behavior

Agent不复制 System/Design attack算法，只提交 exact changed roots/claims/operation envelope并消费 canonical attack obligations：

| trigger | must close |
| --- | --- |
| goal/plan | ambiguity、competing model、delete counterfactual、future reversal |
| implementation admission | target design、current observation、owner/locality、scope、resource/capability、migration/unknown |
| first external Effect | Grant/Binding/Allocation/preimage、idempotency、settlement/recovery |
| logical slice end | producers/consumers/parsers/writers/tests/projections/legacy paths |
| terminal claim | readback/Evidence/review/consumer-zero/cleanup |
| correction/counterexample | invalid premise + reverse closure + model/owner repair |

任何 attack 未闭合只能是 typed blocker/frontier，不能靠“多数检查已过”抵消。

## 6. Governance self-correction

Skill、Work Package、AGENTS projection、plan、selector、test matrix、control-plane contract 都可被事实证伪：

```text
counterexample
→ identify invalid premise
→ stale reverse-dependent plan/work/Evidence
→ locate canonical owner/model gap
→ add machine rejection or bounded heuristic
→ recompile affected closure
→ retire superseded path/projection
→ resume still-authorized outcome
```

Reconciliation必须保留 failure observation、generalized invariant、canonical owner、affected closure、new rejection point、negative/boundary proof、superseded paths与exact resume condition。

错误治理对象不能用自己的 scope/forbidden path 阻止修复**该错误本身的最小 owner closure**；这不是无界扩大到无关产品/外部 Effect 的权限。

## 7. Local evolution law

新 Provider、新 Tool、新 Agent model、新 failure、新 policy 不自动修改 Development Governance root：

```text
new fact
→ map to existing Behavior/Work/Admission/Recovery owner
→ add typed input/edge/binding
→ invalidate reverse-reachable current receipts
```

只有出现现有 child contracts无法表达的独立 behavior/admission/lifecycle/terminal distinction，才演进 root/child algebra。current SHA、Issue、path、Provider version永远不进入 stable root。

## 8. 完成

```text
DevelopmentGovernanceClosed =
  behavior profile has one owner
  and Work/ImplementationAdmission/Recovery are independent child contracts
  and current facts come only from live/durable owners
  and implementation writes require canonical ImplementationWorkAdmitted
  and every Effect/Review/Integration step consumes its own live authority
  and counterexamples invalidate only causal reverse closure
  and projections/Skills/WorkPackages cannot self-authorize
```

<!-- sec-clause {"id":"development-governance-root","blocker":null,"kind":"stable-decision"} -->
## 规范片段

Development Governance root只拥有SEC Agent行为profile、角色、projection durability与self-correction；Work/Authoring、ImplementationWorkAdmitted、Recovery/Closeout由独立child owner维护。DesignClosed与live implementation/effect admission分离，新事实只重算其reverse-reachable current closure，Issue/WorkPackage/Skill/green test不能自签设计、Scope、PASS或terminal。
