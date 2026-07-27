---
schema: codex-development-work-package-v1
id: ci-v7-changed-imports-gate-v1
tracking: issue-106
base: 71d0384f167519f67d8a87d87177c10aef7bcaa8
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: ci-v7-changed-imports-gate
    owner: a0
    ownedPaths:
      - docs/work-packages/ci-v7-changed-imports-gate-v1.md
      - platform/shared/ci-evidence-contract.ts
      - platform/shared/ci-execution-environment.ts
      - scripts/ci-verification.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-verification-v7-execution.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - tests/e2e/
acceptance:
  - "Every V7 direct Gate receives the trusted exact base SHA and fixed changed-only import selection in its sanitized, evidence-bound child environment."
  - "SEC_CHANGED_BASE is canonicalized from the resolved PR base and accepts only one lowercase 40-hex commit SHA at the child boundary."
  - "The execution-environment allowlist revision changes, invalidating stale bindings that omitted the base and changed-only import mode."
  - "The fix does not organize or modify unrelated baseline imports and changes no evidence policy, selector, Gate order, product path, runtime version, Playwright surface, or AppContainer capability."
  - "The prior #113 V2 Quick run 29649124646 reached the direct Gate plan but failed only gate sm3-p0-gate-00 because full-repository imports selected 19 unrelated base files; all later Gates, including production delta, were not run."
tests:
  - "bun test tests/unit/ci-verification-v7-execution.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts --timeout 180000"
  - "bun test tests/unit/ci-evidence-contract-v3.test.ts --timeout 180000"
  - "bun test tests/contract/sec-merge-gate.test.ts --test-name-pattern '^base-side V7 merge gate independently reconstructs the real P0 plan and rejects self-signed drift$' --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "SEC_IMPORTS_CHANGED_ONLY=1, SEC_CHANGED_BASE=71d0384f167519f67d8a87d87177c10aef7bcaa8; bun run imports:check"
  - "git diff --check"
---

# CI V7 Changed Imports Gate V1

V7 runner 已从 trusted resolver 得到 exact PR base，但 sanitized child environment 过去丢弃该值，且 repository-dispatch 不是 `pull_request` event，导致 canonical imports Gate 退化为全仓检查。#113 run `29649124646` 因而在第一个 Gate 报告 19 个与候选无关的 baseline 文件，后续 Gate 全部未运行。

本包把已解析 base SHA 规范化后送入 V7 evidence-bound environment，并固定 changed-only import mode；不允许 candidate manifest 或 policy 自行提供 base/ref，也不修改那 19 个无关文件。因为本包修改 verifier trust-root，候选 frozen Quick 必须以 manual-bootstrap guard 停止，合入后的唯一 operational sentinel 是重冻 #113 后的一次 V2 Quick。
