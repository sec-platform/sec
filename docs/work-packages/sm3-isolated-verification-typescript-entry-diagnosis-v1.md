---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-typescript-entry-diagnosis-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: bind-and-classify-typescript-entry-in-product-loader
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-typescript-entry-diagnosis-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-entry-diagnosis.json
      - platform/compiler/semantic-mutation/isolated-verification-child-progress.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/contract/semantic-mutation-apply-contract.test.ts
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - platform/orchestrator/
  - platform/shared/
  - scripts/
  - tests/integration/
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v6-verification.json
  - docs/work-packages/sm3-add-state-transition-vertical-v6.md
acceptance:
  - "The terminal vertical-v6 authority remains exact and is never retried: docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v6-verification.json sha256:7630b3637cc0a4df3ab5ad683e573f5addc32e2887a8cf4d3890478199330ab7."
  - "The diagnostic remains inside the normal product staged loader and preserves the existing AppContainer supervisor, environment, resolution parent, module cache, ts-morph/core continuation and PASS path; no probe-only mode, fallback runner or second execution path is added."
  - "The host derives the expected TypeScript entry only from the captured package manifest and captured closure. Host require.resolve, import.meta.resolve, dynamic import or import success never becomes child evidence."
  - "A versioned TypeScript entry binding records the fixed package name, package manifest relative path/digest/size, main selection, canonical package-relative entry, entry digest/size, loader resolution parent and probe/algebra revisions. The binding enters the opaque runtime plan revision and is cross-checked against the exact destination manifest."
  - "The child publishes only the finite ordered prelude: loader-entered, typescript-specifier-resolved, typescript-entry-identity-verified, typescript-imported and typescript-runtime-verified before the existing ts-morph/core trace."
  - "Child-local resolution uses the real loader parent, requires the resolved identity to equal the manifest-bound entry, imports that exact entry URL, and runs one fixed synchronous TypeScript API probe with no filesystem, network, clock, randomness or process spawning."
  - "Exit 76 is only typescript-resolution-failure at loader-entered; 77 is only typescript-entry-identity-mismatch at typescript-specifier-resolved; 78 is only typescript-entry-import-failure at typescript-entry-identity-verified; 79 is only typescript-runtime-failure at typescript-imported. Exit 74 remains progress publication failure, 75 remains later loader import failure, and uncaught/abnormal nonzero remains unclassified."
  - "The host accepts every new class only with its exact trace, no outcome/pending state and no canonical Verification report. Diagnostic classes can never produce PASS, semantic rebuild or success rawDigests."
  - "The public boundary records no resolved value, absolute path, file URL, Error, message, stack, module exports, stdout/stderr or raw exit value."
  - "Entry-own throw and a transitive dependency throw both remain typescript-entry-import-failure; this package does not claim an unavailable causal split inside one rejected import()."
  - "Focused tests cover resolution rejection, identity mismatch, exact-entry/ transitive rejection, runtime probe rejection, success continuation, manifest/entry/loader tamper, exit/checkpoint coherence, report poisoning and path/error redaction."
  - "Only one focused unit-plus-contract command runs. A PASS plus two independent NO BLOCKER reviews may authorize one separately frozen real vertical-v7; this package itself does not run production AppContainer, vertical-v6, old Gates, typecheck, imports, affected, Contract Freeze, slow matrix or Actions."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts --timeout 180000"
  - "git diff --check -- docs/work-packages/sm3-isolated-verification-typescript-entry-diagnosis-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-entry-diagnosis.json platform/compiler/semantic-mutation/isolated-verification-child-progress.ts platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts platform/compiler/verify/run-semantic-mutation-isolated-child.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts"
---

# SM3 Isolated Verification TypeScript Entry Diagnosis V1

Vertical-v6 已证明真实 AppContainer child 在 staged loader 内捕获了 `await import('typescript')` 的 rejection。该事实排除了 v5 的 abnormal-termination ambiguity，但尚不能区分 bare resolution、manifest entry identity、entry import/evaluation 与 import 后 runtime contract。

本包只在同一个产品 loader 内插入 manifest-bound、path-free 的有限诊断前奏。它不新增第二执行路径，也不把 host 环境中的模块解析或加载结果伪装成 child 事实。entry 自身异常与 transitive dependency 异常在现有运行时可观测性下仍归同一 import-failure 类，不虚构更细因果。
