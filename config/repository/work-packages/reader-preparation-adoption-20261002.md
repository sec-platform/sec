---
schema: codex-development-work-package-v1
id: reader-preparation-adoption-20261002
tracking: none
base: 08635ccf8dd6a036de9f4b8e2f0941c54967ee85
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: adopt-compatible-work-package-readers
    owner: document-control-plane
    ownedPaths:
      - ".documentation/source-manifest.json"
      - "config/repository/README.md"
      - "docs/开发/AI协作/规则装载与任务恢复.md"
      - "src/adapters/self-hosting/control/agent/agent-operation-activation.ts"
      - "src/adapters/self-hosting/control/continuation/checkpoint.ts"
      - "src/adapters/self-hosting/control/continuation/local-continuation.ts"
      - "src/adapters/self-hosting/control/documentation/document-control-admission.ts"
      - "src/adapters/self-hosting/control/documentation/document-control-plane-contract.ts"
      - "src/adapters/self-hosting/control/task/contract/work-package.ts"
      - "src/adapters/verification/platform/ci/runtime/verification-session.ts"
      - "src/adapters/verification/platform/ci/verification-cli.ts"
      - "tests/contract/document-control-plane-lifecycle.test.ts"
      - "tests/unit/agent-operation-activation.test.ts"
      - "tests/unit/ci-verification-execution.test.ts"
      - "tests/unit/codex-work-package-contract.test.ts"
      - "tests/unit/document-control-plane-projection.test.ts"
      - "tests/unit/local-continuation-managed.test.ts"
      - "tests/unit/local-continuation.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/source-publication-boundary-adoption-20261002.md"
      - "config/repository/work-packages/reader-preparation-adoption-20261002.md"
forbiddenPaths:
  - ".github/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Proposal-only v1 migration creates no active Work, MainHealth, Session, Gate or automatic main adoption authority"
  - "Adopt the reviewed compatible reader source proposal 26aa939bb0351f769e393597034ee6a0d7a4157af8d0d5a9ef7b70f40593c69f under original v1 inputs before any separately admitted v3 activation"
  - "Preserve strict v1 parsing, forbid retired v2 and unknown fields, preserve complete raw manifest identity and original operation observed-base binding"
  - "Preserve the already adopted independent source publication boundary and closed Action observation behavior from main08635cc"
  - "Preserve exact eight production reader and seven test postimages apart from canonical equivalent import ordering; combine only intersecting normative text with current main"
  - "Original documentation producer regenerates source-manifest over the actual combined normative source set without rewriting unrelated baseline identities or regression policy"
  - "Original current-base compiler generates successor active pointer and rolling projection and retires the exact previous matching-default manifest"
  - "Independent exact subject review and actual original PRE preserve manual-bootstrap-required limits; focused evidence is not full SUT or native Windows qualification"
  - "Expected-head protected merge requires exact candidate tree and frozen main as sole parent; lifecycle and prior failure obligations remain open until original owner settlement"
tests:
  - "tests/contract/document-control-plane-lifecycle.test.ts"
  - "tests/unit/agent-operation-activation.test.ts"
  - "tests/unit/ci-verification-execution.test.ts"
  - "tests/unit/codex-work-package-contract.test.ts"
  - "tests/unit/document-control-plane-projection.test.ts"
  - "tests/unit/local-continuation-managed.test.ts"
  - "tests/unit/local-continuation.test.ts"
---

# Adopt compatible Work Package readers

Reader compatibility lands under a v1 proposal. Stable binding, fresh v3 operation admission and retirement qualification are separate successors.
