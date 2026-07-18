---
schema: codex-development-work-package-v1
id: imports-toolchain-closure-v1
tracking: none
base: 71b6db96fc1c723ae2debc272f0a5e80b1166bc7
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: imports-toolchain-closure
    owner: a0
    ownedPaths:
      - .githooks/post-checkout
      - .githooks/post-merge
      - .githooks/post-rewrite
      - .githooks/pre-commit
      - bun.lock
      - bunfig.toml
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/imports-toolchain-closure-v1.md
      - package.json
      - platform/compiler/semantic-mutation/atomic-source-publish.ts
      - platform/compiler/semantic-mutation/transaction-identity.ts
      - platform/compiler/synthesize/build-task-envelope.ts
      - platform/compiler/verify/semantic-mutation-verification-adapter.ts
      - platform/dev-runner.ts
      - platform/dev-runner/dependency-bootstrap.ts
      - platform/dev-runner/env-manager.ts
      - platform/dev-runner/import-organizer.ts
      - platform/dev-runner/test-runner.ts
      - platform/dev-runner/typecheck-runner.ts
      - platform/shared/ci-contract.ts
      - platform/shared/fs.ts
      - platform/shared/project-file-hash.ts
      - platform/shared/project-runtime.ts
      - scripts/build-release.ts
      - scripts/ci-pr-risk.ts
      - scripts/install-git-hooks.ts
      - tests/e2e/expanded-blocks.test.ts
      - tests/integration/project-runtime.test.ts
      - tests/integration/semantic-mutation-windows-rollback.test.ts
      - tests/setup/runtime-deps.setup.ts
      - tests/unit/check-drift.test.ts
      - tests/unit/dev-runner-dependency-bootstrap.test.ts
      - tests/unit/format-output-files.test.ts
      - tests/unit/frontend-stitching.test.ts
      - tests/unit/import-organizer-staged.test.ts
      - tests/unit/install-git-hooks.test.ts
      - tests/unit/map-custom-routes.test.ts
      - tests/unit/prisma-merge.test.ts
      - tests/unit/semantic-mutation-verification-adapter.test.ts
      - tests/unit/tailwind-merge.test.ts
      - tests/unit/windows-appcontainer-executor.test.ts
      - tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts
forbiddenPaths:
  - .github/workflows/
  - AGENTS.md
  - frontend/
  - platform/orchestrator/
  - platform/policies/
  - platform/registry/
  - scripts/ci-verification.ts
  - scripts/codex/
acceptance:
  - "Bun ambient auto-install is disabled and TypeScript is pinned exactly to 6.0.3, so a global cache cannot replace the repository dependency contract."
  - "A clean worktree performs one lock-serialized frozen compiler install, binds the complete root dependency tree to package.json and bun.lock, and re-enters the dev runner at most once before loading external modules."
  - "The generated-project runtime subset remains owned by .shared-deps and is never reused as an incomplete compiler dependency tree."
  - "Checkout, merge, and rewrite hooks refresh the dependency binding before the next direct focused test; hook installation rejects any incomplete or non-executable managed hook set."
  - "Pre-commit always runs one candidate freeze that derives the branch merge-base automatically and covers the complete base-to-index TypeScript diff without an A0-provided environment variable."
  - "Explicit verification bases remain exact full commit identities, and hosted imports:check remains read-only and fail closed."
  - "Candidate normalization retains the existing single index-lock publication, selection revalidation, partial-stage preservation, CRLF preservation, and working-tree byte preservation contracts."
  - "The previous full-repository import baseline is normalized once; a full local or scheduled audit passes without an unrelated-file allowlist."
  - "The change adds no Playwright execution, browser automation, product capability, C, Rust, FFI, Full, slow, or production sentinel run."
tests:
  - "bun test tests/unit/dev-runner-dependency-bootstrap.test.ts tests/unit/import-organizer-selection.test.ts tests/unit/import-organizer-staged.test.ts tests/unit/install-git-hooks.test.ts --timeout 180000"
  - "bun test tests/integration/project-runtime.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=71b6db96fc1c723ae2debc272f0a5e80b1166bc7 bun run imports:check"
  - "bun run docs:doctor"
  - "git diff --check"
---

# Imports Toolchain Closure V1

重复 import 失败来自两个不同但相互放大的入口缺口：clean worktree 在依赖安装前静态加载 organizer，使 Bun 可能从 ambient cache 解析错误 TypeScript；pre-commit 又只在 A0 显式传入 base 时覆盖 rebase/squash 后的完整候选。两者都把本应由工程合同承担的确定性转成了操作记忆。

本包建立一个 dependency bootstrap 和一个 candidate freeze。bootstrap 只依赖 Node 内建模块与现有 dependency install owner，对 root manifest 与 lockfile 建立 digest，并在 install lock 内物化完整 compiler `node_modules`；首次安装的进程 re-enter 一次，避免 Bun 复用启动时的负解析缓存。`.shared-deps` 保持生成项目/隔离验证的 runtime 子集，不再被 typecheck 或 test 错当成 compiler 依赖。Git lifecycle hooks 维护 binding，ambient auto-install 被关闭，TypeScript 版本改为 exact pin。

pre-commit 不再分支选择 staged-only 或人工 candidate mode，而是统一调用 `imports:freeze`。它优先使用 verification 注入的 exact base，本地则自动取 `HEAD` 与 `origin/main` 的 merge-base，随后复用现有 index-only organizer 和原子发布实现。hosted Gate 继续只读复核 exact committed tree，不在 CI 中修改候选。
