---
schema: codex-development-work-package-v1
id: work-discovery-and-plan-convergence-v1
tracking: issue-221
base: 985bc5ab8f7422f7135d8e10c23c52ffd060d75a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: work-decision-phase-a-and-discovery-convergence
    owner: development-work-selection-owner
    ownedPaths:
      - AGENTS.md
      - .agents/skills/sec-heuristic-governance/SKILL.md
      - docs/development-governance.md
      - docs/work-packages/import-operation-scope-v1.md
      - docs/work-packages/work-discovery-and-plan-convergence-v1.md
      - docs/work/README.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/shared/test-impact-rules/governance.ts
      - platform/shared/work-selection-contract.ts
      - scripts/codex/repository-audit.ts
      - tests/contract/agent-skills.test.ts
      - tests/contract/documentation-authority.test.ts
      - tests/contract/repository-audit.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/work-selection-contract.test.ts
forbiddenPaths:
  - .codex/
  - .github/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - docs/roadmap.md
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/verification-session-runtime.ts
  - scripts/codex/verification-session.ts
acceptance:
  - every accepted recurring discovery first resolves an existing work identity canonical owner and current specification and is never left only in chat memory or a narrative report
  - an existing Issue or canonical owner is updated or referenced instead of creating a duplicate plan and only a genuinely ownerless focused problem may receive a new work identity
  - deterministic discovery normalization and next work selection lower to machine contracts while irreducible trigger classification and stop judgement remain owned only by sec heuristic governance
  - WorkDecision phase A consumes only bounded normalized trusted facts and never Issue title body comment review prose or an AI score
  - the pure selector implements continue active closeout reconcile select next none unresolved and human escalation with byte stable input digest reason codes preconditions and rejection witnesses
  - lifecycle completion and reconciliation precede new selection and eligible candidates use the frozen priority classes and stable tie break from Issue 221
  - missing owner exit criteria readiness prerequisite conflict evidence or scope closure fails closed without silently selecting a lower assurance interpretation
  - rolling plan remains a projection of one current package plus two to five candidates and does not become a backlog roadmap registry or second selection policy
  - the current projection preserves existing work identities and explicitly includes Issue 352 and Issue 349 while Issue 221 remains open for live adapter rolling projection Task Capsule integration and bounded action phases
  - repository audit excludes navigation prose and bare Work Package Task Envelope or Agent Skill nouns from heuristic findings while retaining true normative Agent instruction detection
  - no new plan document registry general planner Agent OS long lived umbrella branch or raw Issue prose parser is introduced
  - the superseded selected import operation manifest is deleted after pointer promotion and no v2 v3 or parallel candidate branch is created
  - validation is limited to canonical Skill validation focused selector audit documentation and test impact contracts with no full repository test or broad affected gate
tests:
  - tests/unit/work-selection-contract.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/contract/agent-skills.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/documentation-authority.test.ts
---

# Work Package: Work Discovery and Plan Convergence V1

This package is Issue #221 Phase A plus the smallest authority repair required
to stop accepted discoveries and existing work identities from diverging across
chat, Issues, the roadmap, and the rolling projection.

It adds one pure WorkDecision compiler over normalized facts. It does not read
GitHub prose, write the rolling plan, create a candidate, or perform an effect.
The live adapter and generated rolling projection remain Issue #221 Phase B/C;
ExecutionWave remains Issue #349 and consumes WorkDecision rather than replacing
it.

The Agent behavior rule is intentionally split at its real boundary: repeatable
identity/owner/current-spec convergence is a deterministic product contract,
while deciding whether a newly observed statement is a durable systemic finding
or a local transient remains bounded guidance in `sec-heuristic-governance`.
