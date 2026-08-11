---
schema: codex-development-work-package-v1
id: task-capsule-compiler-v1
tracking: issue-205
base: 8ba2bf1fb39351124187130d60fa971e4802155a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: task-capsule-content-owner-cutover
    owner: development-governance-owner
    ownedPaths:
      - AGENTS.md
      - docs/development-governance.md
      - docs/work-packages/agent-operation-read-plan-v1.md
      - docs/work-packages/bootstrap-repair-348-347-v1.md
      - docs/work-packages/skill-system-convergence-v2.md
      - docs/work-packages/task-capsule-compiler-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/shared/agent-operation-read-plan-contract.ts
      - platform/shared/agent-skill-contract.ts
      - platform/shared/agent-task-capsule-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - scripts/codex/operation-read-plan.ts
      - scripts/codex/skill-applicability.ts
      - scripts/codex/task-capsule.ts
      - tests/contract/documentation-authority.test.ts
      - tests/contract/operation-read-plan.test.ts
      - tests/contract/skill-applicability.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/agent-operation-read-plan.test.ts
      - tests/unit/agent-task-capsule.test.ts
      - tests/unit/skill-applicability-decision.test.ts
forbiddenPaths:
  - .agents/skills/
  - .codex/
  - .github/workflows/
  - .githooks/
  - bun.lock
  - docs/authority.json
  - docs/external-provider-policy.md
  - docs/governance/
  - docs/roadmap.md
  - docs/system-architecture.md
  - docs/verification-governance.md
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - platform/registry/
  - platform/shared/tcb-closure-lock.ts
  - scripts/ci-verification.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/verification-session-runtime.ts
  - scripts/codex/verification-session.ts
acceptance:
  - one pure Task Capsule contract owns schema revision strict parsing canonical ordering compilation and complete content digest and identical semantic input produces byte-identical output
  - Task Capsule is typed unbound planning content and the schema forces authorityStatus unbound-planning-content effectAuthority none and scopeGrantId null while Work Package inputs are named proposal and projection rather than authorization or activation
  - candidate manifest pointer tree freeze journal recovery file ordinary digest local ACL or caller fields cannot issue activation authority and the candidate-local journal positive path is deleted rather than wrapped in another self-digest
  - Task Capsule projection Operation Read Plan production compile and Skill production selection accept no raw authority bypass and return one typed trusted-activation-authority-unavailable result until an independent document-control A0 issuer is integrated
  - the future issuer receipt must be durable issuer-bound and bind exact repository base head tree manifest and raw control-byte digests and consumers must compare raw bytes before fatal UTF-8 decode
  - Operation Read Plan consumes the canonical Task Capsule and no longer defines or derives a competing Capsule schema compiler planning context or operation identity
  - pure Skill applicability may consume canonical content for deterministic algorithm tests but no public production selector may turn unbound content into a positive decision
  - Task Capsule Read Plan and Skill contract or adapter changes are candidate-quarantined and cannot self-authorize from candidate bytes recovery state or test seams
  - focused test-impact ownership maps Task Capsule and Read Plan sources only to their direct contracts and no ordinary change selects a full project verification lane
  - transient worktree recovery or quarantine is legal only while disposition is unresolved and terminal closeout is zero residue or one typed blocked receipt with owner reason target and retry condition
  - all superseded selected Work Package manifests are deleted when the new pointer takes over and documentation tests assert relational invariants rather than one rotating package name
  - Issue 205 remains open for Root-Cause Preflight reconciliation delta and three real-operation proof while Issue 346 remains open for canaries and Issue 275 delegation retirement is not performed before those readbacks
  - no general Run Kernel second coordinator compatibility alias raw authority CLI full local suite or repeated broad audit is introduced
  - validation is limited to static object and ownership checks plus at most one direct contract batch if a decision cannot be made statically before exact-head independent Review
tests:
  - tests/unit/agent-task-capsule.test.ts
  - tests/unit/agent-operation-read-plan.test.ts
  - tests/unit/skill-applicability-decision.test.ts
  - tests/contract/operation-read-plan.test.ts
  - tests/contract/skill-applicability.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/documentation-authority.test.ts
---

# Work Package: Canonical Task Capsule Compiler V1

This package is the production content-compiler Phase A slice of Issue #205.
It makes Task Capsule a real, independently owned pure compiler and moves the
already merged Issue #346 Read Plan onto that upstream content contract. It
does not claim a trusted issuer, the entire Task Capsule and Root-Cause
Preflight Program, or a second run coordinator beside VerificationSession.

Phase A deliberately has no positive local trusted-fact adapter. A
candidate-controlled freeze journal is crash-recovery and consistency state,
not an A0 credential; adding another ordinary digest, issuer string, local
file, or same-user ACL would only disguise the same missing trust boundary.
The Capsule therefore says `authorityStatus=unbound-planning-content`,
`effectAuthority=none`, and `scopeGrantId=null`, while Work Package inputs are
proposal/projection identities. Task Capsule projection, Read Plan production
compile, and Skill production selection all return one typed blocked result
until a separate document-control/A0 owner supplies a durable issuer-bound
receipt. Pure compilers and content verification remain usable without
pretending that content integrity is authority.

## Ownership and retirement boundary

`platform/shared/agent-task-capsule-contract.ts` is the only owner of Task
Capsule content schema, revision, parser, canonical compiler, and digest.
`scripts/codex/task-capsule.ts` owns the typed blocked production seam and
content-verification CLI; it cannot mint a receipt. `agent-operation-read-plan-contract.ts`
owns only Read Plan semantics, and `operation-read-plan.ts` owns only its
currently blocked future read-closure adapter. The future document-control/A0
issuer must remain upstream and independently owned. No alias, raw authority
CLI, journal credential, or legacy parallel compiler remains.

The transitional `sec-task-delegation` Skill is deliberately retained in this
package. It may be retired only after this compiler enters new main, three
Issue #346 real-operation canaries including maintainer mutation read back, and
Issue #275 proves its runtime consumer count is zero.

## Deterministic closeout invariant

Recovery refs and quarantine directories are transaction intermediates, not
archives. They are legal only while semantic ownership or physical deletion is
unresolved. Once exact disposition is known, the same closeout must retire the
temporary worktree, branch, ref, recovery object root, dependency junction and
residue. If the host prevents deletion, the only legal terminal substitute is
a typed blocked receipt that binds owner, exact target, reason, retained state,
and the condition that permits retry. An unnamed or indefinitely retained
`v2/v3/...` directory is never completion.

## Next main sequence

```text
Task Capsule compiler enters new main
→ Issue #346 document-control/A0 activation receipt plus three real-operation canaries and readback
→ Issue #275 delegation consumer-zero retirement from then-current main
→ candidate/control transaction and ScopeGrant cutover
→ VerificationSession physical partitions and Requirement closure
→ ExecutionWave
→ Review and trust transition
→ promotion and legacy retirement
```

Each arrow is an independently mergeable vertical slice. The sequence is a
dependency graph, not authority to keep multiple mutable candidates or run all
verification at every boundary.
