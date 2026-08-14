---
schema: codex-development-work-package-v1
id: issue-186-retirement-fence-exact-leaf-repair-e8242316ca0c20807bbe5edf87bfec5da6658d7a-55b3afd72a8587f3bae44dc4ecb0cc04890a84f0ae849c535b307d756dbf9687
tracking: issue-186
base: e8242316ca0c20807bbe5edf87bfec5da6658d7a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - verification-governance
tasks:
  - id: exact-retirement-fence-leaf-observation
    owner: git-worktree-physical-closeout-owner
    ownedPaths:
      - platform/shared/physical-no-follow.ts
      - tests/unit/physical-no-follow.test.ts
  - id: exact-retirement-fence-consumer
    owner: workspace-write-lease-owner
    ownedPaths:
      - platform/shared/workspace-write-lease.ts
      - tests/unit/workspace-write-lease.test.ts
  - id: generated-trust-closure
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
      - tests/contract/tcb-closure-lock.test.ts
  - id: durable-repair-control
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/default-branch-health-repair-7387e967776b3990ff1c77dc0fb2008b51d37fe0-ef4b810b0c1980ad476439d33089bad8f117b2b32c137f4b28bf1aec99fae80f.md
      - docs/work-packages/issue-186-retirement-fence-exact-leaf-repair-e8242316ca0c20807bbe5edf87bfec5da6658d7a-55b3afd72a8587f3bae44dc4ecb0cc04890a84f0ae849c535b307d756dbf9687.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/documentation-authority.test.ts
forbiddenPaths:
  - .agents/
  - .codex/
  - .githooks/
  - .github/workflows/
  - AGENTS.md
  - bun.lock
  - docs/authority.json
  - docs/development-governance.md
  - docs/roadmap.md
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - platform/orchestrator/
  - platform/shared/test-impact-rules/
  - scripts/codex/
  - scripts/run-work-package-gate.ts
  - source/
acceptance:
  - the repair binds exact healthy main e8242316ca0c20807bbe5edf87bfec5da6658d7a tree 98fb2b6062565a354e4000b0278b7e9f317d63d3 and the real Issue 186 retirement fence failure fingerprint sha256:55b3afd72a8587f3bae44dc4ecb0cc04890a84f0ae849c535b307d756dbf9687
  - the retirement fence validator observes one exact retained ordinary leaf and never recursively scans the fence parent or unrelated sibling projects
  - the exact leaf result keeps the verified parent handle open through relative leaf open and bounded read binds parent identity leaf identity kind size and bytes and returns null only for selected-leaf absence
  - focused regressions prove a valid fence and the physical-absence terminal completion remain valid when the parent contains an unrelated ordinary file larger than the bounded single-leaf read limit
  - Windows and Linux both reject an oversized selected leaf with the same typed bounded-read failure before authorization parsing
  - the live preserved Issue 186 retirement receipt validates against its exact fence without reading the rest of D Project
  - the existing default-branch health repair manifest leaves the active tree for Git history and this repair is the only live Work Package
  - TCB closure is regenerated once from the final source delta and remains current on the committed exact head
  - focused physical lease typecheck documentation TCB diff and exact audit pass before independent Review
  - no formatting transform runs and imports apply runs exactly once on the candidate delta at the frozen boundary; no Linux-only validation is required before hosted exact-main verification
  - independent exact-head Review and hosted trusted bootstrap evidence are required before expected-head squash merge
  - exact new-main MainHealth must be healthy before resuming the durable physical closeout receipt branch CAS and Issue 186 disposition
tests:
  - tests/unit/physical-no-follow.test.ts
  - tests/unit/workspace-write-lease.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/documentation-authority.test.ts
---

# Issue 186 retirement fence exact-leaf repair

The real closeout receipt exposed an authority and performance bug in the
retirement fence validator: proving one content-addressed fence recursively
scanned the entire directory containing every sibling project. A large file in
an unrelated project could therefore block a valid fence, and one O(1) control
read expanded into an 80-second project-wide scan.

The repair adds one retained-parent exact-leaf observation primitive and makes
the lease owner consume it directly. The bounded read limit remains unchanged;
only the authority surface is corrected from an unrelated parent tree to the
single named fence leaf.
