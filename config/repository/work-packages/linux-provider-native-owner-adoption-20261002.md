---
schema: codex-development-work-package-v1
id: linux-provider-native-owner-adoption-20261002
tracking: none
base: 6d426e5df4991c9f1249059f64bcc5a4cd0b8146
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: adopt-linux-provider-native-peer-boundary
    owner: physical-runtime
    ownedPaths:
      - "src/adapters/providers/docker/contract/command-provider.ts"
      - "src/adapters/providers/docker/contract/container-engine-session.ts"
      - "src/adapters/providers/docker/contract/linux-installation-profile.ts"
      - "src/adapters/providers/docker/runtime/command-provider.ts"
      - "src/adapters/providers/docker/runtime/container-engine-session.ts"
      - "src/adapters/providers/docker/runtime/installed-command-provider.ts"
      - "src/adapters/providers/docker/runtime/linux-command-provider.test.ts"
      - "src/adapters/providers/docker/runtime/linux-command-provider.ts"
      - "src/adapters/providers/docker/runtime/linux-endpoint.ts"
      - "src/adapters/providers/docker/runtime/linux-runtime-state.ts"
      - "src/adapters/providers/docker/runtime/readiness.ts"
      - "src/adapters/runtime-state/physical/runtime/physical-no-follow-native.ts"
      - "src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts"
      - "src/bootstrap/cli/register-commands.ts"
      - "tests/contract/tcb-closure-lock.test.ts"
      - "tests/helpers/linux-unix-peer/native-fixture.ts"
      - "tests/unit/linux-unix-peer-native.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/local-validation-lease-batch-adoption-20261002.md"
      - "config/repository/work-packages/linux-provider-native-owner-adoption-20261002.md"
forbiddenPaths:
  - "crates/"
  - "package.json"
  - "bun.lock"
  - "docs/"
  - ".documentation/"
acceptance:
  - "Adopt the reviewed provider source and actual native peer ownership repair from b95c5bba, reconciled exactly against current main6d426 and its native lease source"
  - "Keep libc ABI loading, socket descriptor custody, peer credential observation and native failure settlement in the existing physical native owner; Docker adapter retains endpoint policy and identity checks"
  - "Preserve all existing lease20 source bytes and principal/generation fencing; the actual physical-native intersection only adds the independently reviewed import and native peer implementation"
  - "Do not add external-import registry exceptions, hide FFI imports behind a dynamic loader, or reclassify the preserved failed old candidate receipt"
  - "Keep Linux operations capability-set empty except already admitted daemon observation; preserve original Windows owner routing and lifecycle recovery"
  - "Reuse exact previous source reviews and native evidence; consume fresh union closure/native fixtures/typecheck at their recorded source-only strength"
  - "No canonical documentation source changed in this implementation-owner repair; keep all current documentation and its projection unchanged"
  - "Use original trusted-main controls and actual PRE, exact final independent source/control review, then protected expected-head merge and authoritative tree/soleparent readback; full Linux execution and formal Gate obligations remain open"
tests:
  - "src/adapters/providers/docker/runtime/linux-command-provider.test.ts"
  - "tests/contract/tcb-closure-lock.test.ts"
  - "tests/unit/linux-unix-peer-native.test.ts"
---

# Adopt the Linux provider with canonical native peer ownership

The original provider slice is adopted only after its native ABI ownership is genuinely repaired and independently reviewed. The existing physical native owner now owns the required peer primitive and resource settlement, and current-main native lease changes remain intact. Original trusted policy and registry are unchanged. Source/fixture closure and editing checks do not claim full Linux physical qualification or formal Gate.
