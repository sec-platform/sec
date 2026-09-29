---
schema: codex-development-work-package-v1
id: review-provider-activation-lifecycle-v1
tracking: issue-347
base: f29db36c3f13135072d14c06e21348b44915d0ef
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: close-review-provider-activation-lifecycle
    owner: verification.review-provider
    ownedPaths:
      - config/repository/work-packages/review-provider-activation-lifecycle-v1.md
      - src/adapters/verification/platform/ci/runtime/verification-session-github.ts
      - src/adapters/verification/platform/ci/runtime/verification-session.ts
      - tests/unit/verification-session-runtime.test.ts
forbiddenPaths:
  - .github/
  - config/external-capabilities/ledger.yaml
  - config/repository/active-work-package.md
  - config/repository/rolling-plan.md
  - config/repository/work-selection.md
  - src/adapters/self-hosting/control/integration/
acceptance:
  - Codex App Review can satisfy SEC independent Review only when its exact-head provider action is temporally preceded by one canonical maintainer-authored SEC review wake-up for the same repository PR head and tree
  - Codex App activity without such a wake-up is external activation drift and cannot become Review authority
  - repository-wide trusted Codex quota diagnostics are observed through a bounded stable recent-comment census and normalized through the existing provider diagnostic classifier
  - one trusted quota-unavailable observation remains a durable negative epoch with no time-based self-healing; only a newer maintain-admin target-bound revalidation receipt may authorize one exact PR/head/tree probe
  - raw quota billing and upsell prose remains diagnostic only and never becomes positive Verification or Review authority
  - provider-state census scans newest-first only until the first relevant quota or exact-target revalidation event; bounded pagination exhaustion or any visited-page drift fails closed instead of invoking the provider
  - tracked external capability YAML remains policy/bootstrap input and cannot authorize a stale positive provider attempt
  - existing human maintain-admin approvals REQUEST_CHANGES unresolved-thread and exact-head Review semantics remain unchanged
tests:
  - tests/unit/verification-session-runtime.test.ts
---

# Review provider activation lifecycle

关闭 Issue #347 现场暴露的双激活与负状态不持久问题。SEC 只接受由自己的 exact-head wake-up 激活的 Codex Review；仓库级 Automatic reviews 属于外部配置并已由维护者关闭，代码仍检测并拒绝未绑定 activation。Provider quota 通过 GitHub durable comment history形成 deny-only epoch，不按 TTL 自动恢复；恢复只接受当前 maintain/admin 针对 exact PR/head/tree 签发的单次 revalidation receipt。这样既不依赖单机状态，也不把动态可用性写回 tracked YAML。
