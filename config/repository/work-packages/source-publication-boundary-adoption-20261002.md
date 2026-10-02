---
schema: codex-development-work-package-v1
id: source-publication-boundary-adoption-20261002
tracking: none
base: 152f312cc242aa5bb346f8cb318b67e3d4108354
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: adopt-independent-source-publication-boundary
    owner: document-control-plane
    ownedPaths:
      - ".agents/skills/worker-development/SKILL.md"
      - ".codex/agents/implementation-worker.toml"
      - ".documentation/source-manifest.json"
      - "AGENTS.md"
      - "docs/开发/AI协作/规则装载与任务恢复.md"
      - "src/adapters/self-hosting/control/documentation/document-control-cli.ts"
      - "src/adapters/self-hosting/control/documentation/document-control-plane.ts"
      - "src/adapters/self-hosting/control/documentation/document-control-source-checkpoint.ts"
      - "tests/unit/document-control-source-checkpoint.test.ts"
      - "src/adapters/verification/platform/action/runner.ts"
      - "tests/unit/verification-action-runner.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/runner-build-adoption-20261002.md"
      - "config/repository/work-packages/source-publication-boundary-adoption-20261002.md"
forbiddenPaths:
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Proposal-only migration grants no active Work, MainHealth, Session, Gate or automatic main integration authority"
  - "Preserve exact independently reviewed nine-file source-publication boundary patch 7a88ac65fce450748c9ccf053f405c65218d1824d61f82ab9fabc276c1ac9295 and all authored bytes"
  - "Implement explicit user decision separating reviewed source checkpoint commit and push from formal Work selection and full qualification"
  - "Read-only source status observes exact base/head/ref and owned paths without issuing an Effect grant or bypassing original commit normalization and journal owners"
  - "Formal activation, hosted dispatch, main protection and ordinary final Gate requirements remain under their original owners"
  - "Only current trusted-base documentation compiler creates successor projections and retires exact matching-default predecessor manifest"
  - "Retain actual trusted-base manual-bootstrap-required verdict for changed document-control CLI and entry roots plus absent production SUT qualification"
  - "Independent final review binds exact base/head/tree and all source/control paths before any protected PR"
  - "Expected-head protected merge requires unchanged base and exact tree with sole-parent readback; branch and worktree settlement remains open until original lifecycle closeout"
  - "Preserve independently reviewed closed Action read-only rejection repair 4495f8ea8c9702e6201720266c0445302f2806889eb74491f29d8f4031661195; no legacy journal adoption or cleanup"
tests:
  - "tests/unit/document-control-source-checkpoint.test.ts"
  - "tests/unit/verification-action-runner.test.ts"
---

# Adopt independent source publication boundary

This bounded external-maintainer migration adopts the explicitly approved separation of source checkpoints from formal main qualification. It creates no ordinary Gate success or activation.
