---
schema: codex-development-work-package-v1
id: parallel-work-package-contract-v1
tracking: issue-191
base: fe80386d2aaad41805bcf9e66936e46259e39fdf
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: implement-v3-parallel-contract
    owner: parallel-contract-worker
    ownedPaths:
      - scripts/codex/parallel-work-package-contract.ts
      - tests/unit/parallel-work-package-contract.test.ts
  - id: update-governance-projection
    owner: governance-projection-worker
    ownedPaths:
      - docs/development-governance.md
forbiddenPaths:
  - package.json
  - bun.lock
  - scripts/codex/work-package-contract.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - .github/workflows/
  - platform/compiler/
  - platform/orchestrator/
  - platform/shared/ci-contract.ts
  - platform/shared/contract-freeze-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/ci-verification-revision.ts
  - docs/work/active-work-package.md
  - docs/work/current-state.yaml
  - docs/work/rolling-plan.md
  - tests/e2e/
acceptance:
  - "V3 schema (codex-development-work-package-v3) parser/types/validator implemented as independent module; V1/V2 historical parser in work-package-contract.ts is not modified."
  - "V3 manifest scope includes authorityReads, authorityWrites, owned/permitted/forbidden paths, globalExclusiveResources, sharedReadOnlyResources, requires, orderedAfter, conflictsWith."
  - "Pairwise resolver implements the full 7-step conflict algorithm: base identity, path intersection, authority intersection, resource intersection, global single-writer registry, contract/artifact graph, verification independence."
  - "Resolver emits exactly: parallel-safe | ordered | write-conflict | authority-conflict | resource-conflict | unresolved; unknown/unresolved is never interpreted as safe."
  - "Global exclusive resource registry covers: package-lock, docs-control-plane, agent-skill-registry, workflow/trust-root, repository-worktree, host-profile, browser-cache-writer, release-publisher."
  - "V1/V2 manifest inputs to pairwise resolver return unresolved: legacy-manifest-missing-parallel-contract without modifying historical parsing."
  - "Synthetic manifest tests cover the full acceptance vector: disjoint-paths-same-authority, disjoint-code-both-package-writers, schema-producer-consumer-no-requires, read-only-same-cache-safe, different-cache-toolchain-conflict, rename-crossing-packages, Windows-case-collision, base-differs, legacy-V1-V2, unknown-authority-resource, three-packages-dependency-cycle, merge-first-recompute-second, cancelled-superseded-cleanup."
  - "development-governance.md updated to project parallel contract from designed-but-unimplemented to implemented."
  - "All focused contracts, typecheck, docs doctor, repository audit, imports and required hosted evidence pass on one single-parent candidate."
tests:
  - tests/unit/parallel-work-package-contract.test.ts
  - tests/unit/codex-work-package-contract.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/contract/sandbox-architecture-contract.test.ts
---

# Parallel Work Package Contract v1

## 背景

PR #196（active documentation corpus）和 PR #199（test runtime performance）合并后，SEC 的开发治理基础已进入 `main`。`docs/authority.json` 机器化拥有 active document identity、lifecycle、domain、ownership、projection、consumer 与 update trigger；CI verification contract revision 为 v19。

当前 Work Package 合同（`scripts/codex/work-package-contract.ts`）支持 V1/V2 schema，能机器证明：
- every changed path exactly one task owner
- owned/forbidden paths 不重叠
- path normalized/case-safe
- rename/copy endpoints 不跨 task seam
- single manifest digest/pointer
- 一个 PR body 只有一个 Work-Package locator

但当前**不能**证明：
- 两个包是否写同一 semantic authority
- 不同文件是否修改同一 contract/state/artifact
- package/lock/docs-work/Skill/workflow 等全局单 writer
- shared browser/cache/port/repository worktree/host profile 资源
- producer/consumer 顺序
- 两个 candidate 基于不同 main 时的组合结果
- merge 后哪些 Evidence 仍有效

因此所有历史 V1/V2 包之间默认 `unresolved` 并保持串行。

## 根因分析

现有 `CodexDevelopmentWorkPackageTaskV1` 类型只有 `{ id, owner, ownedPaths }`，没有 authority/resource/requires/conflicts 字段。path overlap 检测（`ownershipPathsOverlap`）只做 trailing-slash 前缀匹配，不做 semantic authority/resource/conflict 检测。pairwise conflict detection 完全不存在。

V2 schema 是 Evidence Composition 专用格式，不是 V1 的并行扩展；它刻意禁止 commands/profile/tests。不能把并行字段加进 V1/V2，否则全部 historical manifest exact bytes 和 parser 合同失效。

## 实现

### Slice 1 — Pairwise resolver（首包）

创建全新的独立模块 `scripts/codex/parallel-work-package-contract.ts`，包含：

1. **V3 schema types**：`codex-development-work-package-v3`，包含 `scope.authorityReads`、`scope.authorityWrites`、`scope.paths.owned/permitted/forbidden`、`scope.resources.exclusive/sharedReadOnly`、`relations.requires/orderedAfter/conflictsWith`、`verification.policyId`。

2. **V3 parser/validator**：严格 YAML 子集 parser（与 V1/V2 一致的语法约束），校验 path normalized/case-safe、authority canonical、resource identity、relation 语法。

3. **Pairwise conflict resolver**：实现 7 步冲突算法：
   - base identity（base 不同 → ordered/unresolved）
   - path intersection（owned-owned、owned-permitted/forbidden、case-fold、rename/copy → write-conflict）
   - authority intersection（writes∩writes → authority-conflict；A writes∩B reads → producer/consumer 或 unresolved）
   - resource intersection（exclusive∩any → resource-conflict；sharedReadOnly identity/policy 相同才兼容）
   - global single-writer registry（8 类全局单 writer 检查）
   - contract/artifact graph（同一 public type/schema/state writer 即使文件不同也冲突）
   - verification independence（每包可独立构造 selection/result）

4. **Global exclusive resource registry**：8 类全局单 writer：
   - package-lock writer
   - docs-control-plane writer
   - agent-skill-registry writer
   - workflow/trust-root writer
   - repository-worktree writer
   - host-profile writer
   - browser-cache-writer
   - release-publisher

5. **V1/V2 兼容**：V1/V2 manifest 输入 pairwise resolver 时返回 `unresolved: legacy-manifest-missing-parallel-contract`，不修改历史解析。

6. **Focused tests**：`tests/unit/parallel-work-package-contract.test.ts` 覆盖完整验收向量。

### Governance projection

更新 `docs/development-governance.md`，将并行 Work Package resolver 从"已设计但需独立实现的目标"标注为"已实现"。

## 退出

single-parent current-main candidate；focused/typecheck/docs/audit/imports/affected、Review 与 Full Evidence 闭合；merge 后从新 `main` readback。

默认仍单包；只有机器证明分离的任务可并行，Integration Queue 不建立第二产品计划源。
