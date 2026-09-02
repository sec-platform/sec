---
title: Evidence、Review 与集成证明
status: stable
domain: verification-governance
---

# Evidence、Review 与集成证明

本片段拥有 Evidence/provenance/Review、trusted bootstrap、property/fault/flake、merge authority 与 completion。

## 11. Evidence DAG、provenance 与 Review

```mermaid
flowchart TB
  C[Claim] --> E[Evidence node]
  S[Exact subject/input] --> E
  O[Observation/Result] --> E
  P[Provider/environment identity] --> E
  E --> N[Next Evidence / Aggregate]
  E --> R[Independent Review]
  N --> A[Consumer decision]
  R --> A
```

Evidence node immutable/content-addressed，引用 exact subject、Claim/Action contract、environment/provider、Result、artifacts、predecessors和invalidation。known failure可复用为failure fact，不变PASS；跨baseline组合需intervening Impact coverage。

Provenance kinds：

| Kind | Answers |
| --- | --- |
| Artifact | bytes/object从哪里来 |
| Fact | assertion为什么成立 |
| Verification | exact execution证明了什么 |
| Runtime | environment实际发生什么 |
| Provider/AI | candidate explanation + coverage/unknown |
| Resolution | requirements/candidates/eligibility/decision reasons |
| Delta | old/new/comparator/item/impact witness |
| Compatibility | rules/Delta/results/environment/user decision |

Review是独立Verification Action，绑定 exact subject、principal、owner/consumer/Effect/recovery/doc closure和unknown。prose只解释 typed findings。

## 12. Trusted bootstrap

```mermaid
flowchart TB
  T0[Tier 0 transition root] --> T1[Tier 1 evolvable verification TCB]
  T1 --> T2[Tier 2 product]
  Old[Old trusted compiler/policy] --> C[Candidate as untrusted data]
  C --> E[Old→new closure Evidence]
  E --> T0
  T0 --> Cutover[Trust epoch transition]
```

| Tier | Owns | Excludes |
| --- | --- | --- |
| 0 | Git object/ref identity、CAS/readback、principal、digest/schema primitive、TCB transition receipt | selector/product policy |
| 1 | selector、ActionKey/Evidence、Review validator、merge gate、docs/toolchain/provider policies | product behavior |
| 2 | ordinary product/engineering implementation | trust migration authority |

candidate tree是immutable untrusted data；old-main provider/compiler读取 blobs并计算 affected closure，不执行candidate compiler。candidate tests仅补充，不授权自己。只有 Tier 0自身变化进入manual break-glass；Tier 1按old trusted owner + T0 receipt迁移。

registry只保存不能从 import/source graph 推导的 static policy lower bounds；不提交 generated module/blob lock。Git hook是authoring convenience，不是TCB authority。

## 13. Property、fault 与 flake

| Technique | Contract |
| --- | --- |
| property | identity/normalization/round-trip/state/fixed-point/tie-break/clean-delta equivalence |
| shrink | preserve minimal counterexample + seed + producer revision + replay |
| fault | enumerate persistence/effect/identity chain boundaries, not one discovered leaf at a time |
| cross-platform | Windows/Linux/macOS/WSL/filesystem evidence independent |
| retry | records flake Evidence; one green never overwrites failure |
| quarantine | owner + expiry + replacement coverage + exit |
| mutation testing | calibrate critical pure validators/authorization/selector only |

effect identity chain fault corpus覆盖 authority root→component open→pre-effect→post-effect→terminal readback 的每个 replacement/crash window。

## 14. Merge authority

```mermaid
sequenceDiagram
  participant I as Trusted integration owner
  participant R as Review/MainHealth providers
  participant M as Merge Effect provider
  participant B as New-main readback
  I->>R: exact base/head/tree + scope + claims + trust
  R-->>I: fresh review/health/feedback receipts
  I->>I: compile single-use authorization
  I->>M: consume authorization + pre-effect recheck
  M-->>I: provider response / ambiguity
  I->>B: exact remote main/PR/Issue/tree readback
  B-->>I: merged / not-applied / recovery-required
```

Authorization input：

```text
exact base/head/tree
+ Scope grant + candidate attestation
+ required Claim/Evidence aggregate
+ fresh independent Review
+ blocking feedback cleared
+ MainHealth + trust/ruleset
+ dependency + applicable Binding/Delta/Compatibility refs
```

PR body/comment/status/journal/admin identity/local JSON/serialized receipt 不授权 merge。authorization 是 provenance-bound、single-use、bounded-lifetime live capability。response lost/ambiguous 时只readback，不 replay。

成功需 merged tree=verified candidate tree，并协调 remote main、PR/Issue disposition、branch/worktree closeout与new-main readback；各 physical Effect 仍由自己的owner执行。cleanup unknown/foreign residue阻断completion。

## 15. 无代码逻辑验证

| Scenario | Required outcome | Forbidden conclusion |
| --- | --- | --- |
| test body pass, cleanup fails | failed + primary/cleanup Evidence | passed |
| ActionKey same, previous deterministic fail | reuse fail | rerun until green |
| same content, new Git commit | semantic Action may reuse；Review/Promotion rebind | all Evidence stale or all reusable |
| start marker, no terminal | join/readback/unknown | new attempt |
| zero selected tests, applicability unknown | invalidated/unresolved | passed |
| provider unsupported for optional Claim | honest unsupported contribution | skipped/pass |
| provider unsupported for required Claim | aggregate non-pass | automatic fallback |
| candidate changes selector itself | old trusted selector evaluates candidate | candidate self-pass |
| plan command would create cache | reject as Effectful plan | cache is harmless |
| failed review text parser, status green | review unresolved | merge allowed |
| merge response lost | exact remote readback | second merge call |
| new-main differs from verified tree | recovery/incident | complete |
| stronger test covers same happy path but not old failure boundary | no dominance | delete old test |
| typecheck pass | static contract proof only | runtime behavior verified |

## 16. 完成判据

```text
VerificationClosed(claim) =
  claim/gate identities exact
  ∧ applicability/coverage complete
  ∧ ActionKey and environment exact
  ∧ execution/reuse disposition valid
  ∧ Effect settlement + cleanup + readback complete
  ∧ Evidence independent/fresh
  ∧ aggregate deterministic
  ∧ consumer decision does not overreach Claim
```

Merge/Release/Support 还需各自 authority、Effect 和 readback；Verification PASS 不能替代。
