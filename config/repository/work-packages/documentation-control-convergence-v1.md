---
schema: codex-development-work-package-v1
id: documentation-control-convergence-v1
tracking: none
base: 551b147ab8702d4f58dd1f65fcc919f0c4a200dc
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: converge-documentation-and-repository-control
    owner: documentation-control-convergence-owner
    ownedPaths:
      - .documentation/
      - config/external-capabilities/
      - config/repository/
      - docs/archive/
      - docs/governance/
      - docs/roadmap.md
      - docs/work/
      - docs/work-packages/
      - package.json
      - src/adapters/repository/repository-audit/cli.ts
      - src/adapters/self-hosting/control/agent/
      - src/adapters/self-hosting/control/continuation/checkpoint.ts
      - src/adapters/self-hosting/control/documentation/
      - src/adapters/self-hosting/control/issues/disposition.ts
      - src/adapters/self-hosting/control/main-health/
      - src/adapters/self-hosting/control/task/contract/work-package.ts
      - src/adapters/self-hosting/control/work-selection/
      - src/adapters/runtime-state/workspace-state/layout.test.ts
      - src/adapters/verification/platform/
      - tests/
      - tools/
forbiddenPaths:
  - alternatives/
  - bun.lock
  - docs/产品/
  - docs/作者/
  - docs/依据/
  - docs/信息/
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
acceptance:
  - docs contains only the current SEC-086 design corpus and no runtime control archive or retired public projection namespace
  - repository control inputs live under config/repository and every producer consumer parser fixture and path contract uses that single location
  - the external capability ledger lives under config/external-capabilities and docs doctor consumes the new location
  - the completed SEC-086 cutover manifest and research archive are absent while their durable product information remains in current canonical owners or Git history
  - the documentation baseline audits the entire docs namespace without non-documentation exemptions
  - one canonical refresh command deterministically rebuilds the documentation source manifest and baseline digest
  - focused documentation control and repository path contracts pass on the frozen candidate
tests:
  - tools/test_check_source_inventory.py
  - tests/contract/docs-doctor-ledgers.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/contract/test-impact.test.ts
  - tests/unit/active-documentation-contract.test.ts
  - tests/unit/agent-skill-markdown-classification.test.ts
  - tests/unit/document-control-plane-projection.test.ts
  - tests/unit/work-selection-live.test.ts
---

# Documentation and repository-control convergence

This package removes completed migration records and retired projection paths from the current documentation namespace, then moves live machine inputs to their repository configuration owners. It does not rewrite the SEC-086 product corpus or treat control projections as product authority.
