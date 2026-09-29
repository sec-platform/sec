---
schema: codex-development-work-package-v1
id: work-selection-main-health-provider-regression-v1
tracking: issue-503
base: f29db36c3f13135072d14c06e21348b44915d0ef
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: restore-provider-neutral-work-selection-main-health
    owner: control.main-health
    ownedPaths:
      - config/repository/work-packages/work-selection-main-health-provider-regression-v1.md
      - src/adapters/self-hosting/control/main-health/contract.ts
      - src/adapters/self-hosting/control/main-health/main-health-observation.ts
      - src/adapters/self-hosting/control/main-health/work-selection-main-health.ts
      - src/adapters/self-hosting/control/composition/trusted-runtime-closeout.ts
      - src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts
      - tests/unit/main-health-contract.test.ts
      - tests/unit/main-health-provider-neutral.test.ts
      - tests/unit/work-selection-main-health.test.ts
      - tests/unit/document-control-plane-main-health-session.test.ts
      - tests/unit/trusted-runtime-container.test.ts
forbiddenPaths:
  - .github/
  - config/repository/active-work-package.md
  - config/repository/rolling-plan.md
  - config/repository/work-selection.md
  - package.json
  - src/adapters/self-hosting/control/integration/
  - src/adapters/verification/platform/trust/
acceptance:
  - current public-lineage regression from previously adopted provider-neutral WorkSelection MainHealth is repaired without restoring obsolete August transport or layout
  - MainHealth semantic revision remains provider-neutral while producer provenance distinguishes hosted GitHub observation from trusted-runtime durable readback
  - merge-gate hosted MainHealth provenance requirements remain unchanged and local WorkSelection evidence cannot authorize integration
  - exact-main trusted-runtime producer reuses the current immutable trusted workspace image dependency cache network isolation and operation settlement owners instead of implementing a second Docker or dependency lifecycle
  - trusted-runtime MainHealth evaluates the same canonical five source claims as hosted MainHealth after dependency preparation and binds repository main commit main tree execution environment plan revision and terminal claim results in one canonical durable receipt
  - unchanged exact subject can reuse the durable local receipt without a second physical MainHealth start while any plan environment main tree receipt or physical identity drift invalidates reuse
  - local receipt observation uses one exact expected locator and no-follow canonical-byte readback and never scans a directory for a newest receipt
  - hosted absence or transport unavailability cannot override one valid exact trusted-local receipt while invalid local evidence remains fail-closed and conflicting fresh provider health revisions remain unresolved
  - document-control and WorkSelection consume one owner-issued provider-neutral MainHealth snapshot and do not independently rerun or reinterpret providers
  - provider-missing bootstrap remains verifier-only through the existing sec-trusted-bootstrap-v1 path and this package creates no second bootstrap or MainHealth bypass
  - current main can produce and read back one real trusted-local MainHealth receipt then fresh document-control WorkSelection can leave the stale repository-closeout control generation
tests:
  - tests/unit/main-health-contract.test.ts
  - tests/unit/main-health-provider-neutral.test.ts
  - tests/unit/work-selection-main-health.test.ts
  - tests/unit/document-control-plane-main-health-session.test.ts
  - tests/unit/trusted-runtime-container.test.ts
---

# WorkSelection MainHealth provider regression repair

恢复 public-release materialization 丢失的 provider-neutral MainHealth 消费语义，同时保留当前更强的 GitHub provider 稳定读回、Runtime State、trusted runtime 和 integration provenance 边界。此包不修改普通 WorkSelection 排序、merge gate、workflow、active pointer 或 rolling plan。
