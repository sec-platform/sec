---
schema: codex-development-work-package-v1
id: imports-explicit-base-selection-v1
tracking: none
base: "b22bb6c2a53368cbe98e070758de440b00626994"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: imports-explicit-base-selection
    owner: ci-v7-writer
    ownedPaths:
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/imports-explicit-base-selection-v1.md
      - platform/dev-runner/import-organizer.ts
      - tests/unit/import-organizer-selection.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - package.json
  - docs/work-packages/ci-linux-reference-sentinels-v1.md
  - docs/work-packages/ci-sm3-p0-contract-transition-v1.md
  - platform/compiler/
  - platform/orchestrator/
  - platform/policies/
  - platform/shared/ci-contract.ts
  - platform/shared/ci-evidence-composition-policy-registry.ts
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-verification-plan.ts
  - scripts/build-release.ts
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - scripts/codex/
  - scripts/run-work-package-gate.ts
  - scripts/work-package-profile-probe.ts
  - tests/contract/semantic-mutation-source-adapter-contract.test.ts
  - tests/e2e/
  - tests/unit/ci-evidence-composition-policy-registry.test.ts
  - tests/unit/work-package-gate-execution.test.ts
  - tests/unit/work-package-profile-probe-diagnostic.test.ts
acceptance:
  - "Import selection precedence is exact: SEC_IMPORTS_CHANGED_ONLY=1 selects changed-only, =0 selects the full repository, otherwise a present SEC_CHANGED_BASE selects changed-only, otherwise pull-request CI selects changed-only, and all remaining contexts select the full repository."
  - "A hosted repository_dispatch carrying SEC_CHANGED_BASE deterministically checks base..HEAD instead of the unrelated 19-file full-repository import baseline."
  - "Explicit SEC_IMPORTS_CHANGED_ONLY=0 remains the highest-priority full-repository audit even when SEC_CHANGED_BASE and repository_dispatch context are present."
  - "A scheduled or local invocation without SEC_CHANGED_BASE remains a full-repository audit."
  - "resolveImportDiffBase retains its existing explicit-base, pull-request-base, then HEAD^1 precedence."
  - "The repair changes no workflow, verification plan/evidence/policy, package, lockfile, product, compiler, orchestrator, #118, #119, #113, or baseline file."
tests:
  - "bun test tests/unit/import-organizer-selection.test.ts --timeout 180000"
  - "bun test tests/unit/codex-work-package-contract.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "CI=true GITHUB_EVENT_NAME=repository_dispatch SEC_CHANGED_BASE=b22bb6c2a53368cbe98e070758de440b00626994 bun run imports:check"
  - "git diff --check"
---

# Imports Explicit Base Selection V1

PR #118 的 exact-head verification run `29653779335` 已注入 `SEC_CHANGED_BASE=b22bb6c2a53368cbe98e070758de440b00626994`，但 imports selector 仍只把 `pull_request` 识别为 changed-only。Hosted verification 使用 `repository_dispatch`，因此 Gate 错误退回全仓审计并报告 19 个与 #118 无关的 baseline 文件，而不是只检查 frozen `base..HEAD`。

本包把显式 diff base 提升为 changed-only authority，同时保留显式 selection 开关的更高优先级。固定顺序为 `1 → true`、`0 → false`、存在 `SEC_CHANGED_BASE → true`、pull-request CI → true、其余 → false。这样 repository_dispatch 的 frozen base 能确定性约束选择范围，显式 `0` 仍可执行全仓审计，schedule/local 无 base 行为不变；`resolveImportDiffBase` 的 base 解析算法不变。

本修复只改变 selector 与其合成测试，并更新 canonical CI lane authority。Run `29653779335` 报告的 19 个 baseline 文件、#118/#119/#113 ownership、hosted workflow、V7 trust/evidence surface 和产品代码均不修改。
