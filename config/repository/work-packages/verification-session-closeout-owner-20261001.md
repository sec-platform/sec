---
schema: codex-development-work-package-v1
id: verification-session-closeout-owner-20261001
tracking: none
base: e60a1c2c5103540afcc73083388f75c55e1f0ade
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: separate-hosted-closeout-effect-owner
    owner: verification-ci
    ownedPaths:
      - src/adapters/verification/platform/ci/runtime/verification-session.ts
      - src/adapters/verification/platform/ci/runtime/session-command.ts
      - src/adapters/verification/platform/ci/runtime/session-branch-closeout-effects.ts
      - src/adapters/verification/platform/trust/runtime/closure-lock.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/generated-store-adoption-20261001.md
      - config/repository/work-packages/verification-session-closeout-owner-20261001.md
forbiddenPaths:
  - AGENTS.md
  - docs/
  - .documentation/
  - .agents/
  - .codex/
  - .github/
  - src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts
  - src/adapters/verification/platform/ci/contract/
  - src/adapters/verification/platform/action/
  - src/adapters/verification/platform/trust/contract/
  - src/adapters/verification/platform/trusted-runtime/
  - src/adapters/filesystem/
  - src/adapters/self-hosting/
  - tests/
  - package.json
  - bun.lock
  - LICENSE
  - LICENSES/
  - crates/
acceptance:
  - This external-maintainer proposal creates no active Work, Gate, health or automatic integration authority
  - Preserve every original VerificationSession executable declaration body, public command and exported function contract
  - Separate the hosted ref CAS, immediate live lease and inventory checks, operation journal recovery and terminal readback into one effect executor
  - Retain provider-authenticated marker publication, integration and the private same-host physical worktree token bridge in the session orchestrator
  - Retain the fixed bounded command transport without caller-injected process callbacks or a second issuer, registry or recovery state machine
  - Relocate the exact reviewed process dispatcher identity once in the existing closure owner and retire the former path without widening dispatcher matching
  - Preserve physical Git CAS, process receipts, lease ordering, recovery ambiguity and foreign worktree blockers without treating serialized journals as authority
  - Reuse unchanged declaration equivalence and existing focused Git CAS, recovery fixture, cleanup-routing and TCB closure observations
  - Keep scanner alerts 400, 401 and 402 open because a responsibility split does not establish independent vulnerability remediation
  - Preserve the frozen qualified source-transition candidate semantics and its separate adoption responsibility without editing that candidate or its owners
  - Whole-candidate author obligations, independent review, trusted Gate and hosted integration remain separate from local source and fixture evidence
tests:
  - tests/unit/verification-session-hosted-local-ref.test.ts
  - tests/unit/verification-session-closeout-fixture.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/contract/tcb-closure-lock.test.ts
---

# Separate hosted closeout execution from session orchestration

The effect executor owns each local or remote ref mutation together with its
immediate live authorization check, lease assertion, process settlement, durable
journal and terminal inventory readback. The session orchestrator continues to
own provider-authenticated markers, integration and same-host worktree cleanup.
Its private token bridge remains in that process and cannot be reconstructed from
recovery bytes. The command module preserves the existing finite dispatcher;
its structural scope describes a repository and does not grant effect authority.

This is an internal responsibility separation under the existing closeout
contract. It changes no serialized record, stable public contract or normative
design. Source relocation preserves the known journal-bypass questions; neither
local tests nor exact-body equivalence closes scanner alerts 400, 401 or 402.
