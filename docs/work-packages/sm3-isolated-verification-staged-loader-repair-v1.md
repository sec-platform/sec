---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-staged-loader-repair-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: add-manifest-bound-staged-dependency-loader
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-staged-loader-repair-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-staged-loader-repair.json
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
  - scripts/
  - platform/shared/
  - platform/orchestrator/
  - platform/compiler/verify/semantic-mutation-verification-adapter.ts
  - platform/compiler/verify/assert-isolated-staging-tree.ts
  - platform/compiler/semantic-mutation/isolated-verification-child-outcome.ts
  - tests/integration/
  - tests/unit/semantic-mutation-verification-adapter.test.ts
  - tests/contract/test-impact.test.ts
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v4-verification.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-core-import-diagnosis.json
  - docs/work-packages/sm3-add-state-transition-vertical-v4.md
  - docs/work-packages/sm3-isolated-verification-core-import-diagnosis-v1.md
acceptance:
  - "The terminal diagnosis remains exact: docs/evidence/v0-4-semantic-mutation-isolated-verification-core-import-diagnosis.json sha256:268b644cc0d1269e7d247ff9c7600b267a6969f20a9a152db2c5da52699c24fa with rootCause=null and no source-proven external-closure mismatch."
  - "The predecessor progress, runtime plan and child host sources are exact: sha256:f16a2bd42030775a9879cfc0645f04f51eeddc66fb845de27c3bd01f8be7ba18, sha256:ab6081c8db6c7919eef72952634298b1cfbb664946dd05c460d863b58ec67c91 and sha256:8e0ea1e50799c038a8d3ab89060b92cbb9fe373721d8911c02933bc40209f969."
  - "The predecessor unit and contract tests are exact: sha256:e96bd97c3e5a47157095c11e8ce74afa7e144594c8bcadd7e5553453957ddf27 and sha256:aeb9623478acc4349c65897d2d62c90a957915fbbe826cecf26a50f89070be9d."
  - "A new fixed relative loader path is materialized between the existing bootstrap and heavyweight runner core. Bootstrap imports only that sibling loader after bootstrap-entered."
  - "The only checkpoint names become bootstrap-entered, loader-entered, typescript-imported, ts-morph-imported, core-import-started, module-entered, catch-armed, verify-all, postcondition, failure-caught, catch-tree-validated and outcome-publish-started."
  - "The literal loader durably publishes loader-entered, imports typescript, publishes typescript-imported, imports ts-morph, publishes ts-morph-imported, publishes core-import-started and then imports the exact sibling heavyweight core."
  - "The loader embeds no host absolute path and serializes no caught Error, message, stdout or stderr. Import rejection exits as the existing unclassified-nonzero class; progress publication failure retains the existing fixed progress-publication-failure exit."
  - "The runtime capability plan, canonical plan revision, destination manifest, generated-input checks and launch proof bind bootstrap bytes, loader bytes and heavyweight core bytes independently."
  - "Host trace validation accepts only continuous source-valid loader and runner traces. PASS still requires the complete loader prelude, module-entered, runner success trace, exit zero and complete canonical passed artifacts."
  - "A loader checkpoint can only refine a failure. It never substitutes for a canonical report, creates PASS, enters success rawDigests or changes generic WorkspacePaths/Verification/AppContainer contracts."
  - "module-entered remains the first heavyweight-core body action; no pipeline, runner, dependency closure, external list, timeout, profile, registry or generic executor behavior changes."
  - "Two independent read-only static reviews must report no blocker before one focused unit-plus-contract batch runs. No AppContainer, real product vertical, old Gate, full/slow matrix or Actions run is allowed in this package."
  - "A focused PASS authorizes only a separately frozen real add-state-transition vertical-v5. It does not authorize typecheck, imports, affected, Contract Freeze, commit, push or merge."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts --timeout 180000"
  - "git diff --check -- platform/compiler/semantic-mutation/isolated-verification-child-progress.ts platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts platform/compiler/verify/run-semantic-mutation-isolated-child.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts docs/work-packages/sm3-isolated-verification-staged-loader-repair-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-staged-loader-repair.json"
---

# SM3 Isolated Verification Staged Loader Repair V1

Core-import diagnosis 已排除 emitted third-party external 与物理 dependency closure 的静态不一致，但无法证明 AppContainer 内的 package resolution、module evaluation 或 Bun runtime survival。

本包只在 bootstrap 与 heavyweight core 之间加入一个 manifest-bound literal loader，用有限 durable checkpoint 依次切开 `typescript`、`ts-morph` 与 core import。它不尝试猜测根因，不改变 Verification 或 pipeline 语义，也不执行真实 AppContainer；focused PASS 后才能另冻 vertical-v5。
