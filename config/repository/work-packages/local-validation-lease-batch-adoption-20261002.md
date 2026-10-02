---
schema: codex-development-work-package-v1
id: local-validation-lease-batch-adoption-20261002
tracking: none
base: 683e78ccf679619319254c3f43ba12f37a83f2ef
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: adopt-local-verification-and-native-lease-boundaries
    owner: trusted-runtime
    ownedPaths:
      - "docs/开发/AI协作/规则装载与任务恢复.md"
      - "docs/运行/验收/会话集成与结果复用.md"
      - "src/adapters/runtime-state/physical/runtime/repository-change-observer.test.ts"
      - "src/adapters/runtime-state/physical/runtime/repository-change-observer.ts"
      - "src/adapters/self-hosting/control/composition/trusted-runtime-closeout.ts"
      - "src/adapters/self-hosting/development/runner/command-input.ts"
      - "src/adapters/self-hosting/development/runner/command-runner.ts"
      - "src/adapters/self-hosting/development/runner/repository-mutation-fence.ts"
      - "src/adapters/self-hosting/development/runner/test-execution-policy.ts"
      - "src/adapters/verification/platform/ci/contract/session-request.ts"
      - "src/adapters/verification/platform/ci/runtime/local-github-actions-runner.ts"
      - "src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts"
      - "src/adapters/verification/platform/ci/runtime/verification-session.ts"
      - "tests/helpers/local-stage/composition-fixture.ts"
      - "tests/integration/compiler-dependency-installation.ts"
      - "tests/integration/sec-dev-git-observation.test.ts"
      - "tests/unit/local-github-actions-runner-lifecycle.test.ts"
      - "tests/unit/test-runner.test.ts"
      - "tests/unit/trusted-runtime-local-pending-status.test.ts"
      - "tests/unit/trusted-runtime-local-stage.test.ts"
      - "tests/unit/verification-session-runtime.test.ts"
      - "src/adapters/filesystem/write-lease.ts"
      - "src/adapters/runtime-state/generated-state/registration-migration.test.ts"
      - "src/adapters/runtime-state/generated-state/registration-store.ts"
      - "src/adapters/runtime-state/physical/runtime/mutation-lease.ts"
      - "src/adapters/runtime-state/physical/runtime/physical-durable-file.ts"
      - "src/adapters/runtime-state/physical/runtime/physical-exclusive-guard.test.ts"
      - "src/adapters/runtime-state/physical/runtime/physical-exclusive-guard.ts"
      - "src/adapters/runtime-state/physical/runtime/physical-no-follow-contract.ts"
      - "src/adapters/runtime-state/physical/runtime/physical-no-follow-native.ts"
      - "src/adapters/runtime-state/physical/runtime/physical-no-follow.ts"
      - "src/adapters/runtime-state/physical/runtime/physical-retirement.ts"
      - "src/adapters/runtime-state/workspace-state/journal-filesystem.ts"
      - "src/adapters/self-hosting/development/commit/operation.ts"
      - "src/adapters/self-hosting/development/commit/recovery-cli.ts"
      - "src/adapters/verification/platform/action/journal-machine-cutover.ts"
      - "src/adapters/verification/platform/gate/state/heavy-lease.ts"
      - "tests/unit/development-commit.test.ts"
      - "tests/unit/heavy-verification-gate-lease.test.ts"
      - "tests/unit/physical-mutation-lease.test.ts"
      - "tests/unit/workspace-write-lease.test.ts"
      - ".documentation/source-manifest.json"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/maintenance-effective-authority-adoption-20261002.md"
      - "config/repository/work-packages/local-validation-lease-batch-adoption-20261002.md"
forbiddenPaths:
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Adopt the exact reviewed local topology 5bdd24a9 plus stage-only delta of 9257277a, excluding the thirteen Linux Docker provider paths and preserving their separate unresolved ABI ownership obligation"
  - "Adopt the twenty exact published d1d76702 native lease postimages, including the original physical guard, shared owner integrations, commit observation budget and direct regressions"
  - "Preserve local placement and verification-only stage identities, hosted early rejection, legacy runner recovery, and fail-closed physical observation"
  - "Preserve native lease principal, bounded wait, cancellation, original error and cleanup settlement; no process-local lease may claim stronger cross-process authority"
  - "Keep read-only local status/resume separated from integration and merge effects; source publication and editing evidence cannot create Gate or MainHealth authority"
  - "Preserve current Workbench and complete developer-decision documentation and the effective maintain/admin maintenance policy; use the original source manifest producer on this actual union"
  - "Reuse exact source reviews and evidence only within unchanged input scope; independently review the actual combined native lease and local control boundaries"
  - "Use original trusted-main proposal controls and truthful PRE, then exact independent final review and protected expected-head merge/readback; retain all unqualified Linux physical and ordinary verification obligations"
tests:
  - "src/adapters/runtime-state/physical/runtime/repository-change-observer.test.ts"
  - "tests/integration/sec-dev-git-observation.test.ts"
  - "tests/unit/local-github-actions-runner-lifecycle.test.ts"
  - "tests/unit/test-runner.test.ts"
  - "tests/unit/trusted-runtime-local-pending-status.test.ts"
  - "tests/unit/trusted-runtime-local-stage.test.ts"
  - "tests/unit/verification-session-runtime.test.ts"
  - "src/adapters/runtime-state/generated-state/registration-migration.test.ts"
  - "src/adapters/runtime-state/physical/runtime/physical-exclusive-guard.test.ts"
  - "tests/unit/development-commit.test.ts"
  - "tests/unit/heavy-verification-gate-lease.test.ts"
  - "tests/unit/physical-mutation-lease.test.ts"
  - "tests/unit/workspace-write-lease.test.ts"
---

# Adopt reviewed local verification and native lease boundaries

This batch joins compatible reviewed trust-root migrations at one current-main identity. Local topology and verification-only stage do not depend on the deferred Docker provider implementation. Native lease source is independently published and reviewed, with exact disjoint postimages. Previous source evidence is retained at its original strength; full Linux physical qualification, SourceTransition, MainHealth, ordinary Gate and provider ABI migration remain unresolved. No registry permission is broadened.
