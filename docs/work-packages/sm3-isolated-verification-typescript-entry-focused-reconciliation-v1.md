---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-typescript-entry-focused-reconciliation-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: reconcile-typescript-resolution-and-focused-sentinels
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-typescript-entry-focused-reconciliation-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-entry-focused-reconciliation.json
      - platform/compiler/semantic-mutation/isolated-verification-child-progress.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
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
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-entry-diagnosis.json
  - docs/work-packages/sm3-isolated-verification-typescript-entry-diagnosis-v1.md
acceptance:
  - "The failed TypeScript-entry diagnosis is terminal and never rerun: docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-entry-diagnosis.json sha256:2f296fda7696f54610edd14b4c75947d2d28f8617cc4415c04a762366574470c."
  - "Bun.resolveSync is considered resolved only when it returns an absolute path string from the real loader parent. A throw, non-string or non-absolute unresolved value maps to exit 76 at loader-entered before typescript-specifier-resolved."
  - "An absolute resolved path that differs from the manifest-bound exact entry remains exit 77 at typescript-specifier-resolved. Exact-entry import, runtime probe, module-cache identity, ts-morph/core continuation and exits 74, 75, 78 and 79 remain unchanged."
  - "The host preserves an already parsed allowlisted child failure stage when early canonical reports force artifact-protocol. It still rejects the reports before semantic rebuild or PASS and does not expose any new field, Error, path or output."
  - "Size-changing destination tamper remains rejected by the exact structure proof. Same-size TypeScript manifest, TypeScript entry and runner byte tamper reaches and is rejected by the digest manifest proof, so the sentinel does not weaken or mislabel the earlier boundary."
  - "The generated-loader success fixture continues to prove loader exact-URL import, ts-morph bare require and core bare import share one TypeScript API object, including duplicate-evaluation and namespace-wrapper guards."
  - "The observable 76/77 partition advances exitAlgebraRevision to typescript-entry-exit-algebra-v2. No checkpoint, exit code, public class, TypeScript entry or loader binding format, runtime-probe revision or runtime-plan schema changes. The v2 algebra field and loader bytes enter the destination manifest and opaque plan revision."
  - "Focused tests cover the complete 76/77/78/79/later-75 classification loop, allowlisted child-stage projection, early-report poisoning, exact structure versus digest-manifest tamper ordering and the existing cache-identity success path."
  - "Only one focused unit-plus-contract command runs. A PASS plus two independent NO BLOCKER reviews may authorize one separately frozen real vertical-v7; this package itself does not run production AppContainer, vertical-v6, old Gates, typecheck, imports, affected, Contract Freeze, slow matrix or Actions."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts --timeout 180000"
  - "git diff --check -- docs/work-packages/sm3-isolated-verification-typescript-entry-focused-reconciliation-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-entry-focused-reconciliation.json platform/compiler/semantic-mutation/isolated-verification-child-progress.ts platform/compiler/verify/run-semantic-mutation-isolated-child.ts platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts"
---

# SM3 Isolated Verification TypeScript Entry Focused Reconciliation V1

上一冻结包已真实证明 exact-entry loader、bare `ts-morph` 与 core 共享同一 TypeScript 模块实例，但 focused Gate 还暴露出三个互不扩散的小型合同错位：未解析的非绝对 resolver 返回值落入 77、早期 report poisoning 漏掉已解析的 allowlisted child stage，以及尺寸变化 tamper 先被 structure proof 拒绝却仍期待后续 manifest proof。

本包只闭合这三条。它不重跑上一包，不改变真实 AppContainer、依赖闭包、exact-entry 加载、runtime probe、module cache、timeout 或产品纵切面。
