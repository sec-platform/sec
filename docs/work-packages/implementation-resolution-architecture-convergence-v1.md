---
schema: codex-development-work-package-v1
id: implementation-resolution-architecture-convergence-v1
tracking: issue-307
base: 334c7717e9ed7ed40c250be9a9acc2f2fea77d83
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: implementation-resolution-architecture-convergence
    owner: documentation-maintainer
    ownedPaths:
      - docs/authority.json
      - docs/README.md
      - docs/product.md
      - docs/system-architecture.md
      - docs/semantic-model.md
      - docs/delta-and-impact.md
      - docs/compiler-target-ir.md
      - docs/capability-and-block-model.md
      - docs/external-provider-policy.md
      - docs/brownfield-import.md
      - docs/change-management.md
      - docs/runtime-and-distribution.md
      - docs/workbench-and-ai-operations.md
      - docs/verification-governance.md
      - docs/roadmap.md
      - docs/development-governance.md
      - docs/work-packages/implementation-resolution-architecture-convergence-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/documentation-authority.test.ts
forbiddenPaths:
  - .agents/
  - .github/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/archive/
  - docs/evidence/
  - docs/scripts/
  - docs/superpowers/
  - platform/
  - scripts/
acceptance:
  - "Issue #307's audited Implementation Resolution design is integrated into existing canonical authority documents, not a new parallel total-design document."
  - "compiler-target-ir uniquely owns ImplementationRequirement, Candidate, Eligibility, Policy, Decision and Binding."
  - "delta-and-impact uniquely owns deterministic ImplementationBindingDelta and implementation impact propagation."
  - "change-management owns Compatibility Decision, migration, compensation and retirement, not raw Binding comparison."
  - "verification-governance supplies exact Evidence and cannot recompute Resolution, Binding Delta or Compatibility."
  - "runtime-and-distribution materializes exact Binding requirements and cannot silently select, compare or migrate implementations."
  - "Block Capability Resolution and product Implementation Resolution have distinct types, identities, failures and consumers."
  - "arbitrary libraries have L0-L5 onboarding and no-Adapter TypedInvocation without false semantic guarantees."
  - "Provider policy owns onboarding/conformance lifecycle but cannot select, compare or migrate the final implementation."
  - "Workbench intent, constraint, prefer, require, forbid, pin and custom inputs share one Engineering Operation ingress."
  - "The roadmap integrates R4, R6, R9, R10, R11, R12, R13 and R16 without a second root route."
  - "development-governance enforces wheel-first capability census, thin Provider boundaries and duplicate retirement."
  - "docs/authority.json records each new ownership token exactly once and docs/README.md is byte-exact."
  - "No machine implementation, product capability, support claim or completion status is falsely asserted."
  - "PR #310 has merged and completed new-main readback; this successor is rebuilt and re-frozen from the resulting latest main (334c7717)."
  - "The active pointer has switched to this manifest; the predecessor manifest is retired from docs/work-packages/."
  - "Exact-head scope, candidate-as-SUT validation, independent Review, required Gate, expected-head merge and new-main readback close Issue #307."
tests:
  - tests/contract/docs-doctor-byte-exact.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/documentation-corpus-census.test.ts
  - tests/contract/documentation-ownership-closure.test.ts
---

# implementation-resolution-architecture-convergence-v1

本包把 Issue #307 中已经审计并去重的稳定设计主动融合到现有 canonical owner与机器authority registry，
而不是继续让它只存在于聊天、Issue 或一个新的并列总设计文档中。

## 依赖与堆叠关系

```text
PR #310 / frozen-digest-canonical-form-repair-v1
→ merge + new-main readback (complete, main=334c7717)
→ rebuild/re-freeze this package from then-latest main
→ activate through the single control-plane pointer
→ verify, review, gate, merge, readback
```

当前分支从 PR #310 合并后的新 main `334c7717e9ed7ed40c250be9a9acc2f2fea77d83` 重建并
激活。它接管 `docs/work/active-work-package.md` pointer，退役旧 manifest
`active-documentation-corpus-convergence-v2.md`，不复用 #284 的 Review、Gate 或 Evidence。
`docs/authority.json`与生成索引的修改只属于该有序 successor，不反向改变#284的frozen candidate。

## 唯一领域 owner

长期领域名为 `compiler.implementation-resolution`，稳定正文主 owner 是
`docs/compiler-target-ir.md`，机器ownership由`docs/authority.json`唯一登记，未来 machine owner 必须是
具有真实 producer、consumer、validator、revision 和 tests 的 TypeScript contract。Issue #307 只作
Program/交付追踪，不能成为第二稳定 authority。

实现选择后的变化继续分域：`docs/delta-and-impact.md`只拥有旧新Binding的确定性结构比较和Impact，
`docs/change-management.md`只拥有Compatibility判断、迁移、补偿和退役；Compiler不得同时成为
Resolver、Delta comparator和Migration owner。

## 需要融合的根链

```text
validated Semantic / Application / Behavior requirements
→ Implementation Requirements
→ candidate discovery and canonical candidate closure
→ hard eligibility / unknown-conflict frontier
→ policy-specific optimization
→ deterministic tie-break
→ Resolution Decision
→ exact Implementation Binding
→ ImplementationBindingDelta / Impact when bindings change
→ Compatibility Decision / Migration
→ Target Program IR
→ Backend / Artifact / Verification
```

## 本包非目标

- 不实现 Resolver、Provider Registry、TypedInvocation 或 TypeScript 7 迁移；
- 不新增 package、lock、workflow、测试框架或产品源码；
- 不修改当前 Block resolver、Generator、Workbench writer 或 Backend；
- 不把文档完成冒充 implementation、physical verification 或 product support；
- 不预建无真实 consumer 的完整字段宇宙。

## 后继实现门

只有本文档和machine owner进入新 `main` 并完成 readback 后，才允许从最新事实建立首个
machine vertical。首个纵切片必须至少包含两个合格候选、一个不合格候选和一个
unknown 候选，并证明 hard eligibility、policy selection、deterministic binding、
Target Program consumption、physical Verification 与旧 writer/adapter 退役边界。
