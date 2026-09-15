---
schema: codex-development-work-package-v1
id: private-sandbox-python-runtime-transition
tracking: none
base: 47f0c6a2607b310cb4bf53c47a4dd0aed073310b
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: expose-python-to-private-sut-sandbox
    owner: private-sandbox-python-runtime-owner
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/sec-trusted-bootstrap.yml
      - docs/work-packages/private-sandbox-python-runtime-transition.md
      - docs/work-packages/default-branch-health-repair-36b174ebc783bb2b2e0c079d58fb825f0966b60b-848e6d50f2852dc05566c9d272c71782a7c39fb6c1badea43b1f74e9064b3c8e.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/development-governance/work-and-authoring.md
      - src/control/documentation/document-control-plane-contract.ts
      - src/control/documentation/document-control-plane.ts
      - src/control/work-selection/live-contract.ts
      - src/verification/action/contract/environment.ts
      - src/verification/ci/contract/revision.ts
      - src/verification/ci/verification.ts
      - src/toolchain/dependencies/runtime/project-runtime.ts
      - src/toolchain/dependencies/runtime/dependency-transition/store.ts
      - src/toolchain/dependencies/runtime/lifecycle-capabilities.ts
      - src/runtime-state/generated-state/lifecycle.ts
      - src/runtime-state/generated-state/lifecycle.test.ts
      - src/runtime-state/workspace-state/physical-authority.ts
      - src/runtime-state/workspace-state/physical-authority.test.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/document-control-plane-lifecycle.test.ts
      - tests/integration/compiler-dependency-installation.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/document-control-plane-projection.test.ts
      - tests/unit/dependency-ledger-storage.test.ts
forbiddenPaths:
  - src/external-capabilities/linux-verification/environment-spec.json
acceptance:
  - proposal-only authoring uses the canonical pointer and rolling compiler, retires the old manifest, and remains explicitly without activation or execution authority
  - proposal replay and recovery preserve PROPOSED and reject cross-lane replay while existing activation journals remain recoverable
  - shared physical dependency generations retain one source-owner proof; consumers only reopen it and never reseal the same physical directory
  - owner recovery validates the sealed tree before proof publication and preserves typed failure and physical settlement
  - bounded Windows physical authority admission uses its existing FIFO, skips expired waiting operations without effects, and preserves retained references and terminal settlement
  - dependency namespace creation retains the same physical owner across its effect fence and rejects an owner replacement before modifying either directory
  - lifecycle inventory and retirement observations consume the same creation-bound workspace and state configuration as their producer even if the caller later mutates its input
  - concurrent dependency migration recognizes a completed paired cutover and revalidates its locator instead of waiting on a terminal handoff as though reclamation were still active
  - every cold trusted-base SUT facade installs the exact-base frozen dependency graph through the same sealed environment without lifecycle scripts before its first repository module import
  - trusted-bootstrap keeps the dependency-bearing CLI facade separate from clean exact-base and candidate SUT input checkouts consumed by the existing two-root admission
  - the trusted private SUT sandbox exposes the standard-library Python runtime already bound by the Linux verification environment authority without changing the runner image identity
  - Python extension-module dynamic dependencies are copied into the private root and any missing dependency rejects the sandbox before candidate execution
  - the sandbox capability self-test proves the exact governed Python version and the standard-library modules required by the documentation checker
  - candidate code cannot expand the base-owned private sandbox runtime or represent auxiliary operator evidence as an Actions pass or IntegrationAuthorization
  - the old-base result preserves manual-bootstrap-required until an independent review and maintainer transition place this policy on main
  - fresh new-main capability and MainHealth readback prove the transitioned sandbox before SEC-086 uses it as a new trusted base
tests:
  - src/runtime-state/workspace-state/physical-authority.test.ts
  - tests/unit/dependency-ledger-storage.test.ts
  - src/runtime-state/generated-state/lifecycle.test.ts
  - tests/unit/document-control-plane-projection.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/integration/compiler-dependency-installation.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/unit/ci-verification-execution.test.ts
---

# Trusted verification runtime transition

This frozen scope proposal lets the existing trusted bootstrap inspect one minimal base transition. It does not activate a Work Package pointer, select a WorkDecision, issue an IntegrationAuthorization, mint MainHealth, or authorize its own merge.

The exact base already governs Python in the immutable Linux runner image, while its private SUT chroot omits that runtime. This transition exposes the same governed version, its standard library, and the dynamic dependencies of its extension modules inside the existing private root. The old base cannot certify the new sandbox by executing candidate-owned policy, so its result remains `manual-bootstrap-required`; only fresh post-merge capability and MainHealth readback can establish the new base.
