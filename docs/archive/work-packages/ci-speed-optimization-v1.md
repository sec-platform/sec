---
schema: codex-development-work-package-v1
id: ci-speed-optimization-v1
tracking: none
base: 05de8a1decd517e5791c4a03dfdcb648937c48f1
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: optimize-ci-cache
    owner: ci-cache-worker
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/architecture-tools.yml
      - .github/workflows/sec-merge-gate.yml
      - platform/shared/ci-contract.ts
  - id: create-merge-bootstrap-cli
    owner: bootstrap-cli-worker
    ownedPaths:
      - scripts/codex/sec-merge-bootstrap.ts
      - tests/unit/sec-merge-bootstrap.test.ts
forbiddenPaths:
  - package.json
  - bun.lock
  - scripts/codex/work-package-contract.ts
  - scripts/codex/parallel-work-package-contract.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - platform/compiler/
  - platform/orchestrator/
  - platform/shared/contract-freeze-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/ci-verification-revision.ts
  - docs/work/active-work-package.md
  - docs/work/current-state.yaml
  - docs/work/rolling-plan.md
  - tests/e2e/
acceptance:
  - "All CI workflows use actions/cache for bun install cache, reducing dependency installation from 60-180s to 5-15s on cache hit."
  - "sec-merge-gate.yml push trigger has paths filter to avoid unnecessary full revalidation on non-trust-root changes."
  - "tsc incremental build info is cached in CI, reducing typecheck from 30-120s to 5-20s on cache hit."
  - "compiler-pr-validation checkout uses fetch-depth: 2 + separate base fetch instead of fetch-depth: 0 when trust-root tree comparison permits."
  - "sec-merge-bootstrap.ts CLI tool automates the entire merge bootstrap flow: manifest digest computation, scope attestation dispatch, verification dispatch, single-parent squash, admin merge, post-merge pointer patch, and branch cleanup."
  - "merge-gate step 9 API calls are reduced by reusing step 2 artifact metadata when digests match."
  - "attest-scope second github-script revalidation uses If-None-Match etag to reduce API payload."
  - "platform/shared/ci-contract.ts CI_VERIFICATION_PR_STEP_ORDER and CI_VERIFICATION_RELEASE_STEP_ORDER are synchronized with the new Fetch base / Cache bun / Cache tsc step names so ci-contract.test.ts stays green."
  - "All focused contracts, typecheck, docs doctor, repository audit pass on one single-parent candidate."
tests:
  - tests/unit/sec-merge-bootstrap.test.ts
  - tests/unit/codex-work-package-contract.test.ts
  - tests/unit/parallel-work-package-contract.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/contract/sandbox-architecture-contract.test.ts
---

# CI Speed Optimization v1

## 背景

PR #200 合并流程暴露了 SEC 工程流程的多处速度瓶颈：人工触发 dispatch 需要多次重试 payload 参数、single-parent squash 要求、post-merge pointer patch、CI 缺少 cache 等。本 Work Package 系统性优化所有速度瓶颈。

## 实现

### Slice 1 — CI cache 优化

1. 为 `compiler-pr-validation.yml`、`compiler-release-validation.yml`、`architecture-tools.yml` 添加 `actions/cache` 还原 bun install cache。
2. 为 `compiler-pr-validation.yml`、`compiler-release-validation.yml` 添加 tsc incremental build info cache（`.tmp/typecheck/tsconfig.tsbuildinfo`）。
3. 为 `sec-merge-gate.yml` 的 push 触发器添加 paths filter，仅 trust-root 路径变更才触发全量 revalidation。

### Slice 2 — merge-bootstrap CLI 工具

创建 `scripts/codex/sec-merge-bootstrap.ts`，自动化完整合并流程：
- 自动计算 manifest blob SHA-256
- 自动触发 scope-attest（带正确 payload）
- 自动触发 verification（带正确 payload）
- 自动检测 single-parent 要求并 squash
- 自动执行 admin merge
- 自动 post-merge pointer patch
- 自动分支清理

### Slice 3 — merge-gate API 优化

1. merge-gate step 9 复用 step 2 的 artifact metadata（当 digest 匹配时）。
2. attest-scope 第二次 github-script 用 If-None-Match etag。

## 退出

single-parent current-main candidate；focused/typecheck/docs/audit/imports/affected、Review 与 Full Evidence 闭合；merge 后从新 `main` readback。
