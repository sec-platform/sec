---
schema: codex-development-work-package-v1
id: sec-086-cutover
tracking: none
base: a873494b81f702ed57924c243b2d190f59ab9334
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: integrate-sec-086-cutover
    owner: sec-086-integration-owner
    ownedPaths:
      - .agents/
      - .codex/
      - .documentation/
      - AGENTS.md
      - README.md
      - alternatives/
      - docs/README.md
      - docs/agent-and-user-machine-interface.md
      - docs/agent-constitution.md
      - docs/agent-constitution/
      - docs/archive/
      - docs/authority.json
      - docs/brownfield-import.md
      - docs/change-management.md
      - docs/compiler-target-ir.md
      - docs/delta-and-impact.md
      - docs/design-calculus.md
      - docs/design-calculus/
      - docs/development-governance.md
      - docs/development-governance/
      - docs/documentation-system.md
      - docs/documentation-system/
      - docs/engineering-constitution.md
      - docs/engineering-constitution/
      - docs/external-provider-policy.md
      - docs/governance/
      - docs/implementation-architecture.md
      - docs/implementation-architecture/
      - docs/product.md
      - docs/roadmap.md
      - docs/roadmap/
      - docs/runtime-and-distribution.md
      - docs/runtime-and-distribution/
      - docs/semantic-model.md
      - docs/semantic-mutation.md
      - docs/system-architecture.md
      - docs/system-architecture/
      - docs/verification-governance.md
      - docs/verification-governance/
      - docs/work-packages/sec-086-cutover.md
      - docs/work-packages/private-sandbox-python-runtime-transition.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/产品/
      - docs/任务路线.md
      - docs/作者/
      - docs/依据/
      - docs/信息/
      - docs/内容索引.md
      - docs/决策/
      - docs/开发/
      - docs/架构/
      - docs/演进/
      - docs/状态/
      - docs/维护/
      - docs/编译/
      - docs/运行/
      - docs/领域/
      - examples/
      - knip.json
      - package.json
      - public-docs/
      - src/
      - tests/
      - tools/
forbiddenPaths:
  - bun.lock
  - bunfig.toml
acceptance:
  - the exact candidate contains all 232 SEC-086 Markdown documents and every required JSON .sec example checker documentation cache and control-plane asset
  - SEC-086 is the sole current documentation design while useful repository information is fused into its canonical owners without restoring retired duplicate authority
  - fused canonical owners and control-plane repairs are preserved and are not overwritten by the original SEC-086 source corpus
  - legacy duplicate authority and docs authority registry artifacts are removed only where the SEC-086 cutover replaces their live consumer responsibility
  - physical documentation census and diff integrity bind the exact candidate while unavailable or intentionally skipped checks remain explicit residuals rather than false passes
  - the trusted bootstrap and hosted control plane bind exact base head tree changed closure candidate evidence and every explicit unknown without allowing candidate code to authorize itself
  - an independent exact-head review records blocking findings and residuals while the authorized operator transition never represents manual disposition as an IntegrationAuthorization or Actions pass
  - the provider squash merge consumes the expected candidate head and readback proves the resulting default-branch commit has the frozen base as its sole parent and the verified candidate tree
  - fresh new-main MainHealth and repository readback confirm the SEC-086 cutover after merge before branch and workspace closeout
tests:
  - tests/contract/agent-skills.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/test-impact.test.ts
  - tests/unit/active-documentation-contract.test.ts
  - tests/unit/install-git-hooks.test.ts
  - tests/unit/local-github-actions-runner.test.ts
  - tests/unit/trusted-runtime-container.test.ts
  - tests/unit/work-selection-main-health.test.ts
---

# SEC-086 cutover bootstrap scope proposal

This manifest is the exact scope, ownership, and test-selection proposal consumed by the existing trusted-bootstrap candidate SUT. Its `frozen` value satisfies the candidate Work Package parser for exact-base verification. It does not activate `docs/work/active-work-package.md`, select a WorkDecision, issue an IntegrationAuthorization, mint MainHealth, or authorize its own merge.

The single integration task covers every final changed path relative to `a873494b81f702ed57924c243b2d190f59ab9334`, including this manifest and newly materialized SEC-086 assets. The final ownership projection must be recalculated from the frozen candidate with NUL-safe Git changed records before dispatch.
