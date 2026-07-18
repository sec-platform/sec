---
schema: codex-development-work-package-v2
id: sm3-p0-local-isolated-runner-v1
tracking: issue-106
base: 8942f6992451a2c22df3adbf2171c7dce620912c
manifestState: frozen
evidenceComposition:
  policyId: sm3-p0-local-isolated-runner-v1
tasks:
  - id: p0-local-isolated-runner
    owner: a0
    ownedPaths:
      - docs/03-MVP实施计划与路线图.md
      - docs/08-Verification、Provenance与Graph规范.md
      - docs/14-Engineering IR与语义事实规范.md
      - docs/evidence/v0-4-semantic-mutation-bounded-isolation-scan-exact-stop-record-2026-07-17.json
      - docs/evidence/v0-4-semantic-mutation-browser-closure-exact-timeout-stop-record-2026-07-17.json
      - docs/evidence/v0-4-semantic-mutation-local-child-exact-public-verification-2026-07-17.json
      - docs/evidence/v0-4-semantic-mutation-local-child-host-alias-exact-public-stop-record-2026-07-17.json
      - docs/evidence/v0-4-semantic-mutation-proof-reuse-exact-timeout-stop-record-2026-07-17.json
      - docs/evidence/v0-4-semantic-mutation-restored-runtime-input-durable-exact-stop-record-2026-07-18.json
      - docs/evidence/v0-4-semantic-mutation-restored-runtime-input-exact-result-loss-record-2026-07-18.json
      - docs/evidence/v0-4-semantic-mutation-single-job-owner-production-pass-2026-07-18.json
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/sm3-p0-local-isolated-runner-v1.md
      - platform/compiler/semantic-mutation/isolated-verification-child-progress.ts
      - platform/compiler/semantic-mutation/mutation-terminal-record.ts
      - platform/compiler/semantic-mutation/windows-file-attributes.ts
      - platform/compiler/verify/assert-isolated-staging-tree.ts
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/runtime-verification-invocation-contract.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/compiler/verify/semantic-mutation-isolated-verification-evidence.ts
      - platform/compiler/verify/semantic-mutation-isolated-verification-failure.ts
      - platform/compiler/verify/semantic-mutation-runner-build-child.ts
      - platform/compiler/verify/semantic-mutation-runner-build-protocol.ts
      - platform/compiler/verify/semantic-mutation-runner-build-settlement.ts
      - platform/compiler/verify/semantic-mutation-staged-project-input.ts
      - platform/compiler/verify/semantic-mutation-staged-verification-reuse.ts
      - platform/compiler/verify/staged-verification-proof.ts
      - platform/compiler/verify/typecheck-project.ts
      - platform/compiler/verify/validate-resolved-templates.ts
      - platform/compiler/verify/verify-project.ts
      - platform/orchestrator/pipeline-orchestrator.ts
      - platform/orchestrator/semantic-mutation-isolated-verification-runner.ts
      - platform/orchestrator/semantic-mutation-orchestrator.ts
      - platform/orchestrator/verify-orchestrator.ts
      - platform/shared/observed-process.ts
      - platform/shared/project-base.ts
      - platform/shared/verification-types.ts
      - platform/shared/workspace-write-lease.ts
      - tests/contract/semantic-mutation-apply-contract.test.ts
      - tests/contract/test-architecture.test.ts
      - tests/contract/test-impact.test.ts
      - tests/helpers/semantic-mutation-production-sentinel.ts
      - tests/integration/project-runtime.test.ts
      - tests/integration/semantic-mutation-apply.test.ts
      - tests/integration/semantic-mutation-production-sentinel.test.ts
      - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
      - tests/unit/canonical-ir-identity-revision.test.ts
      - tests/unit/observed-process-lifecycle.test.ts
      - tests/unit/runtime-verification.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
forbiddenPaths:
  - AGENTS.md
  - PLANS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - .github/workflows/
  - docs/04-AI自主实现执行蓝图.md
  - platform/cli/
  - platform/policies/
  - platform/registry/
  - platform/upgrade/
  - platform/shared/test-impact-contract.ts
  - platform/shared/test-impact-rules/
  - platform/shared/test-ownership-contract.ts
  - platform/shared/windows-appcontainer-executor.ts
  - platform/shared/windows-appcontainer-native-helper.ts
  - scripts/
  - tests/e2e/
acceptance:
  - "The final candidate head is one commit above the frozen base 8942f6992451a2c22df3adbf2171c7dce620912c."
  - "The host process performs one canonical Bun.build and supervises one verifier child; no Worker, fresh helper process, or second builder remains in the execution boundary."
  - "The implementation remains TypeScript and Bun only and adds no C, Rust, new FFI boundary, dependency, Playwright test, or browser automation surface."
  - "The canonical invocation descriptor exclusively owns build, unit, and acceptance logical labels, direct module paths, and argv tails; durable Verification reports retain path-free bun run labels while absolute launch argv never enters durable proof."
  - "Verification-owned generic staged proof authority is one-shot and bound to exact source, project inputs, revisions, required verification, raw artifacts, and the committed execution before live publish."
  - "Pipeline depends only on the Verification owner facade for post-pipeline proof validation; it does not import Mutation-specific compiler internals."
  - "The isolated Verification evidence digest owner has no import edge back to its child runner."
  - "Observed-process keeps one Job settlement owner and proves bounded post-close cleanup without restoring a Worker boundary."
  - "The historical production PASS is only the legacy-unbound-v1 baseline; V7 must execute the production delta exactly once and no separate production sentinel run is permitted."
  - "AppContainer remains optional hardening with capabilityComplete false, and this Work Package does not claim full SM-3 exit."
  - "The affected selector resolves every changed path; required evidence does not run AppContainer execution tests, Playwright, the frozen exact production seam, Full, or all-slow. One non-evidence legacy full-Pipeline probe that attempted browser bootstrap is excluded and must not be rerun."
---

# SM-3 P0 Local Isolated Runner V2

本包把 P0 产品路径收敛为 host 进程内一次 `Bun.build()` 加一个受监督 verifier child，删除 PR 后续加入的 fresh builder helper、Worker/browser host alias 与 Mutation-specific proof reuse，并修复两个 owner 边界：Pipeline 只经 Verification façade 消费 generic one-shot staged proof，evidence digest 也不再反向依赖 child runner 类型。

历史 production PASS 仍绑定 `514e6e401659f18ecffca19856a11354d66d05df`、tree `74e94777fe0be825121723a48b5aa41cd9bb43a8` 和 Bun 1.3.6，但新的 builder ownership 已使它只能作为 `legacy-unbound-v1` baseline，不能继续充当最终 seam proof。本包不重复 production sentinel、Playwright、AppContainer、Full 或 slow；V7 base-owned evidence composition policy 必须且只会运行一次 production delta，并把最终证据绑定 frozen base、exact head 和完整选择结果。

本包只完成 P0 产品 reconciliation，不在 V7 exact-head final seam evidence 建立前声称 blocker 已解除，也不完成 SM3-A 至 SM3-D 或改变路线图顺序。运行时升级仍是后续独立短迭代。
