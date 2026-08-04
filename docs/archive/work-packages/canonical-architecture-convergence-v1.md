---
schema: codex-development-work-package-v1
id: canonical-architecture-convergence-v1
tracking: issue-265
base: a91ac03085f03b4405b8420d336a4fc5d9705dc4
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: canonical-architecture-convergence-docs
    owner: documentation-governance-worker
    ownedPaths:
      - docs/README.md
      - docs/authority.json
      - docs/change-management.md
      - docs/development-governance.md
      - docs/evidence/2026-08-03-constraint-thoughts-execution-plan.md
      - docs/evidence/2026-08-04-canonical-architecture-convergence.md
      - docs/evidence/2026-08-04-full-architecture-asset-audit.md
      - docs/product.md
      - docs/roadmap.md
      - docs/runtime-and-distribution.md
      - docs/semantic-model.md
      - docs/system-architecture.md
      - docs/verification-governance.md
      - docs/workbench-and-ai-operations.md
      - tests/contract/documentation-authority.test.ts
      - tests/contract/document-control-plane-lifecycle.test.ts
      - tests/contract/test-impact.test.ts
      - platform/shared/test-impact-rules/governance.ts
  - id: canonical-architecture-convergence-control-plane
    owner: a0-integrator
    ownedPaths:
      - docs/work-packages/canonical-architecture-convergence-v1.md
      - docs/work-packages/semantic-mutation-classification-v1.md
      - docs/archive/work-packages/semantic-mutation-classification-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - AGENTS.md
  - README.md
  - platform/compiler/
  - platform/orchestrator/
  - platform/cli/
  - platform/dev-runner/
  - platform/policies/
  - platform/registry/
  - platform/upgrade/
  - scripts/
  - tests/testkit/
  - tests/e2e/
  - .github/
  - source/
  - project/
  - control/
  - docs/work/current-state.yaml
  - docs/work/README.md
  - docs/corpus/
  - docs/governance/
  - docs/proposals/
acceptance:
  - "Resolver pointer binds only canonical-architecture-convergence-v1 with matching git blob digest; rolling plan has exactly one active package and five numbered candidates; 1B-4 manifest is archived only after the new pointer atomically takes over."
  - "Top-level authority docs fuse both product chains and one shared Engineering Semantic Model with unique owners; Observation to Responsibility to Impact to Operation to Mutation is not inverted; Authority, Canonical, Evidence and Projection remain distinct identities."
  - "Roadmap root DAG R0-R16 plus three constrained tracks (Workspace Domain W0-W7, Nexus Conformance N0-N8, Specialized Target/Provider S0-S7); the old 1B-4 to #216 to #207 queue is removed; current capability and target maturity stay explicitly separate."
  - "Owner convergence from #243 is absorbed: Compiler Target vs Runtime Host, transaction rollback vs migration recovery, Responsibility owner, Verification vs Compatibility vs Support, and Role/Operation/Skill/Workbench each have a unique owner."
  - "Evidence lifecycle: the 2026-08-03 stage plan is marked historical; the 2026-08-04 decision and full-asset audit are updated as decision/audit evidence; stable documents contain no dynamic SHA, PR identity, main revision or workflow run identity."
  - "docs doctor full corpus has zero errors; documentation authority registry, ownership, missing-owner and cycle census pass; documentation authority contract tests pass; repository audit, typecheck and affected checks pass; generated docs/README byte readback matches the registry."
tests:
  - tests/contract/documentation-authority.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/docs-doctor.test.ts
---

# canonical-architecture-convergence-v1

Issue #265：在 Verification 1B 序列于 `main@a91ac030` 真实闭合后，把 PR #266
从旧 `335ffdbe` 过程分支重建为单一父、单一 squash commit 的正式 Work Package，
并在同一候选中原子接管 pointer、归档 1B-4 manifest、重算 rolling plan，融合
Brownfield 治理链、确定性生成链、共享 Engineering Semantic Model 与
W/N/S 三条受约束轨道。

## Ordered ownership

1. A0 冻结本 manifest，并把 pointer 原子切换到
   `docs/work-packages/canonical-architecture-convergence-v1.md`；同一候选内
   `semantic-mutation-classification-v1.md` 移入 `docs/archive/work-packages/`，
   `docs/work/rolling-plan.md` 重算为 ACTIVE + 五个 NEXT + CONDITIONAL +
   FROZEN DESIGN SOURCES。
2. documentation-governance-worker 只修改列出的 canonical 文档、authority
   registry、generated index、Evidence 与文档 authority 合同测试；#243 的
   owner 裁决直接吸收，不再拆成两个前置 docs-only WP。
3. A0 单独拥有 candidate freeze、Review custody、hosted Gate custody、
   squash merge、new-main readback 与 cleanup。

## Gate sequence

manifest/parser/pointer validation → docs authority registry tests →
ownership/missing-owner/cycle census → docs-doctor full corpus → repository
audit → typecheck → affected checks → generated docs/README byte readback →
independent exact-head architecture Review → hosted Quick → squash merge →
new-main readback。

Review 必须重点攻击重复 owner、缺失 owner、循环依赖、current/historical
泄漏、proposal 写成 implemented、阶段死锁、基础设施无限前置、Nexus 与普通
Brownfield 重复或缺失、Workspace Domain 形成第二 Semantic authority，以及
Specialized Target 污染 TypeScript Core。

## Migration boundary

- 不修改产品代码、package/lock、workflow、ledger、proposal 或
  `docs/work/current-state.yaml`。
- 旧 PR #266 的 17 个过程提交不进入新主干；历史讨论保留在 PR #266。
- 1B-4 manifest 的归档发生在 pointer 接管之后，不提前移动。
- Evidence 只解释裁决，不拥有当前状态或长期路线。
