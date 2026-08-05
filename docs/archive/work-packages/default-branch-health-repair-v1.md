---
schema: codex-development-work-package-v1
id: default-branch-health-repair-v1
tracking: issue-280
base: 4b27555bfcaa146e466227beca9f6c7069f68eaf
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: tcb-closure-lock-and-revision-health
    owner: tcb-closure-maintainer
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/default-branch-revision-health.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/contract/default-branch-revision-health.test.ts
      - docs/work-packages/default-branch-health-repair-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .github/
  - .agents/
  - package.json
  - bun.lock
  - bunfig.toml
  - tsconfig.json
  - AGENTS.md
  - README.md
  - docs/authority.json
  - docs/product.md
  - docs/system-architecture.md
  - docs/roadmap.md
  - docs/development-governance.md
  - docs/verification-governance.md
  - docs/archive/
  - docs/evidence/
  - docs/superpowers/
  - scripts/codex/merge-gate.ts
  - scripts/codex/sec-merge-bootstrap.ts
  - scripts/codex/work-package-contract.ts
acceptance:
  - "An exact generated TCB closure lock binds the 61 reviewed modules, their edges, Git blobs, raw content digests, and the single trust revision; the lock is generated from the trusted-runtime closure logic, not hand-maintained."
  - "The verifier runtime import closure test no longer uses a hard-coded count; it asserts against the generated lock identity and fails on any unauthorized expansion, contraction, substitution, or edge addition."
  - "Negative tests prove that adding an untrusted module, removing a reviewed module, substituting a module path, or introducing an unauthorized edge all cause the lock to break."
  - "A revision-health receipt records that main@4b27555b arrived via unauthorized direct-to-main commit 0c9cf1e4 (no PR), the TCB closure expansion from 60 to 61 was authorized by the canonical-primitives.ts introduction, and the test drift is repaired without reverting the canonical module."
  - "The revision-health receipt records transitionAuthority: repaired, verificationHealth: passed, trustEligibility: trusted for the post-merge new main."
tests:
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/default-branch-revision-health.test.ts
---

# default-branch-health-repair-v1

Issue #280：修复 main@4b27555b 的 TCB closure 测试漂移与 default-branch 来源健康状态。

## 根因裁决

**test-drift**：commit `0c9cf1e4`（"feat: 审计TS代码，追求极致架构"）通过直接
default-branch commit 引入 `platform/shared/canonical-primitives.ts`。该模块被
`documentation-authority-contract.ts`、`collections.ts`、`ci-evidence-contract.ts`、
`ci-evidence-reuse-contract.ts`、`project-runtime.ts` 导入，使 TCB closure 从 60
扩展到 61。该 commit 未更新 `sec-merge-gate.test.ts` 的 `toBe(60)` 断言。

## 第 61 个模块

- **模块路径**: `platform/shared/canonical-primitives.ts`
- **importer**: `documentation-authority-contract.ts`, `collections.ts`,
  `ci-evidence-contract.ts`, `ci-evidence-reuse-contract.ts`, `project-runtime.ts`
- **进入 edge**: 通过 `documentation-authority-contract.ts -> canonical-primitives.ts`
- **为什么进入**: 该模块提供 `compareCodeUnits` 和 `isPlainObject`，被 TCB closure
  内多个模块直接导入
- **是否扩大 verifier 权限**: 否，该模块只提供纯函数比较器，不引入 process loader、
  dynamic import 或外部依赖
- **是否属于可信计算基**: 是，它是 TCB closure 的合法成员
- **需要什么 revision migration**: 从 `toBe(60)` 硬编码迁移到 generated exact TCB lock

## 修复策略

不修改裸数字。建立 generated exact TCB closure lock，绑定：
- exact 61 个模块的 sorted identity
- 每个模块的 Git blob SHA-1
- 每个模块的 raw content SHA-256
- closure digest
- trust revision

测试改为断言 closure 与 lock 一致，而非断言固定数字。

## Trust-root bootstrap

本包修改 `tests/contract/sec-merge-gate.test.ts`（当前 trust-root 文件），
属于 trust-root delta。候选不得用自身新增规则授权自身；合并前必须保留 base-side
parser/scope/TCB/focused evidence 与独立 Review；admin/manual integration 后
读取新 `main`，并在新任务中重新加载新 trust epoch。

## 边界

- 不恢复 #273 删除的 docs/archive、旧 active manifest 或旧 rolling plan
- 不提前重建 #274/#276
- 不把 GitHub Ruleset、Apps 或完整 Integration Kernel 塞入本包
- 不静默 force-reset main
- 不回滚无关正确变化
