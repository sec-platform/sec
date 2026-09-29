---
schema: codex-development-work-package-v1
id: main-health-import-proof-public-lineage-v1
tracking: issue-503
base: f29db36c3f13135072d14c06e21348b44915d0ef
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: restore-exact-main-import-proof
    owner: verification.main-health
    ownedPaths:
      - config/repository/work-packages/main-health-import-proof-public-lineage-v1.md
      - .github/workflows/compiler-pr-validation.yml
      - src/adapters/verification/platform/ci/contract/core.ts
      - tests/contract/ci-trust-closure-contract.test.ts
forbiddenPaths:
  - config/repository/active-work-package.md
  - config/repository/rolling-plan.md
  - config/repository/work-selection.md
  - src/adapters/self-hosting/control/main-health/
  - src/adapters/verification/platform/ci/runtime/
  - src/adapters/verification/platform/trust/
acceptance:
  - current public lineage restores the previously adopted exact-main import proof from merged PR 515 instead of using candidate-scope imports:check
  - canonical MainHealth contract command is bun run imports:check --all
  - compiler-pr-validation exact-main MainHealth job runs exactly the same all-repository import proof
  - contract test rejects regression back to candidate-scope imports:check and still proves workflow step order and command parity
  - no product source bytes are auto-rewritten by this package and no import-only cleanup is mixed into the verifier fix
  - no MainHealth semantic status lane provider arbitration merge authorization or WorkSelection ordering changes
  - trust-root change is verified only by sec-trusted-bootstrap-v1 against the exact trusted base and exact candidate tree
tests:
  - tests/contract/ci-trust-closure-contract.test.ts
---

# MainHealth exact-main import proof public-lineage regression

恢复 2026-08-21 已由 #515 合并的 MainHealth 全仓 import canonicality 证明。当前 public-release lineage 的 `bun run imports:check` 默认选择 candidate scope；在 exact main 上 `origin/main == HEAD` 时会退化成零 changed-file 证明。该包只修 verifier contract/workflow/test，不混入业务源码 import 排序。
