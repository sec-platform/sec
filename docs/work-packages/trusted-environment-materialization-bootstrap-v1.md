---
schema: codex-development-work-package-v1
id: trusted-environment-materialization-bootstrap-v1
tracking: none
base: 4291ea94f26858c6570144f6632100a568832039
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - external-provider
  - runtime-distribution
  - system-architecture
  - verification-governance
tasks:
  - id: environment-materialization-logic
    owner: hermetic-runtime-environment-owner
    ownedPaths:
      - platform/shared/environment-materialization-contract.ts
      - platform/shared/sec-linux-verification-environment.ts
      - platform/shared/environment-specs/sec-linux-verification-v1.json
      - tests/unit/environment-materialization-contract.test.ts
      - tests/unit/sec-linux-verification-environment.test.ts
  - id: buildkit-image-provider
    owner: external-provider-adoption-owner
    ownedPaths:
      - scripts/codex/local-github-actions-runner.ts
      - tests/unit/local-github-actions-runner.test.ts
  - id: trusted-runtime-consumer
    owner: trusted-runtime-container-owner
    ownedPaths:
      - scripts/codex/trusted-runtime-container.ts
      - scripts/codex/trusted-runtime.Dockerfile
      - tests/unit/trusted-runtime-container.test.ts
  - id: semantic-progress-watchdog
    owner: bounded-process-transport-owner
    ownedPaths:
      - platform/shared/process.ts
      - tests/unit/process-output.test.ts
  - id: bootstrap-scope-record
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/trusted-environment-materialization-bootstrap-v1.md
forbiddenPaths:
  - .agents/
  - bun.lock
  - bunfig.toml
  - docs/authority.json
  - docs/product.md
  - docs/roadmap.md
  - docs/system-architecture.md
  - docs/work/active-work-package.md
  - docs/work/current-state.yaml
  - docs/work/rolling-plan.md
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - public-docs/
  - source/
acceptance:
  - the tracked sec-linux-verification-v1 authority parses with exact keys and both runner and trusted-runtime consumers project their versions URLs digests packages identities labels bounds and resources from it without duplicate mutable literals
  - environment-materialization-contract compiles the exact observed image artifact inputs and provider capability to reuse-local restore-local materialize or blocked without importing Docker code
  - the v10 runner image is produced by the authority-derived Buildx Bake definition from the pinned Ubuntu snapshot runner Node GitHub CLI CA bundle and Dockerfile frontend inputs
  - the published runner OCI layout receipt binds the current spec runtime manifest Docker projection and provenance artifact digests and all referenced blobs survive exact readback
  - deleting only the v10 Docker image and rerunning ensure restores sha256:859df0e6886706c1c91b3b529397421ffd08a0d1ffed58df8b3019f187b859b1 from canonical repository-external OCI cache without a remote solve
  - raw BuildKit progress admits only new vertex phase byte or completion advancement and runner command failures retain bounded head and tail evidence
  - runner and trusted-runtime Buildx calls use authority-owned absolute deadlines plus semantic-progress stall deadlines so presentation chatter cannot keep a stalled build alive
  - trusted-runtime v2 consumes the exact runner projection and checksum-bound Bun 1.3.14 official archive and reads back image sha256:3b7d40b2efadd6570a2536224cc05b1b2342785d855805620b5b428abb428109 with exact labels
  - the superseded inline docker build and trusted-runtime oven image dependency have zero consumers
  - focused environment provider process and trusted-runtime tests pass with TypeScript and documentation contracts before independent exact-head review merge and new-main readback
tests:
  - tests/unit/environment-materialization-contract.test.ts
  - tests/unit/local-github-actions-runner.test.ts
  - tests/unit/trusted-runtime-container.test.ts
  - tests/unit/process-output.test.ts
---

# Trusted Environment Materialization Bootstrap V1

This is a bounded pre-ledger bootstrap repair for the exact `main` whose trusted-local MainHealth producer cannot materialize its accepted execution image. It does not create an ordinary WorkDecision, change roadmap priority, modify package/lock state, or grant Verification/Review/merge authority.

The pure boundary is:

```text
EnvironmentRequirement
  -> EnvironmentSpec
  -> observed exact local materialization
  -> reuse-local | restore-local-artifact | materialize-with-provider | unavailable
  -> exact EnvironmentMaterializationReceipt
```

The physical provider is Docker BuildKit/Buildx already installed with the owning Docker Desktop environment. SEC owns only the immutable source/capability contract, the thin provider request, progress admission, exact readback, and the Environment receipt consumed by the trusted runtime. BuildKit owns the build DAG, content cache, remote checksum acquisition, OCI assembly, cache concurrency, metadata and provenance mechanisms.


The candidate restores the producer only. The separately recorded high-throughput control-plane model and Provider-owned project dependency locator remain successor slices after exact new-main MainHealth is healthy and ordinary selection can run again.
