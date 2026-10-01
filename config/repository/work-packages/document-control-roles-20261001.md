---
schema: codex-development-work-package-v1
id: document-control-roles-20261001
tracking: none
base: f400359d0b59acfe434ba59373ca7732b2cc2938
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: separate-document-control-roles
    owner: document-control-plane
    ownedPaths:
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/hook-recovery-owner-boundaries-20261001.md
      - config/repository/work-packages/document-control-roles-20261001.md
      - src/adapters/self-hosting/control/documentation/document-control-admission.ts
      - src/adapters/self-hosting/control/documentation/document-control-cli.ts
      - src/adapters/self-hosting/control/documentation/document-control-freeze-plan.ts
      - src/adapters/self-hosting/control/documentation/document-control-index.ts
      - src/adapters/self-hosting/control/documentation/document-control-journal-codec.ts
      - src/adapters/self-hosting/control/documentation/document-control-observation.ts
      - src/adapters/self-hosting/control/documentation/document-control-plane.ts
      - src/adapters/self-hosting/control/documentation/document-control-publication.ts
      - src/adapters/self-hosting/control/documentation/document-control-recovery.ts
      - src/adapters/self-hosting/control/documentation/document-control-status.ts
forbiddenPaths:
  - AGENTS.md
  - docs/
  - .documentation/
  - .agents/
  - .codex/
  - .github/
  - tests/
  - package.json
  - bun.lock
  - LICENSE
  - LICENSES/
  - crates/
acceptance:
  - This external-maintainer proposal issues no active Work, Gate, health or automatic integration authority
  - Preserve the existing public document-control entry and all public exports while separating decoding, admission, planning, native index custody, publication, recovery and status through an acyclic internal dependency graph
  - Preserve exact source and candidate authority, workspace lease ordering, private test issuer, canonical Git provider admission, index PRE custody and operation-bound terminal settlement
  - Retain native Git scratch-index update-index and write-tree as the sole tree constructor without manual tree builders, refreshed writer budgets or a new universal registry
  - Preserve V4 activation and V5 proposal-only journal and result identity, exact PRE and NEXT publication, forward-only recovery census and journal-last retirement
  - Preserve the known possibility that PROPOSED controls already exist before readback or settlement failure, without assigning an unproven cause or claiming this refactor fixes that failure
  - Reuse unchanged focused evidence and distinguish local type, static and fixture checks from required final Gate, independent review and actual default adoption
  - Keep unrelated dependency runtime, hook installer, cold analysis, repository audit, CI, remaining issues and Rust outside this write scope
  - Obtain exact terminal freeze, canonical commit and later authorized target-ref readbacks without allowing candidate code to approve its own trusted control migration
tests:
  - tests/unit/document-control-plane-main-health-session.test.ts
  - tests/unit/document-control-plane-projection.test.ts
  - tests/unit/document-control-plane-github-observation.test.ts
  - tests/unit/control-cli-projection.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
---

# Separate document-control operation roles

The existing entry keeps the discoverable operation sequence and completion boundary.
Internal leaves separate input interpretation and live admission from native index
custody, exact physical publication, recovery and read-only status. They preserve
one operation identity and consume the existing provider and projection contracts.
